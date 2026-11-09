import { describe, expect, it } from 'vitest';
import { getOpenScadBasicDiagnostics as check } from './openScadBasicDiagnostics';

describe('conservative OpenSCAD draft diagnostics', () => {
  it('accepts valid nested OpenSCAD geometry and include directives', () => {
    expect(check('module part(x) { translate([1, 2, 3]) cube([x, 4, 5]); }\npart(6);')).toEqual([]);
    expect(check('include <lib/geometry.scad>\nuse <lib/features.scad>\ncolor("red") sphere(5);')).toEqual([]);
  });

  it('ignores bracket-like characters inside both comment forms and strings', () => {
    expect(check('// ( } [ " \n /* wrong } ) ] */\ntext("escaped \\" ] ) } quote");')).toEqual([]);
  });

  it('reports unexpected closing delimiters with a bounded source range', () => {
    const issues = check('cube([1, 2, 3]));');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Unexpected closing ')'");
    expect(issues[0].to - issues[0].from).toBe(1);
  });

  it('reports missing closing delimiters', () => {
    const issues = check('difference() { cube([10, 10, 10]);');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Missing closing '}'");
  });

  it('reports mismatched delimiters without parsing code comments', () => {
    const issues = check('cube([10, 20, 30);');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("expected ']'");
  });

  it('reports unterminated block comments and strings', () => {
    expect(check('/* hello [')).toHaveLength(1);
    expect(check('/* hello [')[0].message).toContain('block comment');
    expect(check('text("hello [')).toHaveLength(1);
    expect(check('text("hello [')[0].message).toContain('string');
  });

  it('does not misinterpret escaped quote pairs', () => {
    expect(check('text("a \\"quoted\\" text");')).toEqual([]);
  });

  it('limits work on very large drafts', () => {
    expect(check('x'.repeat(250_001) + '{')).toEqual([]);
  });
});
