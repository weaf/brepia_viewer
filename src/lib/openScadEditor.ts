import type { OpenScadProject } from '@shared/openScadProject';

export type OpenScadCompletionKind =
  | 'keyword'
  | 'builtin'
  | 'module'
  | 'function'
  | 'file';

export interface OpenScadCompletion {
  label: string;
  kind: OpenScadCompletionKind;
  detail: string;
  insertText?: string;
}

export interface OpenScadCompletionContext {
  from: number;
  to: number;
  options: OpenScadCompletion[];
}

export interface OpenScadAutoPairEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

interface CompletionRequest {
  source: string;
  cursor: number;
  project?: OpenScadProject;
  currentPath?: string | null;
  explicit?: boolean;
}

interface AutoPairRequest {
  source: string;
  selectionStart: number;
  selectionEnd: number;
  key: string;
}

const keywordCompletions: OpenScadCompletion[] = [
  'module',
  'function',
  'if',
  'else',
  'for',
  'intersection_for',
  'let',
  'each',
  'true',
  'false',
  'undef',
].map((label) => ({ label, kind: 'keyword', detail: 'OpenSCAD keyword' }));

const builtinModules = [
  'cube',
  'sphere',
  'cylinder',
  'polyhedron',
  'square',
  'circle',
  'polygon',
  'text',
  'surface',
  'import',
  'translate',
  'rotate',
  'scale',
  'resize',
  'mirror',
  'multmatrix',
  'color',
  'offset',
  'hull',
  'minkowski',
  'union',
  'difference',
  'intersection',
  'linear_extrude',
  'rotate_extrude',
  'projection',
  'render',
  'children',
  'echo',
  'assert',
].map((label) => ({
  label,
  kind: 'builtin' as const,
  detail: 'OpenSCAD built-in module',
}));

const builtinFunctions = [
  'abs',
  'sign',
  'sin',
  'cos',
  'tan',
  'acos',
  'asin',
  'atan',
  'atan2',
  'floor',
  'round',
  'ceil',
  'ln',
  'log',
  'pow',
  'sqrt',
  'exp',
  'rands',
  'min',
  'max',
  'norm',
  'cross',
  'concat',
  'lookup',
  'search',
  'str',
  'chr',
  'ord',
  'len',
  'version',
  'version_num',
  'parent_module',
  'is_undef',
  'is_bool',
  'is_num',
  'is_string',
  'is_list',
  'is_function',
].map((label) => ({
  label,
  kind: 'builtin' as const,
  detail: 'OpenSCAD built-in function',
}));

const specialVariables = ['$fa', '$fn', '$fs', '$preview', '$t', '$vpr', '$vpt', '$vpd', '$vpf'].map(
  (label) => ({
    label,
    kind: 'builtin' as const,
    detail: 'OpenSCAD special variable',
  }),
);

const staticCompletions = [
  ...keywordCompletions,
  ...builtinModules,
  ...builtinFunctions,
  ...specialVariables,
];

function projectDefinitions(project?: OpenScadProject): OpenScadCompletion[] {
  if (!project) return [];

  const definitions: OpenScadCompletion[] = [];
  const seen = new Set<string>();
  const definitionPattern = /\b(module|function)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  for (const file of project.files) {
    definitionPattern.lastIndex = 0;
    for (const match of file.content.matchAll(definitionPattern)) {
      const declaration = match[1];
      const label = match[2];
      const key = `${declaration}:${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      definitions.push({
        label,
        kind: declaration === 'module' ? 'module' : 'function',
        detail: `${declaration === 'module' ? 'Module' : 'Function'} from ${file.path}`,
      });
    }
  }

  return definitions;
}

function rankOptions(
  options: OpenScadCompletion[],
  query: string,
): OpenScadCompletion[] {
  const normalizedQuery = query.toLowerCase();
  const seen = new Set<string>();

  return options
    .filter((option) => {
      const key = option.label.toLowerCase();
      if (seen.has(key)) return false;
      if (normalizedQuery && !key.includes(normalizedQuery)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aLabel = a.label.toLowerCase();
      const bLabel = b.label.toLowerCase();
      const aStarts = aLabel.startsWith(normalizedQuery);
      const bStarts = bLabel.startsWith(normalizedQuery);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;

      const aProject = a.kind === 'module' || a.kind === 'function';
      const bProject = b.kind === 'module' || b.kind === 'function';
      if (aProject !== bProject) return aProject ? -1 : 1;

      return a.label.localeCompare(b.label);
    })
    .slice(0, 10);
}

export function applyOpenScadAutoPair({
  source,
  selectionStart,
  selectionEnd,
  key,
}: AutoPairRequest): OpenScadAutoPairEdit | null {
  const start = Math.max(0, Math.min(selectionStart, source.length));
  const end = Math.max(start, Math.min(selectionEnd, source.length));

  if ((key === ')' || key === '>') && start === end && source[start] === key) {
    return {
      value: source,
      selectionStart: start + 1,
      selectionEnd: start + 1,
    };
  }

  const close = key === '(' ? ')' : key === '<' ? '>' : null;
  if (!close) return null;

  if (key === '<') {
    const beforeSelection = source.slice(0, start);
    if (!/\b(?:include|use)\s*$/.test(beforeSelection)) return null;
  }

  const selected = source.slice(start, end);
  const value =
    source.slice(0, start) + key + selected + close + source.slice(end);

  if (start !== end) {
    return {
      value,
      selectionStart: start + 1,
      selectionEnd: end + 1,
    };
  }

  return {
    value,
    selectionStart: start + 1,
    selectionEnd: start + 1,
  };
}

export function getOpenScadCompletionContext({
  source,
  cursor,
  project,
  currentPath,
  explicit = false,
}: CompletionRequest): OpenScadCompletionContext {
  const boundedCursor = Math.max(0, Math.min(cursor, source.length));
  const beforeCursor = source.slice(0, boundedCursor);
  const includeMatch = beforeCursor.match(/\b(?:include|use)\s*<([^>]*)$/);

  if (includeMatch) {
    const query = includeMatch[1];
    const from = boundedCursor - query.length;
    const options = (project?.files ?? [])
      .filter((file) => file.path !== currentPath)
      .map((file) => ({
        label: file.path,
        insertText: file.path,
        kind: 'file' as const,
        detail: 'Project source file',
      }))
      .filter((option) =>
        option.label.toLowerCase().includes(query.toLowerCase()),
      )
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, 10);

    return { from, to: boundedCursor, options };
  }

  const wordMatch = beforeCursor.match(/[$A-Za-z_][$A-Za-z0-9_]*$/);
  const query = wordMatch?.[0] ?? '';
  const from = boundedCursor - query.length;

  if (!explicit && query.length < 2) {
    return { from, to: boundedCursor, options: [] };
  }

  return {
    from,
    to: boundedCursor,
    options: rankOptions(
      [...projectDefinitions(project), ...staticCompletions],
      query,
    ),
  };
}
