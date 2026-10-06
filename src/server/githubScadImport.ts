import { Buffer } from 'node:buffer';
import { OPENSCAD_MAX_SOURCE_BYTES } from '@/lib/openScadLimits';
import { decodeScadImportBytes } from '@/lib/scadImport';
import {
  normalizeGithubScadUrl,
  type GithubScadSource,
} from '@/lib/githubScadImport';
import {
  OPENSCAD_PROJECT_MAX_ASSETS,
  OPENSCAD_PROJECT_MAX_ASSET_BYTES,
  OPENSCAD_PROJECT_MAX_FILES,
  OPENSCAD_PROJECT_MAX_TOTAL_ASSET_BYTES,
  OPENSCAD_PROJECT_MAX_TOTAL_BYTES,
  isOpenScadProjectAssetPathSupportedForKind,
  normalizeOpenScadProject,
  normalizeOpenScadProjectPath,
  type OpenScadProject,
  type OpenScadProjectFile,
} from '@shared/openScadProject';
import {
  collectOpenScadProjectAssetReferences,
  resolveOpenScadProjectReference,
  stripOpenScadStringsAndComments,
  validateOpenScadProjectSourceReferences,
} from '@shared/openScadProjectReferences';
import { env } from './env';

export type ResolvedGithubScadAsset = {
  path: string;
  contentBase64: string;
};

export type ResolvedGithubScadImport = {
  filename: string;
  project: OpenScadProject;
  assets: ResolvedGithubScadAsset[];
  canonicalUrl: string;
};

export type GithubScadResolveErrorCode =
  | 'github_not_found'
  | 'github_rate_limited'
  | 'github_fetch_failed'
  | 'github_invalid_response'
  | 'github_dependency_missing'
  | 'github_dependency_invalid'
  | 'github_non_regular_file'
  | 'gist_ambiguous'
  | 'gist_truncated'
  | 'too_large'
  | 'too_many_files'
  | 'too_many_assets';

export class GithubScadResolveError extends Error {
  constructor(
    public readonly code: GithubScadResolveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GithubScadResolveError';
  }
}

const FETCH_TIMEOUT_MS = 10_000;
const PROJECT_RESOLVE_BUDGET_MS = 30_000;
const BUNDLED_LIBRARY_ROOTS = new Set(['BOSL', 'BOSL2', 'MCAD']);
const SCAD_EXTENSION_PATTERN = /\.scad$/i;

function githubHeaders(accept = 'application/vnd.github+json'): Headers {
  const headers = new Headers({
    Accept: accept,
    'User-Agent': 'Brepia-SCAD-import',
    'X-GitHub-Api-Version': '2022-11-28',
  });
  const token = env('GITHUB_TOKEN').trim();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

async function githubFetch(
  url: string,
  accept = 'application/vnd.github+json',
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: githubHeaders(accept),
      signal: controller.signal,
      redirect: 'error',
    });
    if (response.status === 404) {
      throw new GithubScadResolveError(
        'github_not_found',
        'The GitHub SCAD file or Gist could not be found.',
      );
    }
    if (response.status === 403 || response.status === 429) {
      throw new GithubScadResolveError(
        'github_rate_limited',
        'GitHub temporarily refused the import request. Try again later.',
      );
    }
    if (!response.ok) {
      throw new GithubScadResolveError(
        'github_fetch_failed',
        `GitHub import failed with HTTP ${response.status}.`,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof GithubScadResolveError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GithubScadResolveError(
        'github_fetch_failed',
        'GitHub import timed out.',
      );
    }
    throw new GithubScadResolveError(
      'github_fetch_failed',
      'Could not retrieve the SCAD source from GitHub.',
    );
  } finally {
    clearTimeout(timer);
  }
}

function encodedContentPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function repositoryContentEndpoint(input: {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}): string {
  return (
    `https://api.github.com/repos/${encodeURIComponent(input.owner)}` +
    `/${encodeURIComponent(input.repo)}/contents/${encodedContentPath(input.path)}` +
    `?ref=${encodeURIComponent(input.ref)}`
  );
}

function decodeGithubBase64(content: unknown): Uint8Array {
  if (typeof content !== 'string') {
    throw new GithubScadResolveError(
      'github_invalid_response',
      'GitHub returned an invalid file payload.',
    );
  }
  try {
    return new Uint8Array(Buffer.from(content.replace(/\s+/g, ''), 'base64'));
  } catch {
    throw new GithubScadResolveError(
      'github_invalid_response',
      'GitHub returned invalid base64 file data.',
    );
  }
}

function decodeProjectSource(path: string, bytes: Uint8Array): string {
  if (bytes.byteLength > OPENSCAD_MAX_SOURCE_BYTES) {
    throw new GithubScadResolveError(
      'too_large',
      `OpenSCAD source ${path} exceeds ${OPENSCAD_MAX_SOURCE_BYTES} UTF-8 bytes.`,
    );
  }

  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new GithubScadResolveError(
      'github_dependency_invalid',
      `OpenSCAD source ${path} is not valid UTF-8 text.`,
    );
  }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  if (source.includes('\0')) {
    throw new GithubScadResolveError(
      'github_dependency_invalid',
      `OpenSCAD source ${path} contains binary/NUL data.`,
    );
  }
  return source;
}

type RepositoryFile = {
  path: string;
  content: string;
  bytes: number;
};

async function fetchRepositoryScadFile({
  owner,
  repo,
  ref,
  path,
  requestedBy,
}: {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  requestedBy: string | null;
}): Promise<RepositoryFile> {
  const endpoint = repositoryContentEndpoint({ owner, repo, ref, path });

  let response: Response;
  try {
    response = await githubFetch(endpoint);
  } catch (error) {
    if (
      requestedBy &&
      error instanceof GithubScadResolveError &&
      error.code === 'github_not_found'
    ) {
      throw new GithubScadResolveError(
        'github_dependency_missing',
        `OpenSCAD dependency ${path} referenced from ${requestedBy} could not be found at the selected GitHub ref.`,
      );
    }
    throw error;
  }

  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!payload || Array.isArray(payload)) {
    throw new GithubScadResolveError(
      'github_invalid_response',
      `GitHub did not return a single file for ${path}.`,
    );
  }

  const size = payload['size'];
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    throw new GithubScadResolveError(
      'github_invalid_response',
      `GitHub file size metadata is invalid for ${path}.`,
    );
  }
  if (size > OPENSCAD_MAX_SOURCE_BYTES) {
    throw new GithubScadResolveError(
      'too_large',
      `OpenSCAD source ${path} exceeds ${OPENSCAD_MAX_SOURCE_BYTES} UTF-8 bytes.`,
    );
  }

  if (
    payload['type'] !== 'file' ||
    payload['encoding'] !== 'base64' ||
    typeof payload['submodule_git_url'] === 'string'
  ) {
    throw new GithubScadResolveError(
      'github_non_regular_file',
      `GitHub dependency ${path} must resolve to a normal repository file. Symlinks and submodules are not followed.`,
    );
  }

  const bytes = decodeGithubBase64(payload['content']);
  return {
    path,
    content: decodeProjectSource(path, bytes),
    bytes: bytes.byteLength,
  };
}

type StaticProjectTargets = {
  sourcePaths: string[];
  assetPaths: string[];
};

function collectStaticProjectTargets(
  sourcePath: string,
  content: string,
): StaticProjectTargets {
  const active = stripOpenScadStringsAndComments(content);
  const includeUseRegex = /\b(?:include|use)\s*<([^>\r\n]+)>/g;
  const sourcePaths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = includeUseRegex.exec(active)) !== null) {
    const target = match[1].trim();
    const root = target.replace(/\\/g, '/').split('/', 1)[0];
    if (BUNDLED_LIBRARY_ROOTS.has(root)) continue;

    let resolvedPath: string;
    try {
      resolvedPath = resolveOpenScadProjectReference(sourcePath, target);
    } catch (error) {
      throw new GithubScadResolveError(
        'github_dependency_invalid',
        error instanceof Error
          ? error.message
          : `Invalid OpenSCAD dependency ${target} in ${sourcePath}.`,
      );
    }

    if (!SCAD_EXTENSION_PATTERN.test(resolvedPath)) {
      throw new GithubScadResolveError(
        'github_dependency_invalid',
        `OpenSCAD dependency ${target} in ${sourcePath} must resolve to a .scad project source.`,
      );
    }
    sourcePaths.push(resolvedPath);
  }

  let assetReferences;
  try {
    assetReferences = collectOpenScadProjectAssetReferences({
      schemaVersion: 1,
      entrypointPath: sourcePath,
      files: [{ path: sourcePath, content }],
    });
  } catch (error) {
    throw new GithubScadResolveError(
      'github_dependency_invalid',
      error instanceof Error
        ? error.message
        : `Invalid OpenSCAD asset reference in ${sourcePath}.`,
    );
  }

  const assetPaths: string[] = [];
  for (const reference of assetReferences) {
    if (reference.dynamic || !reference.target || !reference.resolvedPath) {
      throw new GithubScadResolveError(
        'github_dependency_invalid',
        `${reference.kind}(...) in ${sourcePath} uses a dynamic file argument. GitHub assets must use a literal filename.`,
      );
    }
    if (
      !isOpenScadProjectAssetPathSupportedForKind(
        reference.resolvedPath,
        reference.kind,
      )
    ) {
      throw new GithubScadResolveError(
        'github_dependency_invalid',
        `${reference.kind}("${reference.target}") in ${sourcePath} uses an unsupported asset format.`,
      );
    }
    assetPaths.push(reference.resolvedPath);
  }

  return { sourcePaths, assetPaths };
}

function normalizeRepositoryProjectPath(path: string): string {
  try {
    return normalizeOpenScadProjectPath(path);
  } catch (error) {
    throw new GithubScadResolveError(
      'github_dependency_invalid',
      error instanceof Error
        ? error.message
        : `Invalid GitHub OpenSCAD project path: ${path}.`,
    );
  }
}

async function fetchRepositoryAsset(input: {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  requestedBy: string;
}): Promise<ResolvedGithubScadAsset & { byteLength: number }> {
  const endpoint = repositoryContentEndpoint(input);
  let metadataResponse: Response;
  try {
    metadataResponse = await githubFetch(endpoint);
  } catch (error) {
    if (
      error instanceof GithubScadResolveError &&
      error.code === 'github_not_found'
    ) {
      throw new GithubScadResolveError(
        'github_dependency_missing',
        `OpenSCAD asset ${input.path} referenced from ${input.requestedBy} could not be found at the selected GitHub ref.`,
      );
    }
    throw error;
  }

  const payload = (await metadataResponse.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!payload || Array.isArray(payload)) {
    throw new GithubScadResolveError(
      'github_invalid_response',
      `GitHub did not return a single file for asset ${input.path}.`,
    );
  }
  const size = payload['size'];
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    throw new GithubScadResolveError(
      'github_invalid_response',
      `GitHub file size metadata is invalid for asset ${input.path}.`,
    );
  }
  if (size > OPENSCAD_PROJECT_MAX_ASSET_BYTES) {
    throw new GithubScadResolveError(
      'too_large',
      `OpenSCAD asset ${input.path} exceeds ${OPENSCAD_PROJECT_MAX_ASSET_BYTES} bytes.`,
    );
  }
  if (
    payload['type'] !== 'file' ||
    typeof payload['submodule_git_url'] === 'string'
  ) {
    throw new GithubScadResolveError(
      'github_non_regular_file',
      `GitHub asset ${input.path} must resolve to a normal repository file. Symlinks and submodules are not followed.`,
    );
  }

  const rawResponse = await githubFetch(
    endpoint,
    'application/vnd.github.raw+json',
  );
  const bytes = new Uint8Array(await rawResponse.arrayBuffer());
  if (bytes.byteLength !== size) {
    throw new GithubScadResolveError(
      'github_invalid_response',
      `GitHub returned an unexpected byte count for asset ${input.path}.`,
    );
  }

  return {
    path: input.path,
    contentBase64: Buffer.from(bytes).toString('base64'),
    byteLength: bytes.byteLength,
  };
}

async function resolveGithubFileProject(
  source: Extract<GithubScadSource, { kind: 'file' }>,
): Promise<ResolvedGithubScadImport> {
  const startedAt = Date.now();
  const entrypointPath = normalizeRepositoryProjectPath(source.path);
  const pending: Array<{ path: string; requestedBy: string | null }> = [
    { path: entrypointPath, requestedBy: null },
  ];
  const scheduledSources = new Set([entrypointPath]);
  const scheduledAssets = new Map<string, string>();
  const files: OpenScadProjectFile[] = [];
  let totalBytes = 0;

  while (pending.length > 0) {
    if (Date.now() - startedAt > PROJECT_RESOLVE_BUDGET_MS) {
      throw new GithubScadResolveError(
        'github_fetch_failed',
        'GitHub OpenSCAD project resolution exceeded the import time budget.',
      );
    }

    const current = pending.shift()!;
    const resolved = await fetchRepositoryScadFile({
      owner: source.owner,
      repo: source.repo,
      ref: source.ref,
      path: current.path,
      requestedBy: current.requestedBy,
    });

    totalBytes += resolved.bytes;
    if (totalBytes > OPENSCAD_PROJECT_MAX_TOTAL_BYTES) {
      throw new GithubScadResolveError(
        'too_large',
        `OpenSCAD project exceeds ${OPENSCAD_PROJECT_MAX_TOTAL_BYTES} UTF-8 bytes.`,
      );
    }
    files.push({ path: resolved.path, content: resolved.content });

    const targets = collectStaticProjectTargets(
      resolved.path,
      resolved.content,
    );
    for (const dependencyPath of targets.sourcePaths) {
      if (scheduledSources.has(dependencyPath)) continue;
      if (scheduledSources.size >= OPENSCAD_PROJECT_MAX_FILES) {
        throw new GithubScadResolveError(
          'too_many_files',
          `OpenSCAD project exceeds ${OPENSCAD_PROJECT_MAX_FILES} source files.`,
        );
      }
      scheduledSources.add(dependencyPath);
      pending.push({ path: dependencyPath, requestedBy: resolved.path });
    }
    for (const assetPath of targets.assetPaths) {
      if (!scheduledAssets.has(assetPath)) {
        if (scheduledAssets.size >= OPENSCAD_PROJECT_MAX_ASSETS) {
          throw new GithubScadResolveError(
            'too_many_assets',
            `OpenSCAD project exceeds ${OPENSCAD_PROJECT_MAX_ASSETS} referenced assets.`,
          );
        }
        scheduledAssets.set(assetPath, resolved.path);
      }
    }
  }

  let project: OpenScadProject;
  try {
    project = normalizeOpenScadProject({
      schemaVersion: 1,
      entrypointPath,
      files,
    });
    validateOpenScadProjectSourceReferences(project);
  } catch (error) {
    throw new GithubScadResolveError(
      'github_dependency_invalid',
      error instanceof Error
        ? error.message
        : 'The resolved GitHub OpenSCAD project is invalid.',
    );
  }

  const assets: ResolvedGithubScadAsset[] = [];
  let totalAssetBytes = 0;
  for (const [path, requestedBy] of [...scheduledAssets.entries()].sort(
    ([left], [right]) => left.localeCompare(right, 'en-US'),
  )) {
    if (Date.now() - startedAt > PROJECT_RESOLVE_BUDGET_MS) {
      throw new GithubScadResolveError(
        'github_fetch_failed',
        'GitHub OpenSCAD project resolution exceeded the import time budget.',
      );
    }
    const asset = await fetchRepositoryAsset({
      owner: source.owner,
      repo: source.repo,
      ref: source.ref,
      path,
      requestedBy,
    });
    totalAssetBytes += asset.byteLength;
    if (totalAssetBytes > OPENSCAD_PROJECT_MAX_TOTAL_ASSET_BYTES) {
      throw new GithubScadResolveError(
        'too_large',
        `OpenSCAD project assets exceed ${OPENSCAD_PROJECT_MAX_TOTAL_ASSET_BYTES} bytes.`,
      );
    }
    assets.push({ path: asset.path, contentBase64: asset.contentBase64 });
  }

  return {
    filename: source.filename,
    project,
    assets,
    canonicalUrl: source.canonicalUrl,
  };
}

type GistFile = {
  filename?: unknown;
  type?: unknown;
  language?: unknown;
  raw_url?: unknown;
  size?: unknown;
  truncated?: unknown;
  content?: unknown;
};

async function resolveGist(
  source: Extract<GithubScadSource, { kind: 'gist' }>,
): Promise<ResolvedGithubScadImport> {
  const endpoint = `https://api.github.com/gists/${encodeURIComponent(source.gistId)}`;
  const response = await githubFetch(endpoint);
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!payload) {
    throw new GithubScadResolveError(
      'github_invalid_response',
      'GitHub returned an invalid Gist payload.',
    );
  }
  if (payload['truncated'] === true) {
    throw new GithubScadResolveError(
      'gist_truncated',
      'The Gist file list is truncated by GitHub and cannot be imported unambiguously.',
    );
  }
  const files = payload['files'];
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new GithubScadResolveError(
      'github_invalid_response',
      'The Gist does not contain a valid file map.',
    );
  }

  const candidates = Object.values(files as Record<string, GistFile>).filter(
    (file) =>
      file &&
      typeof file === 'object' &&
      typeof file.filename === 'string' &&
      /\.scad$/i.test(file.filename),
  );
  if (candidates.length !== 1) {
    throw new GithubScadResolveError(
      'gist_ambiguous',
      'The Gist must contain exactly one .scad file.',
    );
  }

  const file = candidates[0];
  const filename = file.filename as string;
  if (
    typeof file.size === 'number' &&
    Number.isFinite(file.size) &&
    file.size > OPENSCAD_MAX_SOURCE_BYTES
  ) {
    throw new GithubScadResolveError(
      'too_large',
      `OpenSCAD source exceeds ${OPENSCAD_MAX_SOURCE_BYTES} UTF-8 bytes.`,
    );
  }
  if (file.truncated === true) {
    throw new GithubScadResolveError(
      'gist_truncated',
      'The Gist SCAD file is truncated by GitHub and cannot be imported safely.',
    );
  }
  if (typeof file.content !== 'string') {
    throw new GithubScadResolveError(
      'github_invalid_response',
      'GitHub did not return inline Gist source content.',
    );
  }

  const bytes = new TextEncoder().encode(file.content);
  if (bytes.byteLength > OPENSCAD_MAX_SOURCE_BYTES) {
    throw new GithubScadResolveError(
      'too_large',
      `OpenSCAD source exceeds ${OPENSCAD_MAX_SOURCE_BYTES} UTF-8 bytes.`,
    );
  }
  const code = decodeScadImportBytes(filename, bytes);
  const project = normalizeOpenScadProject({
    schemaVersion: 1,
    entrypointPath: filename,
    files: [{ path: filename, content: code }],
  });
  return {
    filename,
    project,
    assets: [],
    canonicalUrl: source.canonicalUrl,
  };
}

export async function resolveGithubScadImport(
  input: string,
): Promise<ResolvedGithubScadImport> {
  const source = normalizeGithubScadUrl(input);
  return source.kind === 'file'
    ? resolveGithubFileProject(source)
    : resolveGist(source);
}
