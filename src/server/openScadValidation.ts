import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  OPENSCAD_COMPILE_TIMEOUT_MS,
  OPENSCAD_MAX_OUTPUT_BYTES,
} from '@/lib/openScadLimits';
import {
  normalizeOpenScadProject,
  type OpenScadProject,
} from '@shared/openScadProject';
import { validateOpenScadProjectReferences } from '@shared/openScadProjectReferences';
import type { ServerOpenScadProjectAssetResolver } from './openScadProjectAssetStorage';

export type OpenScadValidation = {
  valid: boolean;
  exitCode: number | null;
  outputBytes: number;
  diagnostics: string | null;
};

function compile(
  sourcePath: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; diagnostics: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/bin/openscad',
      ['--export-format', 'binstl', '--quiet', '-o', outputPath, sourcePath],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let diagnostics = '';
    const stop = () => child.kill('SIGKILL');
    const timer = setTimeout(stop, OPENSCAD_COMPILE_TIMEOUT_MS);
    signal?.addEventListener('abort', stop, { once: true });
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics = `${diagnostics}${chunk}`.slice(-12_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      resolve({ exitCode, diagnostics: diagnostics.trim() });
    });
  });
}

function invalid(diagnostics: string): OpenScadValidation {
  return { valid: false, exitCode: null, outputBytes: 0, diagnostics };
}

export async function validateOpenScadProject(
  project: OpenScadProject,
  signal?: AbortSignal,
  resolveAsset?: ServerOpenScadProjectAssetResolver,
): Promise<OpenScadValidation> {
  let normalized: OpenScadProject;
  try {
    normalized = normalizeOpenScadProject(project);
    validateOpenScadProjectReferences(normalized);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error));
  }

  if (normalized.assets?.length && !resolveAsset) {
    return invalid(
      'OpenSCAD project assets require a conversation-scoped server asset resolver.',
    );
  }

  const dir = await mkdtemp(join(tmpdir(), 'brepia-openscad-project-'));
  const outputPath = join(dir, 'candidate.stl');
  try {
    for (const file of normalized.files) {
      const target = join(dir, ...file.path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, 'utf8');
    }

    if (normalized.assets?.length) {
      try {
        for (const asset of normalized.assets) {
          const bytes = await resolveAsset!(asset);
          const target = join(dir, ...asset.path.split('/'));
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, bytes);
        }
      } catch (error) {
        return invalid(error instanceof Error ? error.message : String(error));
      }
    }

    const sourcePath = join(dir, ...normalized.entrypointPath.split('/'));
    const result = await compile(sourcePath, outputPath, signal);
    if (result.exitCode !== 0) {
      return {
        valid: false,
        exitCode: result.exitCode,
        outputBytes: 0,
        diagnostics: result.diagnostics || null,
      };
    }

    const outputBytes = (await stat(outputPath)).size;
    if (outputBytes > OPENSCAD_MAX_OUTPUT_BYTES) {
      return {
        valid: false,
        exitCode: result.exitCode,
        outputBytes,
        diagnostics: `OpenSCAD output exceeds ${OPENSCAD_MAX_OUTPUT_BYTES} bytes.`,
      };
    }

    return {
      valid: true,
      exitCode: result.exitCode,
      outputBytes,
      diagnostics: result.diagnostics || null,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function validateOpenScad(
  code: string,
  signal?: AbortSignal,
): Promise<OpenScadValidation> {
  return validateOpenScadProject(
    {
      schemaVersion: 1,
      entrypointPath: 'candidate.scad',
      files: [{ path: 'candidate.scad', content: code }],
    },
    signal,
  );
}
