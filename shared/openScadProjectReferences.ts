import {
  isOpenScadProjectAssetPathSupportedForKind,
  normalizeOpenScadProject,
  normalizeOpenScadProjectPath,
  type OpenScadProject,
} from './openScadProject.ts';

const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:[\\/]/;
const BUNDLED_LIBRARY_ROOTS = new Set(['BOSL', 'BOSL2', 'MCAD']);

export type OpenScadProjectSourceReference = {
  kind: 'include' | 'use';
  sourcePath: string;
  target: string;
  resolvedPath: string | null;
  bundledLibrary: boolean;
};

export type OpenScadProjectAssetReference = {
  kind: 'import' | 'surface';
  sourcePath: string;
  target: string | null;
  resolvedPath: string | null;
  dynamic: boolean;
};

export class OpenScadProjectReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenScadProjectReferenceError';
  }
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

export function stripOpenScadStringsAndComments(source: string): string {
  let out = '';
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (character === '"') {
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

    if (character === '/' && next === '/') {
      out += '  ';
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        out += ' ';
        index += 1;
      }
      continue;
    }

    if (character === '/' && next === '*') {
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

    out += character;
    index += 1;
  }

  return out;
}

export function resolveOpenScadProjectReference(
  sourcePath: string,
  target: string,
): string {
  const normalizedSource = normalizeOpenScadProjectPath(sourcePath);
  const trimmedTarget = target.trim();
  if (!trimmedTarget || hasControlCharacter(trimmedTarget)) {
    throw new OpenScadProjectReferenceError(
      `Invalid OpenSCAD project reference in ${normalizedSource}: ${target}`,
    );
  }
  if (
    trimmedTarget.startsWith('/') ||
    WINDOWS_DRIVE_PATTERN.test(trimmedTarget)
  ) {
    throw new OpenScadProjectReferenceError(
      `OpenSCAD project reference must stay relative to the project: ${target}`,
    );
  }

  const targetSegments = trimmedTarget.replace(/\\/g, '/').split('/');
  const sourceSegments = normalizedSource.split('/');
  sourceSegments.pop();
  const resolved = [...sourceSegments];

  for (const segment of targetSegments) {
    if (!segment || segment !== segment.trim()) {
      throw new OpenScadProjectReferenceError(
        `Invalid OpenSCAD project reference in ${normalizedSource}: ${target}`,
      );
    }
    if (segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) {
        throw new OpenScadProjectReferenceError(
          `OpenSCAD project reference escapes project root: ${target}`,
        );
      }
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  if (resolved.length === 0) {
    throw new OpenScadProjectReferenceError(
      `OpenSCAD project reference does not resolve to a file: ${target}`,
    );
  }
  return normalizeOpenScadProjectPath(resolved.join('/'));
}

export function collectOpenScadProjectSourceReferences(
  project: OpenScadProject,
): OpenScadProjectSourceReference[] {
  const normalized = normalizeOpenScadProject(project);
  const references: OpenScadProjectSourceReference[] = [];

  for (const file of normalized.files) {
    const active = stripOpenScadStringsAndComments(file.content);
    const includeUseRegex = /\b(include|use)\s*<([^>\r\n]+)>/g;
    let match: RegExpExecArray | null;

    while ((match = includeUseRegex.exec(active)) !== null) {
      const kind = match[1] as 'include' | 'use';
      const target = match[2].trim();
      const root = target.replace(/\\/g, '/').split('/', 1)[0];
      const bundledLibrary = BUNDLED_LIBRARY_ROOTS.has(root);
      references.push({
        kind,
        sourcePath: file.path,
        target,
        resolvedPath: bundledLibrary
          ? null
          : resolveOpenScadProjectReference(file.path, target),
        bundledLibrary,
      });
    }
  }

  return references;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        index += 1;
      }
      if (index < source.length) index += 2;
      continue;
    }
    break;
  }
  return index;
}

function readStringLiteral(
  source: string,
  start: number,
): { value: string; end: number } | null {
  if (source[start] !== '"') return null;
  let value = '';
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === '"') return { value, end: index + 1 };
    if (character === '\\') {
      const next = source[index + 1];
      if (next == null) return null;
      if (next === 'n') value += '\n';
      else if (next === 'r') value += '\r';
      else if (next === 't') value += '\t';
      else value += next;
      index += 2;
      continue;
    }
    value += character;
    index += 1;
  }
  return null;
}

function splitCallArguments(
  source: string,
  openParen: number,
): { args: string[]; end: number } {
  const args: string[] = [];
  let argumentStart = openParen + 1;
  let index = openParen + 1;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '"') {
      const literal = readStringLiteral(source, index);
      if (!literal) {
        throw new OpenScadProjectReferenceError(
          'Unterminated string in OpenSCAD asset reference.',
        );
      }
      index = literal.end;
      continue;
    }
    if (character === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        index += 1;
      }
      if (index < source.length) index += 2;
      continue;
    }

    if (character === '(') parenDepth += 1;
    else if (character === '[') bracketDepth += 1;
    else if (character === '{') braceDepth += 1;
    else if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (character === ')') {
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        const tail = source.slice(argumentStart, index).trim();
        if (tail || args.length > 0) args.push(tail);
        return { args, end: index + 1 };
      }
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (
      character === ',' &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      args.push(source.slice(argumentStart, index).trim());
      argumentStart = index + 1;
    }
    index += 1;
  }

  throw new OpenScadProjectReferenceError(
    'Unterminated OpenSCAD import()/surface() call.',
  );
}

function literalFileArgument(args: string[]): string | null {
  const named = args
    .map((argument) => /^\s*file\s*=([\s\S]*)$/i.exec(argument))
    .filter((match): match is RegExpExecArray => !!match);
  const expression = named.length === 1 ? named[0][1] : named.length > 1 ? '' : args[0];
  if (!expression) return null;
  const trimmed = expression.trim();
  const literal = readStringLiteral(trimmed, 0);
  if (!literal || trimmed.slice(literal.end).trim()) return null;
  return literal.value;
}

function collectAssetReferencesFromSource(
  sourcePath: string,
  source: string,
): OpenScadProjectAssetReference[] {
  const references: OpenScadProjectAssetReference[] = [];
  let index = 0;

  while (index < source.length) {
    index = skipWhitespaceAndComments(source, index);
    if (index >= source.length) break;

    if (source[index] === '"') {
      const literal = readStringLiteral(source, index);
      index = literal?.end ?? index + 1;
      continue;
    }

    if (!/[A-Za-z_]/.test(source[index])) {
      index += 1;
      continue;
    }

    const wordStart = index;
    index += 1;
    while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) {
      index += 1;
    }
    const word = source.slice(wordStart, index);
    if (word !== 'import' && word !== 'surface') continue;

    const openParen = skipWhitespaceAndComments(source, index);
    if (source[openParen] !== '(') continue;
    const call = splitCallArguments(source, openParen);
    const target = literalFileArgument(call.args);
    references.push({
      kind: word,
      sourcePath,
      target,
      resolvedPath: target
        ? resolveOpenScadProjectReference(sourcePath, target)
        : null,
      dynamic: target === null,
    });
    index = call.end;
  }

  return references;
}

export function collectOpenScadProjectAssetReferences(
  project: OpenScadProject,
): OpenScadProjectAssetReference[] {
  const normalized = normalizeOpenScadProject(project);
  return normalized.files.flatMap((file) =>
    collectAssetReferencesFromSource(file.path, file.content),
  );
}

export function validateOpenScadProjectSourceReferences(
  project: OpenScadProject,
): OpenScadProjectSourceReference[] {
  const normalized = normalizeOpenScadProject(project);
  const projectPaths = new Set(normalized.files.map((file) => file.path));
  const references = collectOpenScadProjectSourceReferences(normalized);

  for (const reference of references) {
    if (reference.bundledLibrary) continue;
    if (!reference.resolvedPath || !projectPaths.has(reference.resolvedPath)) {
      throw new OpenScadProjectReferenceError(
        `${reference.kind} <${reference.target}> in ${reference.sourcePath} does not resolve to a project file.`,
      );
    }
  }

  return references;
}

export function validateOpenScadProjectAssetReferences(
  project: OpenScadProject,
): OpenScadProjectAssetReference[] {
  const normalized = normalizeOpenScadProject(project);
  const assetPaths = new Set((normalized.assets ?? []).map((asset) => asset.path));
  const references = collectOpenScadProjectAssetReferences(normalized);

  for (const reference of references) {
    if (reference.dynamic || !reference.target || !reference.resolvedPath) {
      throw new OpenScadProjectReferenceError(
        `${reference.kind}(...) in ${reference.sourcePath} uses a dynamic file argument. Relative assets must use a literal filename.`,
      );
    }
    if (
      !isOpenScadProjectAssetPathSupportedForKind(
        reference.resolvedPath,
        reference.kind,
      )
    ) {
      throw new OpenScadProjectReferenceError(
        `${reference.kind}("${reference.target}") in ${reference.sourcePath} uses an unsupported asset format.`,
      );
    }
    if (!assetPaths.has(reference.resolvedPath)) {
      throw new OpenScadProjectReferenceError(
        `${reference.kind}("${reference.target}") in ${reference.sourcePath} does not resolve to a project asset.`,
      );
    }
  }

  return references;
}

export function validateOpenScadProjectReferences(project: OpenScadProject): {
  sources: OpenScadProjectSourceReference[];
  assets: OpenScadProjectAssetReference[];
} {
  return {
    sources: validateOpenScadProjectSourceReferences(project),
    assets: validateOpenScadProjectAssetReferences(project),
  };
}

export function openScadProjectUsesBundledLibrary(
  project: OpenScadProject,
  libraryName: string,
): boolean {
  return collectOpenScadProjectSourceReferences(project).some(
    (reference) =>
      reference.bundledLibrary &&
      reference.target.replace(/\\/g, '/').split('/', 1)[0] === libraryName,
  );
}
