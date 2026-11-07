import { describe, expect, it } from 'vitest';
import { insertOpenScadSnippet, openScadSnippets, snippetCategories } from './openScadSnippets';

describe('OpenSCAD toolbar snippets', () => {
  it('provides 57 accessible built-ins and 9 nonempty categories', () => {
    expect(openScadSnippets).toHaveLength(57);
    expect(snippetCategories).toHaveLength(9);
    expect(snippetCategories.every(category => openScadSnippets.some(item => item.category === category))).toBe(true);
    expect(openScadSnippets.every(item => item.description.trim() && item.icon.trim())).toBe(true);
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
  it('offers ready-made models and proper file reference commands', () => {
    const tube = openScadSnippets.find(item => item.id === 'tube')!;
    expect(insertOpenScadSnippet(tube)).toContain('difference()');
    expect(insertOpenScadSnippet(tube)).toContain('cylinder(');
    const include = openScadSnippets.find(item => item.id === 'include')!;
    expect(insertOpenScadSnippet(include)).toBe('include <lib/shared.scad>;');
    const libUse = openScadSnippets.find(item => item.id === 'use')!;
    expect(insertOpenScadSnippet(libUse)).toBe('use <lib/shared.scad>;');
  });

  it('allows the same wrap behavior for new transformation commands', () => {
    const resize = openScadSnippets.find(item => item.id === 'resize')!;
    expect(insertOpenScadSnippet(resize, 'sphere(5);')).toBe(
      'resize([20, 15, 10]) {\\n    sphere(5);\\n}',
    );
  });

});
