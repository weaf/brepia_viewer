import { describe, expect, it } from 'vitest';
import { prepareOffParts } from './preparedOffParts';
import type { ParsedOff } from './offParser';

function cubes(count: number, colors = false): ParsedOff {
  const vertices: ParsedOff['vertices'] = [];
  const faces: ParsedOff['faces'] = [];
  const triangles = [
    [0,2,1], [0,3,2], [4,5,6], [4,6,7],
    [0,1,5], [0,5,4], [1,2,6], [1,6,5],
    [2,3,7], [2,7,6], [3,0,4], [3,4,7],
  ];
  for (let part = 0; part < count; part++) {
    const x = part * 4;
    const start = vertices.length;
    vertices.push(
      [x,0,0], [x+1,0,0], [x+1,1,0], [x,1,0],
      [x,0,1], [x+1,0,1], [x+1,1,1], [x,1,1],
    );
    for (let i = 0; i < triangles.length; i++) {
      faces.push({ vertices: triangles[i].map(n => n + start) as [number, number, number],
        color: colors && i % 2 === 0 ? [1,0,0,1] : null });
    }
  }
  return { vertices, faces };
}

describe('preview-only OFF Part Move topology', () => {
  it('recognizes a separate lid and base instead of splitting by color', () => {
    const parts = prepareOffParts(cubes(2, true));
    expect(parts.status).toBe('available');
    expect(parts.parts).toHaveLength(2);
    expect(parts.parts.map(p => p.triangleCount)).toEqual([12,12]);
    expect(parts.parts.map(p => p.closed)).toEqual([true,true]);
    expect(parts.parts[0].mesh.buckets.length).toBe(2);
    expect(parts.parts.map(p => p.center[0])).toEqual([0.5, 4.5]);
  });
  it('identifies each separate link in a four-link chain fixture', () => {
    const parts = prepareOffParts(cubes(4));
    expect(parts.status).toBe('available');
    expect(parts.parts).toHaveLength(4);
  });
  it('does not fabricate independent parts from one multi-color object', () => {
    const parts = prepareOffParts(cubes(1, true));
    expect(parts.status).toBe('single-component');
  });
  it('refuses pathological component counts', () => {
    const parts = prepareOffParts(cubes(257));
    expect(parts.status).toBe('too-many-parts');
  });
});
