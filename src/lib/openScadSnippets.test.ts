import { describe, expect, it } from 'vitest';
import { insertOpenScadSnippet, openScadSnippets } from './openScadSnippets';

describe('OpenSCAD toolbar snippets', () => {
  it('provides 18 individually named snippets', () => {
    expect(openScadSnippets).toHaveLength(18);
    expect(new Set(openScadSnippets.map(item => item.id)).size).toBe(18);
  });

  it('inserts a complete cube statement', () => {
    const cube = openScadSnippets.find(item => item.id === 'cube')!;
    expect(insertOpenScadSnippet(cube)).toBe('cube([10, 10, 10], center = true);');
  });

  it('wraps the original marked code in a transformation', () => {
    const translate = openScadSnippets.find(item => item.id === 'translate')!;
    expect(insertOpenScadSnippet(translate, 'cube([10, 10, 10]);')).toBe(
      'translate([10, 0, 0]) {\n    cube([10, 10, 10]);\n}',
    );
  });

  it('keeps multiline selected content intact', () => {
    const difference = openScadSnippets.find(item => item.id === 'difference')!;
    expect(insertOpenScadSnippet(difference, 'cube(10);\n  sphere(5);')).toContain(
      '    cube(10);\n      sphere(5);',
    );
  });
});
