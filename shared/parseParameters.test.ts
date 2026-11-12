import { describe, expect, it } from 'vitest';
import parseParameters from './parseParameters.ts';

describe('parseParameters', () => {
  it('parses Customizer parameters declared after helper functions', () => {
    const source = `/* [Dimensions] */
width = 150; // [80:5:280]
function scaled_width() = width * 2;
/* [View] */
layout = "Print"; // [Assembled, Print]
profile_points = 96; // [64:16:128]
module body() { cube(width); }
`;

    const parameters = parseParameters(source);

    expect(parameters.map(({ name }) => name)).toEqual([
      'width',
      'layout',
      'profile_points',
    ]);
    expect(parameters.map(({ group }) => group)).toEqual([
      'Dimensions',
      'View',
      'View',
    ]);
  });
});


describe('OpenSCAD Customizer numeric ranges and enums', () => {
  it('does not interpret a comma in the trailing description as a numeric enum', () => {
    const [param] = parseParameters('profile_strength = 10; // [0:1:14] procent, andrar endast yttre bredd');
    expect(param.type).toBe('number');
    expect(param.value).toBe(10);
    expect(param.options).toEqual([]);
    expect(param.range).toEqual({ min: 0, max: 14, step: 1 });
  });

  it('reads profile strength and string enums without changing their types', () => {
    const params = parseParameters('profile_strength = 70; // [0:5:100]\nbody_profile = "uniform"; // [uniform,taper,spindle]');
    expect(params.map(p => [p.name, p.value])).toEqual([
      ['profile_strength', 70], ['body_profile', 'uniform'],
    ]);
    expect(params[0].range).toEqual({ min: 0, step: 5, max: 100 });
    expect(params[1].options?.map(o => o.value)).toEqual(['uniform', 'taper', 'spindle']);
  });

  it('accepts signed decimal ranges and suffix text', () => {
    const [param] = parseParameters('offset = -2.5; // [-10.5:0.25:3.5] steg, kommentar');
    expect(param.range).toEqual({ min: -10.5, step: 0.25, max: 3.5 });
    expect(param.options).toEqual([]);
  });

  it('ignores invalid numeric annotations rather than emitting non-finite slider metadata', () => {
    const source = [
      'a = 2; // [0:foo:10]',
      'b = 2; // [0:0:10]',
      'c = 2; // [2:1]',
      'd = 2; // [0:1e309]',
      'e = 2; // [1,invalid:Label,3]',
      'f = 2; // Infinity',
    ].join('\n');
    const params = parseParameters(source);
    expect(params).toHaveLength(6);
    for (const param of params) {
      expect(Object.values(param.range ?? {}).every(Number.isFinite)).toBe(true);
      expect(param.options?.every(option =>
        typeof option.value !== 'number' || Number.isFinite(option.value),
      )).toBe(true);
    }
    expect(params.find(p => p.name === 'b')?.range).toEqual({});
    expect(params.find(p => p.name === 'c')?.range).toEqual({});
    expect(params.find(p => p.name === 'e')?.options).toEqual([]);
  });
});
