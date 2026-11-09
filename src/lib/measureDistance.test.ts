import { describe, expect, it } from 'vitest';
import { distanceBetweenModelPoints } from './measureDistance';

describe('distanceBetweenModelPoints', () => {
  it('measures a ten-unit edge', () => {
    expect(distanceBetweenModelPoints([0, 0, 0], [10, 0, 0])).toBe(10);
  });
  it('uses 3D distance instead of screen pixels', () => {
    expect(distanceBetweenModelPoints([1, 2, 3], [4, 6, 3])).toBe(5);
  });
  it('is invariant under common translation and rigid rotation', () => {
    const first = distanceBetweenModelPoints([1, 2, 3], [6, 4, 3]);
    const rotated = distanceBetweenModelPoints([8, 21, 8], [6, 26, 8]);
    expect(rotated).toBeCloseTo(first, 9);
  });
  it('returns zero for the same point', () => {
    expect(distanceBetweenModelPoints([3, -4, 7], [3, -4, 7])).toBe(0);
  });
});
