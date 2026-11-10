import { describe, expect, it } from 'vitest';
import { angleArcPoints, angleBetweenModelPoints, inclinationFromHorizontal, inclinationGuides, formatDistanceFromModelUnits } from './measurementGeometry';
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


describe('two-point inclination against a fixed horizontal reference', () => {
  it('handles flat, ascending, descending and vertical model lines', () => {
    expect(inclinationFromHorizontal([0,0,0], [10,0,0])).toBeCloseTo(0,9);
    expect(inclinationFromHorizontal([0,0,0], [10,10,0])).toBeCloseTo(45,9);
    expect(inclinationFromHorizontal([0,0,0], [10,-10,0])).toBeCloseTo(45,9);
    expect(inclinationFromHorizontal([0,0,0], [0,10,0])).toBeCloseTo(90,9);
  });
  it('does not depend on reversing the point order', () => {
    expect(inclinationFromHorizontal([1,3,4],[11,13,4]))
      .toBeCloseTo(inclinationFromHorizontal([11,13,4],[1,3,4])!,9);
  });
  it('guards against degenerate points', () => {
    expect(inclinationFromHorizontal([2,4,6],[2,4,6])).toBeNull();
    expect(inclinationFromHorizontal([0,0,0],[Infinity,0,0])).toBeNull();
    expect(inclinationGuides([1,2,3],[1,2,3])).toBeNull();
  });
  it('generates horizontal reference and 3D angle arc from first point', () => {
    const g=inclinationGuides([2,3,4],[12,13,4])!;
    expect(g.horizontalEnd[1]).toBe(3);
    expect(g.arc).toHaveLength(25);
    expect(g.arc[0][1]).toBeCloseTo(3,9);
    expect(g.arc.at(-1)![1]).toBeGreaterThan(3);
  });
  it('draws a downwards arc and suppresses zero-angle arc', () => {
    const g=inclinationGuides([0,0,0],[0,-10,0])!;
    expect(g.arc.at(-1)![1]).toBeLessThan(0);
    expect(g.horizontalEnd).toEqual([3.8,0,0]);
    expect(inclinationGuides([0,0,0],[0,0,10])!.arc).toEqual([]);
  });
});
