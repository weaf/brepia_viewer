import type { OffFace, ParsedOff } from './offParser';

export type PreparedOffMeshBucket = {
  color: OffFace['color'];
  positions: Float32Array;
  normals: Float32Array;
};

export type PreparedOffMesh = {
  buckets: PreparedOffMeshBucket[];
  triangleCount: number;
};

/** OpenSCAD/Manifold placeholder colors are treated as uncolored faces. */
export function stripOpenscadDefaults(color: OffFace['color']): OffFace['color'] {
  if (!color) return null;
  const r = Math.round(color[0] * 255);
  const g = Math.round(color[1] * 255);
  const b = Math.round(color[2] * 255);
  if (r === 249 && g === 215 && b === 44) return null;
  if (r === 157 && g === 203 && b === 81) return null;
  return color;
}

/**
 * CPU-only non-indexed buffers. This code can run in a Web Worker without
 * Three.js, and its Float32Arrays can be transferred without cloning.
 * It preserves the old group order, per-face colors and flat triangle normals.
 */
export function prepareColoredOffMesh(parsed: ParsedOff): PreparedOffMesh {
  const buckets = new Map<string, { color: OffFace['color']; faces: OffFace[] }>();
  for (const face of parsed.faces) {
    const color = stripOpenscadDefaults(face.color);
    const key = color ? color.join(',') : '__default';
    const existing = buckets.get(key);
    if (existing) existing.faces.push(face);
    else buckets.set(key, { color, faces: [face] });
  }

  const prepared: PreparedOffMeshBucket[] = [];
  for (const bucket of buckets.values()) {
    const positions = new Float32Array(bucket.faces.length * 9);
    const normals = new Float32Array(bucket.faces.length * 9);
    for (let index = 0; index < bucket.faces.length; index += 1) {
      const [a, b, c] = bucket.faces[index].vertices;
      const va = parsed.vertices[a];
      const vb = parsed.vertices[b];
      const vc = parsed.vertices[c];
      const i = index * 9;
      positions.set(va, i);
      positions.set(vb, i + 3);
      positions.set(vc, i + 6);

      // Three.js computeVertexNormals() reads the Float32 positions, then
      // calculates (C-B) x (A-B) and normalizes each unindexed face.
      const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
      const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
      const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
      const abx = ax - bx, aby = ay - by, abz = az - bz;
      const cbx = cx - bx, cby = cy - by, cbz = cz - bz;
      const nx = cby * abz - cbz * aby;
      const ny = cbz * abx - cbx * abz;
      const nz = cbx * aby - cby * abx;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const x = nx / length, y = ny / length, z = nz / length;
      for (let j = 0; j < 9; j += 3) {
        normals[i + j] = x;
        normals[i + j + 1] = y;
        normals[i + j + 2] = z;
      }
    }
    prepared.push({ color: bucket.color, positions, normals });
  }
  return { buckets: prepared, triangleCount: parsed.faces.length };
}

export function transferableOffMeshBuffers(prepared: PreparedOffMesh): ArrayBuffer[] {
  const transfers: ArrayBuffer[] = [];
  for (const bucket of prepared.buckets) {
    transfers.push(bucket.positions.buffer as ArrayBuffer);
    transfers.push(bucket.normals.buffer as ArrayBuffer);
  }
  return transfers;
}
