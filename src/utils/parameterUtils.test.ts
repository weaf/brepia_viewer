import { describe, expect, it } from 'vitest';
import type { Parameter } from '@shared/types';
import {
  calculateParameterRange,
  calculateParameterStep,
  validateParameterValue,
} from './parameterUtils';
import { updateParameter } from '@/lib/utilsCore';

const numeric: Parameter = {
  name: 'profile_strength',
  displayName: 'Profile Strength',
  type: 'number',
  value: 70,
  defaultValue: 70,
  range: { min: 0, max: 100, step: 5 },
};

describe('Customizer numeric values from input to OpenSCAD source', () => {
  it('keeps a valid Profile Strength and the declared slider range', () => {
    expect(calculateParameterRange(numeric)).toEqual({ min: 0, max: 100 });
    expect(calculateParameterStep(numeric)).toBe(5);
    expect(validateParameterValue(numeric, '85')).toBe(85);
    expect(updateParameter('profile_strength = 70; // [0:5:100]', { ...numeric, value: 85 }))
      .toBe('profile_strength = 85; // [0:5:100]');
  });

  it('never writes NaN or Infinity into the OpenSCAD source', () => {
    const code = 'profile_strength = 70; // [0:5:100]';
    for (const value of [NaN, Infinity, -Infinity, 'NaN', 'Infinity', '']) {
      const safe = validateParameterValue(numeric, value as number);
      expect(safe).toBe(70);
      const result = updateParameter(code, { ...numeric, value: value as number });
      expect(result).toBe(code);
      expect(result).not.toMatch(/\b(?:NaN|Infinity)\b/);
    }
  });

  it('rejects broken slider boundaries, falling back to finite values', () => {
    const broken: Parameter = {
      ...numeric,
      value: NaN,
      defaultValue: Infinity,
      range: { min: NaN, max: Infinity, step: 0 },
    };
    const { min, max } = calculateParameterRange(broken);
    const step = calculateParameterStep(broken);
    expect(Number.isFinite(min) && Number.isFinite(max) && min < max).toBe(true);
    expect(Number.isFinite(step) && step > 0).toBe(true);
    expect(Number.isFinite(Number(validateParameterValue(broken, NaN)))).toBe(true);
  });

  it('clamps out-of-range numeric input and preserves negative ranges', () => {
    expect(validateParameterValue(numeric, 125)).toBe(100);
    expect(validateParameterValue(numeric, -3)).toBe(0);
    const offset = { ...numeric, defaultValue: -2.5, range: { min: -10, max: 5, step: 0.25 } };
    expect(validateParameterValue(offset, '-3.5')).toBe(-3.5);
    expect(calculateParameterRange(offset)).toEqual({ min: -10, max: 5 });
    expect(calculateParameterStep(offset)).toBe(0.25);
  });

  it('changes string enums without touching other OpenSCAD declarations', () => {
    const code = [
      'body_profile = "uniform"; // [uniform,taper,spindle]',
      'profile_strength = 70; // [0:5:100]',
    ].join('\n');
    const enumParam: Parameter = {
      name: 'body_profile', displayName: 'Body Profile',
      type: 'string', value: 'spindle', defaultValue: 'uniform',
      options: [{ value: 'uniform' }, { value: 'taper' }, { value: 'spindle' }],
    };
    expect(updateParameter(code, enumParam)).toBe(
      code.replace('body_profile = "uniform"', 'body_profile = "spindle"'),
    );
  });
});
