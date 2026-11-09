import { describe, expect, it } from 'vitest';
import OpenSCADError from '@/lib/OpenSCADError';
import { OpenScadTimeoutError } from '@/lib/openScadTimeoutError';
import { describeOpenScadFailure } from './openScadFeedback';

describe('OpenSCAD preview failure feedback', () => {
  it('explains timeout and allows retry', () => {
    const result = describeOpenScadFailure(new OpenScadTimeoutError(20000));
    expect(result.kind).toBe('timeout');
    expect(result.canRetry).toBe(true);
  });
  it('reports source and mesh size limits separately', () => {
    expect(describeOpenScadFailure(new Error('OpenSCAD source exceeds 256000 UTF-8 bytes.')).kind)
      .toBe('source-limit');
    expect(describeOpenScadFailure(new Error('OpenSCAD output exceeds 67108864 bytes.')).kind)
      .toBe('output-limit');
  });
  it('preserves syntax diagnostics with line numbers', () => {
    const result = describeOpenScadFailure(new OpenSCADError('Compilation failed', '1', [
      'ERROR: Parser error: syntax error in file test.scad, line 4',
    ]));
    expect(result.kind).toBe('syntax');
    expect(result.message).toContain('line 4');
    expect(result.diagnostics).toContain('Parser error');
    expect(result.canRetry).toBe(false);
  });
  it('distinguishes an unknown compiler error from transport failure', () => {
    expect(describeOpenScadFailure(new OpenSCADError('OpenSCAD fail', '1', [
      'WARNING: Ignoring unknown module',
    ])).kind).toBe('compile');
    expect(describeOpenScadFailure(new Error('Network error')).kind).toBe('runtime');
  });
});
