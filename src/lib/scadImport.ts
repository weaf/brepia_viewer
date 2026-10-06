import { OPENSCAD_MAX_SOURCE_BYTES } from '@/lib/openScadLimits';
import {
  OPENSCAD_PROJECT_MAX_ASSETS,
  OPENSCAD_PROJECT_MAX_ASSET_BYTES,
  OPENSCAD_PROJECT_MAX_FILES,
  OPENSCAD_PROJECT_MAX_TOTAL_ASSET_BYTES,
  OPENSCAD_PROJECT_MAX_TOTAL_BYTES,
  isOpenScadProjectAssetPathSupportedForKind,
  normalizeOpenScadProject,
  normalizeOpenScadProjectPath,
  openScadProjectAssetMediaTypeForPath,
  type OpenScadProject,
  type OpenScadProjectFile,
} from '@shared/openScadProject';
import {
  collectOpenScadProjectAssetReferences,
  validateOpenScadProjectSourceReferences,
} from '@shared/openScadProjectReferences';

export type ScadImportErrorCode =
  | 'invalid_extension'
  | 'too_large'
  | 'invalid_utf8'
  | 'binary_source'
  | 'source_too_short'
  | 'unsupported_dependency'
  | 'too_many_files'
  | 'too_many_assets'
  | 'project_too_large'
  | 'assets_too_large'
  | 'missing_relative_path'
  | 'mixed_folder'
  | 'no_scad_files'
  | 'invalid_entrypoint';

export class ScadImportError extends Error {
  constructor(
    public readonly code: ScadImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ScadImportError';
  }
}

export type ScadDependencyIssue = {
  kind: 'include' | 'use' | 'import' | 'surface';
  target: string;
  message: string;
};

export type ScadFolderSourceInput = {
  name: string;
  relativePath: string;
  bytes: Uint8Array;
};

export type ScadFolderAssetInput = {
  path: string;
  bytes: Uint8Array;
};

export type PendingScadFolderImport = {
  title: string;
  filename: string;
  files: OpenScadProjectFile[];
  assets: ScadFolderAssetInput[];
  entrypointCandidates: string[];
};

export type ScadFolderImportResult =
  | {
      kind: 'project';
      title: string;
      filename: string;
      project: OpenScadProject;
      assets: ScadFolderAssetInput[];
    }
  | {
      kind: 'entrypoint-required';
      pending: PendingScadFolderImport;
    };

const BUNDLED_LIBRARY_ROOTS = new Set(['BOSL', 'BOSL2', 'MCAD']);
const MAX_RETAINED_COMPILE_ERROR_CHARS = 12_000;
const SCAD_FILENAME = /\.scad(?:\.txt)?$/i;

export function isSupportedScadFilename(filename: string): boolean {
  return SCAD_FILENAME.test(filename.trim());
}

export function isSupportedScadAssetFilename(filename: string): boolean {
  return openScadProjectAssetMediaTypeForPath(filename.trim()) !== null;
}

function assertScadFilename(filename: string): void {
  if (!isSupportedScadFilename(filename)) {
    throw new ScadImportError(
      'invalid_extension',
      'Choose an OpenSCAD .scad file.',
    );
  }
}

/**
 * Blank comments and string literals while preserving line breaks. This lets
 * dependency detection inspect only active OpenSCAD syntax without matching
 * `include`, `use` or `import(` examples that merely occur in prose/strings.
 */
export function stripScadStringsAndComments(source: string): string {
  let out = '';
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"') {
      out += ' ';
      index += 1;
      while (index < source.length) {
        const current = source[index];
        if (current === '\n') out += '\n';
        if (current === '\\') {
          out += ' ';
          index += Math.min(2, source.length - index);
          continue;
        }
        if (current === '"') {
          out += ' ';
          index += 1;
          break;
        }
        out += current === '\n' ? '' : ' ';
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      out += '  ';
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        out += ' ';
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      out += '  ';
      index += 2;
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        out += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < source.length) {
        out += '  ';
        index += 2;
      }
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

export function findUnsupportedScadDependencies(
  source: string,
): ScadDependencyIssue[] {
  const active = stripScadStringsAndComments(source);
  const issues: ScadDependencyIssue[] = [];

  const includeUseRegex = /\b(include|use)\s*<([^>\r\n]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = includeUseRegex.exec(active)) !== null) {
    const kind = match[1] as 'include' | 'use';
    const target = match[2].trim();
    const root = target.split(/[\\/]/, 1)[0];
    if (!BUNDLED_LIBRARY_ROOTS.has(root)) {
      issues.push({
        kind,
        target,
        message: `${kind} <${target}> is not supported by single-file import. V1 only resolves bundled BOSL, BOSL2 and MCAD libraries.`,
      });
    }
  }

  if (/\bimport\s*\(/.test(active)) {
    issues.push({
      kind: 'import',
      target: 'external asset',
      message:
        'import(...) asset dependencies require a project folder so Brepia can resolve the referenced file explicitly.',
    });
  }

  if (/\bsurface\s*\(/.test(active)) {
    issues.push({
      kind: 'surface',
      target: 'external asset',
      message:
        'surface(...) file dependencies require a project folder so Brepia can resolve the referenced file explicitly.',
    });
  }

  return issues;
}

export function assertSupportedScadDependencies(source: string): void {
  const issues = findUnsupportedScadDependencies(source);
  if (issues.length === 0) return;

  throw new ScadImportError(
    'unsupported_dependency',
    issues.map((issue) => issue.message).join('\n'),
  );
}

function decodeScadSourceBytes(
  filename: string,
  bytes: Uint8Array,
  options: { singleFile: boolean },
): string {
  assertScadFilename(filename);

  if (bytes.byteLength > OPENSCAD_MAX_SOURCE_BYTES) {
    throw new ScadImportError(
      'too_large',
      `OpenSCAD source exceeds ${OPENSCAD_MAX_SOURCE_BYTES} UTF-8 bytes.`,
    );
  }

  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ScadImportError(
      'invalid_utf8',
      'The .scad file is not valid UTF-8 text.',
    );
  }

  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  if (source.includes('\0')) {
    throw new ScadImportError(
      'binary_source',
      'The .scad file contains binary/NUL data and cannot be imported.',
    );
  }
  if (options.singleFile && source.length < 20) {
    throw new ScadImportError(
      'source_too_short',
      'The .scad source is too short to form a Brepia parametric artifact.',
    );
  }

  if (options.singleFile) assertSupportedScadDependencies(source);
  return source;
}

export function decodeScadImportBytes(
  filename: string,
  bytes: Uint8Array,
): string {
  return decodeScadSourceBytes(filename, bytes, { singleFile: true });
}

export async function readScadImportFile(file: File): Promise<string> {
  assertScadFilename(file.name);
  if (file.size > OPENSCAD_MAX_SOURCE_BYTES) {
    throw new ScadImportError(
      'too_large',
      `OpenSCAD source exceeds ${OPENSCAD_MAX_SOURCE_BYTES} UTF-8 bytes.`,
    );
  }

  return decodeScadImportBytes(
    file.name,
    new Uint8Array(await file.arrayBuffer()),
  );
}

export function scadImportTitle(filename: string): string {
  const basename = filename.split(/[\\/]/).at(-1) ?? filename;
  const withoutExtension = basename.replace(/\.scad(?:\.txt)?$/i, '').trim();
  return withoutExtension || 'Imported OpenSCAD model';
}

export function scadImportProjectPath(filename: string): string {
  assertScadFilename(filename);
  const basename = (filename.split(/[\\/]/).at(-1) ?? filename).trim();
  return basename.replace(/\.scad\.txt$/i, '.scad');
}

function folderProjectPath(
  relativePath: string,
  options: { normalizeScadAlias: boolean },
): { root: string; projectPath: string } {
  if (!relativePath.trim()) {
    throw new ScadImportError(
      'missing_relative_path',
      'The browser did not provide a relative path for the selected folder.',
    );
  }

  const normalizedSeparators = relativePath.replace(/\\/g, '/');
  const segments = normalizedSeparators.split('/');
  if (segments.length < 2) {
    throw new ScadImportError(
      'missing_relative_path',
      `Folder import cannot preserve the path for ${relativePath}.`,
    );
  }

  const root = normalizeOpenScadProjectPath(segments[0]);
  let childPath = segments.slice(1).join('/');
  if (options.normalizeScadAlias) {
    childPath = childPath.replace(/\.scad\.txt$/i, '.scad');
  }
  return {
    root,
    projectPath: normalizeOpenScadProjectPath(childPath),
  };
}

function assertSingleFolderRoot(expected: string | null, actual: string): string {
  if (expected !== null && expected !== actual) {
    throw new ScadImportError(
      'mixed_folder',
      'Folder import received files from more than one root folder.',
    );
  }
  return actual;
}

function assertFolderProjectDependencies(
  project: OpenScadProject,
  availableAssets: readonly ScadFolderAssetInput[],
): ScadFolderAssetInput[] {
  try {
    validateOpenScadProjectSourceReferences(project);
  } catch (error) {
    throw new ScadImportError(
      'unsupported_dependency',
      error instanceof Error
        ? error.message
        : 'The OpenSCAD project contains an invalid source dependency.',
    );
  }

  const availableByPath = new Map(
    availableAssets.map((asset) => [asset.path, asset]),
  );
  const referencedPaths = new Set<string>();

  let references;
  try {
    references = collectOpenScadProjectAssetReferences(project);
  } catch (error) {
    throw new ScadImportError(
      'unsupported_dependency',
      error instanceof Error
        ? error.message
        : 'The OpenSCAD project contains an invalid asset dependency.',
    );
  }

  for (const reference of references) {
    if (reference.dynamic || !reference.target || !reference.resolvedPath) {
      throw new ScadImportError(
        'unsupported_dependency',
        `${reference.kind}(...) in ${reference.sourcePath} uses a dynamic file argument. Folder assets must use a literal filename.`,
      );
    }
    if (
      !isOpenScadProjectAssetPathSupportedForKind(
        reference.resolvedPath,
        reference.kind,
      )
    ) {
      throw new ScadImportError(
        'unsupported_dependency',
        `${reference.kind}("${reference.target}") in ${reference.sourcePath} uses an unsupported asset format.`,
      );
    }
    if (!availableByPath.has(reference.resolvedPath)) {
      throw new ScadImportError(
        'unsupported_dependency',
        `${reference.kind}("${reference.target}") in ${reference.sourcePath} does not resolve to a supported file in the selected folder.`,
      );
    }
    referencedPaths.add(reference.resolvedPath);
  }

  const sourcePaths = new Map(
    project.files.map((file) => [file.path.toLocaleLowerCase('en-US'), file.path]),
  );
  const seenAssetPaths = new Map<string, string>();
  const selectedAssets = availableAssets.filter((asset) =>
    referencedPaths.has(asset.path),
  );
  for (const asset of selectedAssets) {
    const folded = asset.path.toLocaleLowerCase('en-US');
    const sourceCollision = sourcePaths.get(folded);
    if (sourceCollision) {
      throw new ScadImportError(
        'unsupported_dependency',
        `OpenSCAD project asset ${asset.path} collides with source ${sourceCollision}.`,
      );
    }
    const existingAsset = seenAssetPaths.get(folded);
    if (existingAsset && existingAsset !== asset.path) {
      throw new ScadImportError(
        'unsupported_dependency',
        `OpenSCAD project asset paths differ only by case: ${existingAsset} and ${asset.path}.`,
      );
    }
    seenAssetPaths.set(folded, asset.path);
  }

  return selectedAssets.sort((left, right) =>
    left.path.localeCompare(right.path, 'en-US'),
  );
}

function buildFolderProject(
  files: OpenScadProjectFile[],
  entrypointPath: string,
): OpenScadProject {
  const project = normalizeOpenScadProject({
    schemaVersion: 1,
    entrypointPath,
    files,
  });
  try {
    validateOpenScadProjectSourceReferences(project);
  } catch (error) {
    throw new ScadImportError(
      'unsupported_dependency',
      error instanceof Error
        ? error.message
        : 'The OpenSCAD project contains an invalid source dependency.',
    );
  }
  return project;
}

function chooseAutomaticEntrypoint(project: OpenScadProject): string | null {
  const nonEmptyFiles = project.files.filter((file) => file.content.trim());
  if (nonEmptyFiles.length === 1) return nonEmptyFiles[0].path;

  const topLevelMain = nonEmptyFiles.filter(
    (file) =>
      !file.path.includes('/') && file.path.toLocaleLowerCase('en-US') === 'main.scad',
  );
  if (topLevelMain.length === 1) return topLevelMain[0].path;

  const topLevelFiles = nonEmptyFiles.filter((file) => !file.path.includes('/'));
  if (topLevelFiles.length === 1) return topLevelFiles[0].path;

  const references = validateOpenScadProjectSourceReferences(project);
  const referencedPaths = new Set(
    references.flatMap((reference) =>
      reference.bundledLibrary || !reference.resolvedPath
        ? []
        : [reference.resolvedPath],
    ),
  );
  const dependencyRoots = nonEmptyFiles.filter(
    (file) => !referencedPaths.has(file.path),
  );
  return dependencyRoots.length === 1 ? dependencyRoots[0].path : null;
}

export function decodeScadFolderImportEntries(
  entries: readonly ScadFolderSourceInput[],
): ScadFolderImportResult {
  const sourceEntries = entries.filter((entry) =>
    isSupportedScadFilename(entry.name),
  );
  if (sourceEntries.length === 0) {
    throw new ScadImportError(
      'no_scad_files',
      'The selected folder does not contain any .scad files.',
    );
  }
  if (sourceEntries.length > OPENSCAD_PROJECT_MAX_FILES) {
    throw new ScadImportError(
      'too_many_files',
      `OpenSCAD project exceeds ${OPENSCAD_PROJECT_MAX_FILES} source files.`,
    );
  }

  let totalBytes = 0;
  let root: string | null = null;
  const files: OpenScadProjectFile[] = [];

  for (const entry of sourceEntries) {
    totalBytes += entry.bytes.byteLength;
    if (totalBytes > OPENSCAD_PROJECT_MAX_TOTAL_BYTES) {
      throw new ScadImportError(
        'project_too_large',
        `OpenSCAD project exceeds ${OPENSCAD_PROJECT_MAX_TOTAL_BYTES} UTF-8 bytes.`,
      );
    }

    const resolved = folderProjectPath(entry.relativePath, {
      normalizeScadAlias: true,
    });
    root = assertSingleFolderRoot(root, resolved.root);

    files.push({
      path: resolved.projectPath,
      content: decodeScadSourceBytes(entry.name, entry.bytes, {
        singleFile: false,
      }),
    });
  }

  const assetEntries = entries.filter(
    (entry) =>
      !isSupportedScadFilename(entry.name) &&
      isSupportedScadAssetFilename(entry.name),
  );
  if (assetEntries.length > OPENSCAD_PROJECT_MAX_ASSETS) {
    throw new ScadImportError(
      'too_many_assets',
      `OpenSCAD project exceeds ${OPENSCAD_PROJECT_MAX_ASSETS} supported asset files.`,
    );
  }

  let totalAssetBytes = 0;
  const availableAssets: ScadFolderAssetInput[] = [];
  for (const entry of assetEntries) {
    if (
      entry.bytes.byteLength <= 0 ||
      entry.bytes.byteLength > OPENSCAD_PROJECT_MAX_ASSET_BYTES
    ) {
      throw new ScadImportError(
        'too_large',
        `OpenSCAD asset ${entry.name} must be between 1 and ${OPENSCAD_PROJECT_MAX_ASSET_BYTES} bytes.`,
      );
    }
    totalAssetBytes += entry.bytes.byteLength;
    if (totalAssetBytes > OPENSCAD_PROJECT_MAX_TOTAL_ASSET_BYTES) {
      throw new ScadImportError(
        'assets_too_large',
        `OpenSCAD project assets exceed ${OPENSCAD_PROJECT_MAX_TOTAL_ASSET_BYTES} bytes.`,
      );
    }

    const resolved = folderProjectPath(entry.relativePath, {
      normalizeScadAlias: false,
    });
    root = assertSingleFolderRoot(root, resolved.root);
    availableAssets.push({ path: resolved.projectPath, bytes: entry.bytes });
  }

  const nonEmpty = files.filter((file) => file.content.trim());
  if (nonEmpty.length === 0) {
    throw new ScadImportError(
      'source_too_short',
      'The selected folder has no non-empty OpenSCAD source file to use as an entrypoint.',
    );
  }

  const validationProject = buildFolderProject(files, nonEmpty[0].path);
  const assets = assertFolderProjectDependencies(
    validationProject,
    availableAssets,
  );
  const automaticEntrypoint = chooseAutomaticEntrypoint(validationProject);
  const title = root?.trim() || 'Imported OpenSCAD project';
  const filename = title;

  if (automaticEntrypoint) {
    return {
      kind: 'project',
      title,
      filename,
      project: buildFolderProject(files, automaticEntrypoint),
      assets,
    };
  }

  return {
    kind: 'entrypoint-required',
    pending: {
      title,
      filename,
      files: validationProject.files,
      assets,
      entrypointCandidates: nonEmpty
        .map((file) => file.path)
        .sort((left, right) => left.localeCompare(right, 'en-US')),
    },
  };
}

export async function readScadImportFolder(
  selectedFiles: readonly File[],
): Promise<ScadFolderImportResult> {
  const relevantFiles = selectedFiles.filter(
    (file) =>
      isSupportedScadFilename(file.name) || isSupportedScadAssetFilename(file.name),
  );
  if (!relevantFiles.some((file) => isSupportedScadFilename(file.name))) {
    throw new ScadImportError(
      'no_scad_files',
      'The selected folder does not contain any .scad files.',
    );
  }

  const entries = await Promise.all(
    relevantFiles.map(async (file) => ({
      name: file.name,
      relativePath: file.webkitRelativePath,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
  return decodeScadFolderImportEntries(entries);
}

export function finalizeScadFolderImport(
  pending: PendingScadFolderImport,
  entrypointPath: string,
): OpenScadProject {
  const normalizedEntrypoint = normalizeOpenScadProjectPath(entrypointPath);
  if (!pending.entrypointCandidates.includes(normalizedEntrypoint)) {
    throw new ScadImportError(
      'invalid_entrypoint',
      'Choose one of the OpenSCAD source files from the selected folder as the entrypoint.',
    );
  }
  return buildFolderProject(pending.files, normalizedEntrypoint);
}

export function isBlockingScadCompileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:timed out after|output exceeds|source exceeds|worker error|worker message error|worker terminated|failed to post message)/i.test(
    message,
  );
}

export function boundedScadCompileError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(-MAX_RETAINED_COMPILE_ERROR_CHARS);
}
