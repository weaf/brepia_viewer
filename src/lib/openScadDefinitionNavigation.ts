import type { OpenScadProject } from '@shared/openScadProject';

/**
 * Bounded project-local OpenSCAD navigation. This is intentionally a
 * conservative symbol index, not a full OpenSCAD compiler/LSP.
 */
export interface OpenScadDefinitionTarget {
  path: string;
  offset: number;
  name: string;
  kind: 'module' | 'function' | 'variable' | 'parameter';
}

const LIMIT = 2_000_000;
type Delimiter = {
  open: number;
  close: number;
  char: '(' | '[' | '{';
  role: 'parameters' | 'let' | 'for' | 'other';
  ownerBlock?: Delimiter;
};
type Declaration = {
  name: string;
  offset: number;
  kind: OpenScadDefinitionTarget['kind'];
  block?: Delimiter;
  owner?: Delimiter;
};

// Keep original offsets while hiding comments and quoted string literals.
function visibleCode(source: string): string {
  const chars = source.split('');
  for (let i = 0; i < chars.length;) {
    if (source[i] === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i + 2);
      const stop = end < 0 ? source.length : end;
      for (; i < stop; i++) chars[i] = ' ';
    } else if (source[i] === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      for (; i < stop; i++) if (chars[i] !== '\n') chars[i] = ' ';
    } else if (source[i] === '"') {
      let end = i + 1;
      while (end < source.length) {
        if (source[end] === '\\') end += 2;
        else if (source[end++] === '"') break;
      }
      const stop = Math.min(end, source.length);
      for (; i < stop; i++) if (chars[i] !== '\n') chars[i] = ' ';
    } else i++;
  }
  return chars.join('');
}

function wordAtCursor(code: string, cursor: number): { name: string; end: number } | null {
  let pos = Math.max(0, Math.min(cursor, code.length));
  const wordPart = (value: string | undefined) => !!value && /[$A-Za-z0-9_]/.test(value);
  if (!wordPart(code[pos]) && wordPart(code[pos - 1])) pos--;
  if (!wordPart(code[pos])) return null;
  let start = pos;
  let end = pos + 1;
  while (start > 0 && wordPart(code[start - 1])) start--;
  while (end < code.length && wordPart(code[end])) end++;
  const name = code.slice(start, end);
  return /^[$A-Za-z_][$A-Za-z0-9_]*$/.test(name) ? { name, end } : null;
}

function afterBody(code: string, frame: Delimiter, pairs: Map<number, number>): number {
  if (frame.close < 0) return code.length;
  let i = frame.close + 1;
  while (i < code.length && /\s/.test(code[i])) i++;
  if (code[i] === '{') return pairs.get(i) ?? code.length;
  let depth = 0;
  for (; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return i;
      depth--;
    } else if ((ch === ';' || ch === ',') && depth === 0) return i + 1;
  }
  return code.length;
}

function declarationIndex(code: string): {
  declarations: Declaration[];
  bounds: (entry: Declaration) => { from: number; to: number };
} {
  const stack: Delimiter[] = [];
  const frames: Delimiter[] = [];
  const pairs = new Map<number, number>();
  const declarations: Declaration[] = [];
  const isStart = (c: string | undefined) => !!c && /[$A-Za-z_]/.test(c);
  const isPart = (c: string | undefined) => !!c && /[$A-Za-z0-9_]/.test(c);
  const nearestBrace = () => [...stack].reverse().find(frame => frame.char === '{');
  const nearestParen = () => [...stack].reverse().find(frame => frame.char === '(');

  for (let i = 0; i < code.length;) {
    const ch = code[i];
    if (isStart(ch)) {
      let end = i + 1;
      while (end < code.length && isPart(code[end])) end++;
      let eq = end;
      while (eq < code.length && /\s/.test(code[eq])) eq++;
      if (code[eq] === '=' && code[eq + 1] !== '=') {
        const parent = nearestParen();
        // Within a call, "=" is a named argument, not a declaration.
        // Parameter, let and for binding lists are handled below.
        if (!parent) {
          declarations.push({
            name: code.slice(i, end), offset: i, kind: 'variable', block: nearestBrace(),
          });
        }
      }
      i = end;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      let role: Delimiter['role'] = 'other';
      const before = ch === '(' ? code.slice(Math.max(0, i - 160), i) : '';
      const declaration = before.match(/\b(module|function)\s+([$A-Za-z_][$A-Za-z0-9_]*)\s*$/);
      if (ch === '(' && declaration) {
        role = 'parameters';
        const localOffset = before.lastIndexOf(declaration[2]);
        declarations.push({
          name: declaration[2],
          offset: i - before.length + localOffset,
          kind: declaration[1] as 'module' | 'function',
          block: nearestBrace(),
        });
      } else if (ch === '(' && /\b(let)\s*$/.test(before)) role = 'let';
      else if (ch === '(' && /\b(for|intersection_for)\s*$/.test(before)) role = 'for';
      const frame: Delimiter = {
        open: i, close: -1, char: ch, role, ownerBlock: nearestBrace(),
      };
      stack.push(frame);
      frames.push(frame);
    } else if (ch === ')' || ch === ']' || ch === '}') {
      const match = ch === ')' ? '(' : ch === ']' ? '[' : '{';
      if (stack.at(-1)?.char === match) {
        const frame = stack.pop()!;
        frame.close = i;
        pairs.set(frame.open, i);
      }
    }
    i++;
  }

  // Identify each top-level argument in a binding list without treating a
  // nested function call's named arguments as variables.
  for (const frame of frames) {
    if (frame.char !== '(' || frame.close < 0 || frame.role === 'other') continue;
    let segmentStart = frame.open + 1;
    let depth = 0;
    const add = (end: number) => {
      const segment = code.slice(segmentStart, end);
      const match = segment.match(/^\s*([$A-Za-z_][$A-Za-z0-9_]*)(\s*)(.*)$/s);
      if (!match) return;
      if (frame.role !== 'parameters' && !match[3].startsWith('=')) return;
      if (frame.role === 'parameters' && match[3] && !match[3].startsWith('=')) return;
      declarations.push({
        name: match[1],
        offset: segmentStart + segment.indexOf(match[1]),
        kind: frame.role === 'parameters' ? 'parameter' : 'variable',
        owner: frame,
      });
    };
    for (let i = segmentStart; i < frame.close; i++) {
      const ch = code[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      else if (ch === ',' && depth === 0) {
        add(i);
        segmentStart = i + 1;
      }
    }
    add(frame.close);
  }

  return {
    declarations,
    bounds(entry) {
      if (entry.owner) return {
        from: entry.owner.open,
        to: afterBody(code, entry.owner, pairs),
      };
      if (entry.block) return {
        from: entry.block.open,
        to: entry.block.close < 0 ? code.length : entry.block.close,
      };
      return { from: 0, to: code.length };
    },
  };
}

/**
 * Modules/functions, variables including $fn, parameter defaults, let and
 * for bindings. Restricts local definitions to their lexical body and only
 * searches global definitions in other project files.
 */
export function findOpenScadProjectDefinition(
  project: Pick<OpenScadProject, 'files'> | undefined,
  currentPath: string | null | undefined,
  source: string,
  cursor: number,
): OpenScadDefinitionTarget | null {
  if (!project || !currentPath || source.length > LIMIT) return null;
  const masked = visibleCode(source);
  const word = wordAtCursor(masked, cursor);
  if (!word) return null;
  const call = /^\s*\(/.test(masked.slice(word.end));
  const files = [
    { path: currentPath, content: source },
    ...project.files.filter(file => file.path !== currentPath),
  ];
  for (const file of files) {
    if (file.content.length > LIMIT) continue;
    const code = file.path === currentPath ? masked : visibleCode(file.content);
    const index = declarationIndex(code);
    const local = file.path === currentPath;
    const candidates = index.declarations.filter(item => {
      if (item.name !== word.name) return false;
      const scope = index.bounds(item);
      return local
        ? scope.from <= cursor && cursor <= scope.to
        : scope.from === 0 && scope.to === code.length;
    });
    if (!candidates.length) continue;
    const kinds = call ? ['module', 'function'] : ['variable', 'parameter'];
    const preferred = candidates.filter(item => kinds.includes(item.kind));
    const viable = preferred.length ? preferred : candidates;
    viable.sort((a, b) => {
      const ra = index.bounds(a), rb = index.bounds(b);
      const span = (ra.to - ra.from) - (rb.to - rb.from);
      if (span !== 0) return span;
      const distance = (entry: Declaration) =>
        entry.offset <= cursor ? cursor - entry.offset : code.length + entry.offset - cursor;
      return local ? distance(a) - distance(b) : a.offset - b.offset;
    });
    const selected = viable[0];
    return { path: file.path, offset: selected.offset, kind: selected.kind, name: selected.name };
  }
  return null;
}

\n
