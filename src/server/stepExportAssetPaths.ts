import {
  normalizeOpenScadProject,
  type OpenScadProject,
} from '@shared/openScadProject';
import { collectOpenScadProjectAssetReferences } from '@shared/openScadProjectReferences';

const STEP_SANDBOX_PROJECT_ROOT = '/input/project';

type ArgumentRange = {
  start: number;
  end: number;
};

type StringLiteral = {
  value: string;
  start: number;
  end: number;
};

type AssetCall = {
  kind: 'import' | 'surface';
  target: string | null;
  literal: StringLiteral | null;
};

function skipTrivia(
  source: string,
  start: number,
  limit = source.length,
): number {
  let index = start;
  while (index < limit) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }

    if (source[index] === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < limit && source[index] !== '\n') index += 1;
      continue;
    }

    if (source[index] === '/' && source[index + 1] === '*') {
      index += 2;
      while (
        index < limit &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        index += 1;
      }
      if (index < limit) index += 2;
      continue;
    }

    break;
  }

  return index;
}

function readStringLiteral(
  source: string,
  start: number,
): StringLiteral | null {
  if (source[start] !== '"') return null;

  let value = '';
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];

    if (character === '"') {
      return {
        value,
        start,
        end: index + 1,
      };
    }

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
): { args: ArgumentRange[]; end: number } {
  const args: ArgumentRange[] = [];
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
      if (!literal) throw new Error('Unterminated STEP asset string literal.');
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
        if (source.slice(argumentStart, index).trim() || args.length > 0) {
          args.push({ start: argumentStart, end: index });
        }
        return { args, end: index + 1 };
      }
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (
      character === ',' &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      args.push({ start: argumentStart, end: index });
      argumentStart = index + 1;
    }

    index += 1;
  }

  throw new Error('Unterminated STEP import()/surface() call.');
}

function literalExpression(
  source: string,
  range: ArgumentRange,
): StringLiteral | null {
  const start = skipTrivia(source, range.start, range.end);
  const literal = readStringLiteral(source, start);
  if (!literal || literal.end > range.end) return null;

  const tail = skipTrivia(source, literal.end, range.end);
  return tail === range.end ? literal : null;
}

function fileLiteral(
  source: string,
  args: ArgumentRange[],
): StringLiteral | null {
  const named: StringLiteral[] = [];

  for (const range of args) {
    const raw = source.slice(range.start, range.end);
    const match = /^\s*file\s*=/i.exec(raw);
    if (!match) continue;

    const literal = literalExpression(source, {
      start: range.start + match[0].length,
      end: range.end,
    });
    if (literal) named.push(literal);
  }

  if (named.length === 1) return named[0];
  if (named.length > 1 || args.length === 0) return null;
  return literalExpression(source, args[0]);
}

function collectAssetCalls(source: string): AssetCall[] {
  const calls: AssetCall[] = [];
  let index = 0;

  while (index < source.length) {
    index = skipTrivia(source, index);
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

    const openParen = skipTrivia(source, index);
    if (source[openParen] !== '(') continue;

    const call = splitCallArguments(source, openParen);
    const literal = fileLiteral(source, call.args);
    calls.push({
      kind: word,
      target: literal?.value ?? null,
      literal,
    });
    index = call.end;
  }

  return calls;
}

export function rewriteOpenScadProjectAssetReferencesForStepSandbox(
  project: OpenScadProject,
): OpenScadProject {
  const normalized = normalizeOpenScadProject(project);
  if (!normalized.assets?.length) return normalized;

  const references = collectOpenScadProjectAssetReferences(normalized);
  const rewrittenFiles = normalized.files.map((file) => {
    const expected = references.filter(
      (reference) => reference.sourcePath === file.path,
    );
    if (expected.length === 0) return file;

    const actual = collectAssetCalls(file.content);
    if (actual.length !== expected.length) {
      throw new Error(`STEP asset rewrite could not reconcile ${file.path}.`);
    }

    const edits: Array<{ start: number; end: number; text: string }> = [];

    for (let index = 0; index < expected.length; index += 1) {
      const reference = expected[index];
      const call = actual[index];

      if (
        call.kind !== reference.kind ||
        call.target !== reference.target ||
        !call.literal ||
        !reference.resolvedPath
      ) {
        throw new Error(
          `STEP asset rewrite could not reconcile ${reference.kind}() in ${file.path}.`,
        );
      }

      edits.push({
        start: call.literal.start,
        end: call.literal.end,
        text: JSON.stringify(
          `${STEP_SANDBOX_PROJECT_ROOT}/${reference.resolvedPath}`,
        ),
      });
    }

    let content = file.content;
    for (const edit of edits.reverse()) {
      content =
        content.slice(0, edit.start) + edit.text + content.slice(edit.end);
    }

    return { ...file, content };
  });

  return normalizeOpenScadProject({
    ...normalized,
    files: rewrittenFiles,
  });
}
