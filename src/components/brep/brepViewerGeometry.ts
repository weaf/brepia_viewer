import { BufferAttribute, BufferGeometry } from 'three';
import type { BrepEvaluationSuccess } from '@shared/brepProvider';

/**
 * Build one render-only BufferGeometry from the explicit ordered result bodies.
 * Canonical/evaluation body identity remains in result.bodies; this helper does
 * not fuse or otherwise reinterpret an instance set.
 *
 * Fail closed on partial viewer payloads. Rendering only a subset of an
 * instance set would visually misrepresent the authoritative evaluation result.
 */
export function brepViewerGeometryFromResult(
  result: BrepEvaluationSuccess,
): BufferGeometry | null {
  if (result.bodies.length === 0) return null;

  const meshes = result.bodies.map((body) => body.viewerMesh);
  if (meshes.some((mesh) => !mesh)) return null;

  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const mesh of meshes) {
    if (!mesh) return null;
    positions.push(...mesh.positions);
    indices.push(...mesh.indices.map((index) => index + vertexOffset));
    vertexOffset += mesh.positions.length / 3;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
