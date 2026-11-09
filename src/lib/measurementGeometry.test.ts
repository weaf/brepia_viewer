import { describe, expect, it } from 'vitest';
import { angleArcPoints, angleBetweenModelPoints, formatDistanceFromModelUnits } from './measurementGeometry';
import { distanceBetweenModelPoints } from './measureDistance';

describe('distance display units', () => {
  it('converts one 10-unit cube edge to mm, cm and m', () => {
    const length = distanceBetweenModelPoints([0, 0, 0], [10, 0, 0]);
    expect(formatDistanceFromModelUnits(length, 'mm')).toBe('10 mm');
    expect(formatDistanceFromModelUnits(length, 'cm')).toBe('1 cm');
    expect(formatDistanceFromModelUnits(length, 'm')).toBe('0.01 m');
  });
  it('preserves fractional precision and zeros', () => {
    expect(formatDistanceFromModelUnits(2.07, 'mm')).toBe('2.07 mm');
    expect(formatDistanceFromModelUnits(2.07, 'cm')).toBe('0.207 cm');
    expect(formatDistanceFromModelUnits(2.07, 'm')).toBe('0.00207 m');
    expect(formatDistanceFromModelUnits(0, 'mm')).toBe('0 mm');
  });
  it('rejects an invalid measurement', () => {
    expect(() => formatDistanceFromModelUnits(Number.NaN, 'mm')).toThrow();
  });
});
describe('three-point angle in degrees', () => {
  it('measures 90 degrees with the second point at the vertex', () => {
    expect(angleBetweenModelPoints([10, 0, 0], [0, 0, 0], [0, 10, 0])).toBeCloseTo(90, 9);
  });
  it('measures acute, straight and obtuse angles', () => {
    expect(angleBetweenModelPoints([1, 0, 0], [0, 0, 0], [1, 1, 0])).toBeCloseTo(45, 9);
    expect(angleBetweenModelPoints([1, 0, 0], [0, 0, 0], [-1, 0, 0])).toBeCloseTo(180, 9);
    expect(angleBetweenModelPoints([1, 0, 0], [0, 0, 0], [-1, 1, 0])).toBeCloseTo(135, 9);
  });
  it('returns null if an angle arm has zero length', () => {
    expect(angleBetweenModelPoints([0, 0, 0], [0, 0, 0], [0, 1, 0])).toBeNull();
  });
  it('draws a bounded arc in the correct angle plane', () => {
    const result = angleArcPoints([10, 0, 0], [0, 0, 0], [0, 10, 0]);
    expect(result).toHaveLength(25);
    expect(result[0]).toEqual([2.8000000000000003, 0, 0]);
    expect(result.at(-1)?.[0]).toBeCloseTo(0, 9);
    expect(result.at(-1)?.[1]).toBeCloseTo(2.8, 9);
  });
});
