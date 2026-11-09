import type { OpenScadProject } from '@shared/openScadProject';

/**
 * Signature hints are intentionally advisory. OpenSCAD's WASM compiler remains
 * authoritative, and external library symbols cannot be resolved here.
 */
export interface OpenScadSignatureHint {
  name: string;
  kind: 'builtin' | 'module' | 'function';
  path: string | null;
  parameters: string[];
  activeParameter: number;
}

interface SignatureRequest {
  source: string;
  cursor: number;
  project?: Pick<OpenScadProject, 'files'>;
  currentPath?: string | null;
}

const BUILTIN_SIGNATURES: Record<string, string[]> = {
  cube: ['size', 'center = false'],
  sphere: ['r', 'd', '$fa', '$fs', '$fn'],
  cylinder: ['h', 'r', 'r1', 'r2', 'd', 'd1', 'd2', 'center = false', '$fn'],
  circle: ['r', 'd', '$fn'],
  square: ['size', 'center = false'],
  translate: ['v'],
  rotate: ['a', 'v'],
  scale: ['v'],
  resize: ['newsize', 'auto = false'],
  mirror: ['v'],
  color: ['c', 'alpha = 1.0'],
  linear_extrude: ['height', 'center = false', 'convexity', 'twist', 'slices', 'scale'],
  rotate_extrude: ['angle', 'convexity', '$fn'],
  projection: ['cut = false'],
  offset: ['r', 'delta', 'chamfer = false'],
  import: ['file', 'convexity', 'layer'],
  surface: ['file', 'center = false', 'invert = false', 'convexity'],
  text: ['text', 'size', 'font', 'halign', 'valign', 'spacing', 'direction', 'language', 'script'],
  polygon: ['points', 'paths', 'convexity'],
  polyhedron: ['points', 'faces', 'convexity'],
  echo: ['...'],
  assert: ['condition', 'message'],
  abs: ['x'],
  sin: ['degrees'],
  cos: ['degrees'],
  tan: ['degrees'],
  sqrt: ['x'],
  pow: ['base', 'exponent'],
  len: ['value'],
  str: ['...'],
  concat: ['...'],
  min: ['...'],
  max: ['...'],
  norm: ['vector'],
  cross: ['a', 'b'],
  lookup: ['key', 'table'],
  search: ['match', 'table', 'num_returns_per_match', 'index_col_num'],
};

/** Replace comments/strings with spaces while retaining character offsets. */
function maskedCode(source: string): { code: string; inNonCode: boolean } {
  const output = source.split('');
  let index = 0;
  let inNonCode = false;
  while (index < source.length) {
    let end: number;
    if (source[index] === '/' && source[index + 1] === '/') {
      end = source.indexOf('\n', index + 2);
      if (end < 0) { end = source.length; inNonCode = true; }
    } else if (source[index] === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      if (close < 0) { end = source.length; inNonCode = true; }
      else end = close + 2;
    } else if (source[index] === '"') {
      let cursor = index + 1;
      let closed = false;
      while (cursor < source.length) {
        if (source[cursor] === '\\') cursor += 2;
        else if (source[cursor] === '"') { cursor++; closed = true; break; }
        else cursor++;
      }
      if (!closed) inNonCode = true;
      end = Math.min(cursor, source.length);
    } else {
      index++;
      continue;
    }
    for (let pos = index; pos < end; pos++) {
      if (output[pos] !== '\n') output[pos] = ' ';
    }
    index = end;
  }
  return { code: output.join(''), inNonCode };
}

interface ParenthesisEntry {
  type: '(' | '[' | '{';
  name: string | null;
  commas: number;
  segmentStart: number;
}

function activeCall(source: string, cursor: number): {
  name: string;
  commas: number;
  argumentText: string;
} | null {
  const { code, inNonCode } = maskedCode(source.slice(0, cursor));
  if (inNonCode) return null;
  const stack: ParenthesisEntry[] = [];
  for (let index = 0; index < code.length; index++) {
    const ch = code[index];
    if (ch === '(') {
      const before = code.slice(0, index);
      const match = before.match(/([$A-Za-z_][$A-Za-z0-9_]*)\s*$/);
      const name = match?.[1] ?? null;
      const declaration = name && /\b(?:module|function)\s+$/.test(before.slice(0, match!.index));
      stack.push({ type: '(', name: declaration ? null : name, commas: 0, segmentStart: index + 1 });
    } else if (ch === '[' || ch === '{') {
      stack.push({ type: ch, name: null, commas: 0, segmentStart: index + 1 });
    } else if (ch === ')'|| ch === ']' || ch === '}') {
      const expected = ch === ')' ? '(' : ch === ']' ? '[' : '{';
      if (stack[stack.length - 1]?.type !== expected) return null;
      stack.pop();
    } else if (ch === ',' && stack[stack.length - 1]?.type === '(') {
      stack[stack.length - 1].commas++;
      stack[stack.length - 1].segmentStart = index + 1;
    }
  }
  for (let index = stack.length - 1; index >= 0; index--) {
    const entry = stack[index];
    if (entry.type === '(' && entry.name) {
      return { name: entry.name, commas: entry.commas, argumentText: code.slice(entry.segmentStart) };
    }
  }
  return null;
}

function declarationSignature(
  project: SignatureRequest['project'],
  currentPath: string | null | undefined,
  currentSource: string,
  name: string,
): Pick<OpenScadSignatureHint, 'parameters' | 'path' | 'kind'> | null {
  if (!project) return null;
  const ordered = [
    ...project.files.filter(file => file.path === currentPath),
    ...project.files.filter(file => file.path !== currentPath),
  ];
  const declaration = /\b(module|function)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const file of ordered) {
    const content = file.path === currentPath ? currentSource : file.content;
    if (content.length > 250_000) continue;
    const code = maskedCode(content).code;
    for (const match of code.matchAll(declaration)) {
      if (match[2] !== name) continue;
      const opening = match.index + match[0].length - 1;
      let depth = 0;
      const start = opening + 1;
      const parts: string[] = [];
      let partStart = start;
      let finished = false;
      for (let i = start; i < code.length; i++) {
        const ch = code[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') {
          if (depth === 0 && ch === ')') {
            parts.push(content.slice(partStart, i).trim());
            finished = true;
            break;
          }
          depth = Math.max(0, depth - 1);
        } else if (ch === ',' && depth === 0) {
          parts.push(content.slice(partStart, i).trim());
          partStart = i + 1;
        }
        if (parts.length > 32) break;
      }
      if (!finished) continue;
      return {
        path: file.path,
        kind: match[1] as 'module' | 'function',
        parameters: parts.filter(Boolean).slice(0, 24).map(value => value.replace(/\s+/g, ' ').slice(0, 100)),
      };
    }
  }
  return null;
}

function parameterName(signature: string): string {
  return signature.match(/^\s*(\$?[A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? '';
}

export function getOpenScadSignatureHelp({
  source,
  cursor,
  project,
  currentPath,
}: SignatureRequest): OpenScadSignatureHint | null {
  if (source.length > 250_000) return null;
  const position = Math.min(source.length, Math.max(0, cursor));
  const call = activeCall(source, position);
  if (!call) return null;
  const fromProject = declarationSignature(project, currentPath, source, call.name);
  const parameters = fromProject?.parameters ?? BUILTIN_SIGNATURES[call.name];
  if (!parameters?.length) return null;
  const named = call.argumentText.match(/^\s*(\$?[A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
  const namedIndex = named ? parameters.findIndex(part => parameterName(part) === named) : -1;
  return {
    name: call.name,
    kind: fromProject?.kind ?? 'builtin',
    path: fromProject?.path ?? null,
    parameters,
    activeParameter: namedIndex >= 0 ? namedIndex : Math.min(call.commas, parameters.length - 1),
  };
}
