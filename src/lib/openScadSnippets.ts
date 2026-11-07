export type OpenScadSnippetCategory =
  | 'Primitives'
  | 'Transformations'
  | 'Boolean operations'
  | 'Programming';

export interface OpenScadSnippet {
  id: string;
  label: string;
  category: OpenScadSnippetCategory;
  insert?: string;
  wrap?: string;
  body?: string;
}

export const openScadSnippets: readonly OpenScadSnippet[] = [
  { id: 'cube', label: 'Cube', category: 'Primitives', insert: 'cube([10, 10, 10], center = true);' },
  { id: 'sphere', label: 'Sphere', category: 'Primitives', insert: 'sphere(r = 10);' },
  { id: 'cylinder', label: 'Cylinder', category: 'Primitives', insert: 'cylinder(h = 20, r = 5, center = true);' },
  { id: 'translate', label: 'Translate', category: 'Transformations', wrap: 'translate([10, 0, 0])', body: 'cube([10, 10, 10]);' },
  { id: 'rotate', label: 'Rotate', category: 'Transformations', wrap: 'rotate([0, 0, 45])', body: 'cube([10, 10, 10]);' },
  { id: 'scale', label: 'Scale', category: 'Transformations', wrap: 'scale([1, 1, 1])', body: 'cube([10, 10, 10]);' },
  { id: 'mirror', label: 'Mirror', category: 'Transformations', wrap: 'mirror([1, 0, 0])', body: 'cube([10, 10, 10]);' },
  { id: 'union', label: 'Union', category: 'Boolean operations', wrap: 'union()', body: 'cube(10);\nsphere(5);' },
  { id: 'difference', label: 'Difference', category: 'Boolean operations', wrap: 'difference()', body: 'cube(20);\nsphere(9);' },
  { id: 'intersection', label: 'Intersection', category: 'Boolean operations', wrap: 'intersection()', body: 'cube(20);\nsphere(13);' },
  { id: 'color', label: 'Color', category: 'Programming', wrap: 'color("steelblue")', body: 'cube(10);' },
  { id: 'linear-extrude', label: 'Linear extrude', category: 'Programming', wrap: 'linear_extrude(height = 10)', body: 'circle(r = 5);' },
  { id: 'rotate-extrude', label: 'Rotate extrude', category: 'Programming', wrap: 'rotate_extrude(angle = 360)', body: 'translate([10, 0, 0]) circle(r = 2);' },
  { id: 'module', label: 'Module', category: 'Programming', wrap: 'module my_part(size = 10)', body: 'cube(size);' },
  { id: 'function', label: 'Function', category: 'Programming', insert: 'function double_value(x) = x * 2;' },
  { id: 'for', label: 'For loop', category: 'Programming', wrap: 'for (i = [0:4])', body: 'translate([i * 10, 0, 0]) sphere(r = 3);' },
  { id: 'if-else', label: 'If / else', category: 'Programming', insert: 'if (true) {\n    cube(10);\n} else {\n    sphere(5);\n}' },
  { id: 'parameter', label: 'Parameter', category: 'Programming', insert: 'width = 30; // [10:1:100]' },
] as const;

export const snippetCategories: readonly OpenScadSnippetCategory[] = [
  'Primitives', 'Transformations', 'Boolean operations', 'Programming',
];

export function insertOpenScadSnippet(snippet: OpenScadSnippet, selected = ''): string {
  if (snippet.insert !== undefined) return snippet.insert;
  if (!snippet.wrap) return '';
  const body = selected || snippet.body || '';
  // Preserve the user's existing indentation rather than flattening it.
  const indented = body.split('\n').map(line => line.trim() ? '    ' + line : line).join('\n');
  return snippet.wrap + ' {\n' + indented + '\n}';
}
