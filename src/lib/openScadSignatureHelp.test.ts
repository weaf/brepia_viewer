import { describe, expect, it } from 'vitest';
import { getOpenScadSignatureHelp as hint } from './openScadSignatureHelp';

describe('OpenSCAD signature hints', () => {
  it('recognizes position in built-in signatures', () => {
    expect(hint({ source: 'cube([2,3,4], center=', cursor: 22 })).toMatchObject({
      name: 'cube', kind: 'builtin', activeParameter: 1,
    });
    expect(hint({ source: 'rotate([0,0,90])', cursor: 8 })?.activeParameter).toBe(0);
  });

  it('ignores commas in nested arrays, calls and strings', () => {
    const source = 'cube([max(2, 3), 4], center = ';
    expect(hint({ source, cursor: source.length })?.activeParameter).toBe(1);
    const text = 'text("a,b", size = ';
    expect(hint({ source: text, cursor: text.length })?.activeParameter).toBe(1);
  });

  it('resolves named parameters irrespective of ordering', () => {
    const source = 'cylinder(center=true, h=';
    const result = hint({ source, cursor: source.length });
    expect(result?.name).toBe('cylinder');
    expect(result?.parameters[result.activeParameter]).toBe('h');
  });

  it('resolves project module definitions including defaults and nested expressions', () => {
    const project = { files: [
      { path: 'main.scad', content: 'use <lib.scad>\npin(h = 8, radius = ' },
      { path: 'lib.scad', content: 'module pin(radius=2, h=max(4,8), colorName="red,blue") { cylinder(h=h, r=radius); }' },
    ] };
    const source = project.files[0].content;
    const result = hint({ source, cursor: source.length, project, currentPath: 'main.scad' });
    expect(result).toMatchObject({ name: 'pin', kind: 'module', path: 'lib.scad', activeParameter: 0 });
    expect(result?.parameters).toEqual(['radius=2', 'h=max(4,8)', 'colorName="red,blue"']);
  });

  it('prefers user function signatures from the current unsaved draft', () => {
    const draft = 'function lever(x, y=2) = x+y;\nlever(1, ';
    const project = { files: [{ path: 'main.scad', content: 'function lever(z) = z;' }] };
    const result = hint({ source: draft, cursor: draft.length, currentPath: 'main.scad', project });
    expect(result).toMatchObject({ name: 'lever', kind: 'function', activeParameter: 1 });
    expect(result?.parameters).toEqual(['x', 'y=2']);
  });

  it('does not offer hints inside strings, line comments or block comments', () => {
    for (const source of ['// cube(2,', '/* cube(2,', 'text("cube(2,']) {
      expect(hint({ source, cursor: source.length })).toBeNull();
    }
  });

  it('does not present signatures at a module declaration', () => {
    const source='module pin(radius = ';
    expect(hint({ source, cursor: source.length })).toBeNull();
  });

  it('returns null for unknown and invalid calls', () => {
    expect(hint({ source: 'notKnown(1,', cursor: 11 })).toBeNull();
    expect(hint({ source: 'cube([1,2);', cursor: 11 })).toBeNull();
    expect(hint({ source: 'x'.repeat(250_001) + 'cube(', cursor: 250_006 })).toBeNull();
  });
});
