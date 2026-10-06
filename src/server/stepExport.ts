import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  OPENSCAD_PROJECT_MAX_FILE_BYTES,
  normalizeOpenScadProject,
  type OpenScadProject,
  type OpenScadProjectAsset,
} from '@shared/openScadProject';
import { validateOpenScadProjectReferences } from '@shared/openScadProjectReferences';
import type { ServerOpenScadProjectAssetResolver } from './openScadProjectAssetStorage';
import { rewriteOpenScadProjectAssetReferencesForStepSandbox } from './stepExportAssetPaths';

const execFileAsync = promisify(execFile);

/** Legacy one-file wrapper limit. Project-native STEP uses the shared project limits. */
export const STEP_EXPORT_SOURCE_LIMIT_BYTES = OPENSCAD_PROJECT_MAX_FILE_BYTES;
export const STEP_EXPORT_OUTPUT_LIMIT_BYTES = 32 * 1024 * 1024;
export const STEP_EXPORT_TIMEOUT_MS = 45_000;
export const STEP_EXPORT_PROVIDER = 'scad123d';
export const STEP_EXPORT_PROVIDER_VERSION = '0.5.0';
export const STEP_EXPORT_DEFAULT_MAX_CONCURRENT = 1;
const STEP_EXPORT_MAX_CONCURRENT_LIMIT = 8;

let activeStepExports = 0;

export type StepExportResult = {
  bytes: Uint8Array;
  warnings: string[];
  provider: string;
};

export class StepExportError extends Error {
  constructor(
    public readonly code:
      | 'source_too_large'
      | 'invalid_project'
      | 'asset_unavailable'
      | 'provider_unavailable'
      | 'capacity_exceeded'
      | 'conversion_failed'
      | 'conversion_timeout'
      | 'output_missing'
      | 'output_invalid'
      | 'output_too_large',
    message: string,
  ) {
    super(message);
    this.name = 'StepExportError';
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseWarnings(stderr: string): string[] {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /warn|fallback|mesh/i.test(line))
    .slice(0, 20);
}

function sandboxRunner(): string {
  const runner = process.env.BREPIA_STEP_EXPORT_RUNNER?.trim();
  if (!runner) {
    throw new StepExportError(
      'provider_unavailable',
      'STEP export is not configured on this server.',
    );
  }
  return runner;
}

function configuredMaxConcurrent(): number {
  const configured = Number.parseInt(
    process.env.BREPIA_STEP_EXPORT_MAX_CONCURRENT ?? '',
    10,
  );
  if (!Number.isFinite(configured) || configured < 1) {
    return STEP_EXPORT_DEFAULT_MAX_CONCURRENT;
  }
  return Math.min(configured, STEP_EXPORT_MAX_CONCURRENT_LIMIT);
}

function acquireStepExportSlot(): () => void {
  const maxConcurrent = configuredMaxConcurrent();
  if (activeStepExports >= maxConcurrent) {
    throw new StepExportError(
      'capacity_exceeded',
      'STEP export capacity is currently busy. Try again shortly.',
    );
  }

  activeStepExports += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeStepExports = Math.max(0, activeStepExports - 1);
  };
}

function stderrText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Buffer.isBuffer(value)) return value.toString('utf8').trim();
  return '';
}

function providerUnavailableMessage(detail: string): string {
  const normalized = detail
    .replace(/^STEP_SANDBOX_UNAVAILABLE:\s*/i, '')
    .trim();
  return normalized || 'STEP export sandbox is unavailable on this server.';
}

async function resolveAndVerifyAsset(
  asset: OpenScadProjectAsset,
  resolveAsset: ServerOpenScadProjectAssetResolver,
): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await resolveAsset(asset);
  } catch (error) {
    throw new StepExportError(
      'asset_unavailable',
      error instanceof Error
        ? error.message
        : `Could not load OpenSCAD project asset ${asset.path}.`,
    );
  }

  if (bytes.byteLength !== asset.byteLength || sha256(bytes) !== asset.sha256) {
    throw new StepExportError(
      'asset_unavailable',
      `OpenSCAD project asset integrity check failed for ${asset.path}.`,
    );
  }
  return bytes;
}

async function convertProjectToStep(
  project: OpenScadProject,
  resolveAsset?: ServerOpenScadProjectAssetResolver,
): Promise<StepExportResult> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'brepia-step-'));
  const inputDir = path.join(workspace, 'input');
  const outputDir = path.join(workspace, 'output');
  const outputPath = path.join(outputDir, 'model.step');

  try {
    await mkdir(inputDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    for (const file of project.files) {
      const target = path.join(inputDir, ...file.path.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, 'utf8');
    }

    if (project.assets?.length) {
      if (!resolveAsset) {
        throw new StepExportError(
          'asset_unavailable',
          'STEP export requires a conversation-scoped resolver for project assets.',
        );
      }
      for (const asset of project.assets) {
        const bytes = await resolveAndVerifyAsset(asset, resolveAsset);
        const target = path.join(inputDir, ...asset.path.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes);
      }
    }

    let stderr = '';
    try {
      const result = await execFileAsync(
        sandboxRunner(),
        [
          '--project',
          inputDir,
          '--entrypoint',
          project.entrypointPath,
          '-o',
          outputPath,
          ...(project.assets?.length ? ['--mesh-scope', 'hoist'] : []),
        ],
        {
          timeout: STEP_EXPORT_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
          env: process.env,
        },
      );
      stderr = result.stderr ?? '';
    } catch (error) {
      if (error instanceof StepExportError) throw error;

      const record = error as {
        code?: string | number;
        killed?: boolean;
        signal?: string;
        stderr?: string | Buffer;
      };
      const detail = stderrText(record.stderr);

      if (record.code === 'ENOENT' || record.code === 69) {
        throw new StepExportError(
          'provider_unavailable',
          record.code === 'ENOENT'
            ? 'Configured STEP export runner was not found on the server.'
            : providerUnavailableMessage(detail),
        );
      }

      if (record.code === 124 || record.killed || record.signal === 'SIGTERM') {
        throw new StepExportError(
          'conversion_timeout',
          'STEP conversion exceeded the server time limit.',
        );
      }

      throw new StepExportError(
        'conversion_failed',
        detail
          ? `STEP conversion failed: ${detail.slice(0, 1200)}`
          : 'STEP conversion failed.',
      );
    }

    let outputStat;
    try {
      outputStat = await lstat(outputPath);
    } catch {
      throw new StepExportError(
        'output_missing',
        'STEP converter completed without producing an output file.',
      );
    }

    if (outputStat.isSymbolicLink() || !outputStat.isFile()) {
      throw new StepExportError(
        'output_invalid',
        'STEP converter produced an invalid output object.',
      );
    }

    if (outputStat.size > STEP_EXPORT_OUTPUT_LIMIT_BYTES) {
      throw new StepExportError(
        'output_too_large',
        `STEP output exceeds the ${STEP_EXPORT_OUTPUT_LIMIT_BYTES}-byte server limit.`,
      );
    }

    const output = await readFile(outputPath);
    if (output.byteLength > STEP_EXPORT_OUTPUT_LIMIT_BYTES) {
      throw new StepExportError(
        'output_too_large',
        `STEP output exceeds the ${STEP_EXPORT_OUTPUT_LIMIT_BYTES}-byte server limit.`,
      );
    }

    const header = output.subarray(0, 128).toString('ascii');
    if (!header.includes('ISO-10303-21')) {
      throw new StepExportError(
        'output_invalid',
        'STEP converter output is not an ISO 10303-21 Part 21 file.',
      );
    }

    return {
      bytes: new Uint8Array(output),
      warnings: parseWarnings(stderr),
      provider: `${STEP_EXPORT_PROVIDER}@${STEP_EXPORT_PROVIDER_VERSION}`,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

/**
 * Convert a complete normalized OpenSCAD project to STEP using an explicitly
 * configured sandboxed scad2step runner. Project sources and verified assets
 * are materialized into one server-owned temporary directory that is mounted
 * read-only into the converter container.
 */
export async function exportOpenScadProjectToStep(
  project: OpenScadProject,
  resolveAsset?: ServerOpenScadProjectAssetResolver,
): Promise<StepExportResult> {
  let normalized: OpenScadProject;
  try {
    normalized = normalizeOpenScadProject(project);
    validateOpenScadProjectReferences(normalized);
    normalized =
      rewriteOpenScadProjectAssetReferencesForStepSandbox(normalized);
  } catch (error) {
    throw new StepExportError(
      'invalid_project',
      error instanceof Error ? error.message : 'Invalid OpenSCAD project.',
    );
  }

  if (normalized.assets?.length && !resolveAsset) {
    throw new StepExportError(
      'asset_unavailable',
      'STEP export requires access to the project assets.',
    );
  }

  const releaseSlot = acquireStepExportSlot();
  try {
    return await convertProjectToStep(normalized, resolveAsset);
  } finally {
    releaseSlot();
  }
}

/**
 * Compatibility wrapper for source-only callers. The source is still executed
 * through the project-directory sandbox path; no native converter runs in the
 * Brepia host process.
 */
export async function exportScadToStep(
  sourceCode: string,
): Promise<StepExportResult> {
  const sourceBytes = byteLength(sourceCode);
  if (sourceBytes > STEP_EXPORT_SOURCE_LIMIT_BYTES) {
    throw new StepExportError(
      'source_too_large',
      `OpenSCAD source exceeds the ${STEP_EXPORT_SOURCE_LIMIT_BYTES}-byte STEP export limit.`,
    );
  }

  return exportOpenScadProjectToStep({
    schemaVersion: 1,
    entrypointPath: 'model.scad',
    files: [{ path: 'model.scad', content: sourceCode }],
  });
}
