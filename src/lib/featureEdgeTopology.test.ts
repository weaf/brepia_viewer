import { describe, expect, it } from 'vitest';
import { extractFeatureEdgeTopology } from './featureEdgeTopology';
import type { ParsedOff } from '@/utils/offParser';
import { distanceBetweenModelPoints } from './measureDistance';

function cube(): ParsedOff {
  return {
    vertices: [
      [-5, -5, -5], [5, -5, -5], [5, 5, -5], [-5, 5, -5],
      [-5, -5, 5], [5, -5, 5], [5, 5, 5], [-5, 5, 5],
    ],
    faces: [
      [4, 5, 6], [4, 6, 7],
      [0, 2, 1], [0, 3, 2],
      [0, 4, 7], [0, 7, 3],
      [1, 2, 6], [1, 6, 5],
      [3, 7, 6], [3, 6, 2],
      [0, 1, 5], [0, 5, 4],
    ].map((vertices) => ({
      vertices: vertices as [number, number, number],
      color: null,
    })),
  };
}

describe('OFF feature-edge topology', () => {
  it('finds exactly twelve geometric cube edges, not face diagonals', () => {
    const result = extractFeatureEdgeTopology(cube());
    expect(result.analyzedFaces).toBe(12);
    expect(result.edges).toHaveLength(12);
    expect(result.edges.every((edge) => edge.kind === 'sharp')).toBe(true);
    for (const edge of result.edges) {
      expect(distanceBetweenModelPoints(edge.start, edge.end)).toBe(10);
    }
  });

  it('labels separate edge-connected cubes without inventing source modules', () => {
    const first = cube();
    const second = cube();
    const vertices = [...first.vertices, ...second.vertices.map(([x,y,z]) => [x + 30,y,z] as [number,number,number])];
    const faces = [...first.faces, ...second.faces.map(face => ({
      ...face, vertices: face.vertices.map(index => index + 8) as [number,number,number],
    }))];
    const result = extractFeatureEdgeTopology({ vertices, faces });
    expect(result.edges).toHaveLength(24);
    expect(new Set(result.edges.map(edge => edge.shellIndex))).toEqual(new Set([1, 2]));
  });

  it('ignores artificial color-bucket boundaries across coplanar faces', () => {
    const model = cube();
    model.faces = model.faces.map((face, index) => ({
      ...face,
      color: index % 2
        ? [0, 0, 1, 1]
        : [1, 0, 0, 1],
    }));
    expect(extractFeatureEdgeTopology(model).edges).toHaveLength(12);
  });

  it('welds identical coordinates from separate vertex indices', () => {
    const result = extractFeatureEdgeTopology({
      vertices: [
        [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0],
        [0, 0, 0], [10, 10, 0],
      ],
      faces: [
        { vertices: [0, 1, 2], color: null },
        { vertices: [4, 5, 3], color: null },
      ],
    });
    expect(result.edges).toHaveLength(4);
    expect(result.edges.every((edge) => edge.kind === 'open-boundary')).toBe(true);
  });

  it('flags non-manifold edges explicitly', () => {
    const result = extractFeatureEdgeTopology({
      vertices: [
        [0, 0, 0], [10, 0, 0], [0, 10, 0],
        [0, 0, 10], [0, -10, 0],
      ],
      faces: [
        { vertices: [0, 1, 2], color: null },
        { vertices: [1, 0, 3], color: null },
        { vertices: [0, 1, 4], color: null },
      ],
    });
    expect(result.edges.filter((edge) => edge.kind === 'non-manifold')).toHaveLength(1);
  });

  it('rejects unsafe synchronous models and invalid angles', () => {
    expect(() => extractFeatureEdgeTopology(cube(), -5)).toThrow(/angle/);
    const huge = cube();
    huge.faces = Array.from({ length: 200_001 }, () => huge.faces[0]);
    expect(() => extractFeatureEdgeTopology(huge)).toThrow(/too complex/);
  });
});
