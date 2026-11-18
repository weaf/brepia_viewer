import type { ParsedOff } from './offParser';
import { connectedClosedShells } from './orcaSplitSafeThreeMf';
import { prepareColoredOffMesh, type PreparedOffMesh } from './preparedOffMesh';

export const MAX_PART_MOVE_TRIANGLES = 250_000;
export const MAX_PART_MOVE_COMPONENTS = 256;

export type PreparedOffPart = {
  index: number;
  triangleCount: number;
  closed: boolean;
  center: [number, number, number];
  mesh: PreparedOffMesh;
};

export type PreparedOffPartsResult = {
  status: 'available' | 'single-component' | 'too-complex' | 'too-many-parts';
  parts: PreparedOffPart[];
};

/**
 * Preview-only, edge-connected components. Never infer parts from RGB.
 * This is deliberately independent of export and source transformations.
 */
export function prepareOffParts(parsed: ParsedOff): PreparedOffPartsResult {
  if (parsed.faces.length > MAX_PART_MOVE_TRIANGLES) {
    return { status: 'too-complex', parts: [] };
  }
  const shells = connectedClosedShells(parsed);
  if (shells.length < 2) return { status: 'single-component', parts: [] };
  if (shells.length > MAX_PART_MOVE_COMPONENTS) {
    return { status: 'too-many-parts', parts: [] };
  }
  return {
    status: 'available',
    parts: shells.map((shell, index) => {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const faceIndex of shell.faceIndices) {
        for (const vertexIndex of parsed.faces[faceIndex].vertices) {
          const vertex = parsed.vertices[vertexIndex];
          for (let axis = 0; axis < 3; axis += 1) {
            min[axis] = Math.min(min[axis], vertex[axis]);
            max[axis] = Math.max(max[axis], vertex[axis]);
          }
        }
      }
      return {
        index,
        triangleCount: shell.faceIndices.length,
        closed: shell.closed,
        center: min.map((v, axis) => (v + max[axis]) / 2) as [number, number, number],
        mesh: prepareColoredOffMesh({
          vertices: parsed.vertices,
          faces: shell.faceIndices.map(faceIndex => parsed.faces[faceIndex]),
        }),
      };
    }),
  };
}
