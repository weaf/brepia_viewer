import type { ModelPoint } from './measureDistance';
import type { ParsedOff } from '@/utils/offParser';
import { connectedClosedShells } from '@/utils/orcaSplitSafeThreeMf';

export type FeatureEdgeKind = 'sharp' | 'open-boundary' | 'non-manifold';

export type FeatureEdge = {
  start: ModelPoint;
  end: ModelPoint;
  kind: FeatureEdgeKind;
  adjacentFaces: number;
  /** Edge-connected OFF shell number, not an OpenSCAD module identity. */
  shellIndex?: number;
};

type EdgeRecord = {
  start: ModelPoint;
  end: ModelPoint;
  normals: ModelPoint[];
  adjacentFaces: number;
  shellIndices: Set<number>;
};

const MAX_FACES = 200_000;

function coordinateKey(point: ModelPoint): string {
  return point.map((value) => {
    if (!Number.isFinite(value)) {
      throw new Error('OFF contains invalid coordinates for edge analysis.');
    }
    return String(value);
  }).join('/');
}

function faceUnitNormal(a: ModelPoint, b: ModelPoint, c: ModelPoint): ModelPoint | null {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const x = aby * acz - abz * acy;
  const y = abz * acx - abx * acz;
  const z = abx * acy - aby * acx;
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length <= 1e-12) return null;
  return [x / length, y / length, z / length];
}

export type FeatureEdgeTopology = {
  edges: FeatureEdge[];
  analyzedFaces: number;
  ignoredDegenerateFaces: number;
};

/**
 * Inspect the original globally indexed OFF before coloredOffMesh divides
 * triangles into per-color, non-indexed Three.js meshes.
 *
 * Coplanar triangulation edges are excluded; real sharp folds, open mesh
 * boundaries and non-manifold edges are distinguished rather than conflated.
 * This is geometry-only and cannot identify source OpenSCAD modules/parts.
 */
export function extractFeatureEdgeTopology(
  parsed: ParsedOff,
  sharpAngleDegrees = 30,
): FeatureEdgeTopology {
  if (!Number.isFinite(sharpAngleDegrees) ||
      sharpAngleDegrees <= 0 || sharpAngleDegrees >= 90) {
    throw new Error('Feature-edge angle must be between 0 and 90 degrees.');
  }
  if (parsed.faces.length > MAX_FACES) {
    throw new Error('Mesh too complex for synchronous feature-edge analysis.');
  }

  const lookup = new Map<string, EdgeRecord>();
  let ignoredDegenerateFaces = 0;
  let analyzedFaces = 0;
  // Reuse the same edge-connected shell order as Parts & colors. Large meshes
  // retain geometry snapping, but no potentially expensive shell attribution.
  const faceShellIndex = new Map<number, number>();
  if (parsed.faces.length <= 12_000) {
    connectedClosedShells(parsed).forEach((shell, index) => {
      for (const faceIndex of shell.faceIndices) faceShellIndex.set(faceIndex, index + 1);
    });
  }

  for (const [faceIndex, face] of parsed.faces.entries()) {
    const points = face.vertices.map((index) => parsed.vertices[index]);
    if (points.length !== 3 || points.some((point) =>
      !point || point.some((coordinate) => !Number.isFinite(coordinate)))) {
      throw new Error('OFF contains invalid face references.');
    }
    const normal = faceUnitNormal(points[0], points[1], points[2]);
    if (!normal) {
      ignoredDegenerateFaces += 1;
      continue;
    }
    analyzedFaces += 1;

    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const a = points[i] as ModelPoint;
      const b = points[j] as ModelPoint;
      const ak = coordinateKey(a);
      const bk = coordinateKey(b);
      if (ak === bk) continue;
      const key = ak < bk ? ak + '|' + bk : bk + '|' + ak;
      const existing = lookup.get(key);
      if (existing) {
        existing.adjacentFaces += 1;
        existing.normals.push(normal);
        const shellIndex = faceShellIndex.get(faceIndex);
        if (shellIndex !== undefined) existing.shellIndices.add(shellIndex);
      } else {
        lookup.set(key, {
          start: a,
          end: b,
          normals: [normal],
          adjacentFaces: 1,
          shellIndices: new Set(faceShellIndex.has(faceIndex) ? [faceShellIndex.get(faceIndex)!] : []),
        });
      }
    }
  }

  const cosineLimit = Math.cos(sharpAngleDegrees * Math.PI / 180);
  const edges: FeatureEdge[] = [];
  for (const entry of lookup.values()) {
    let kind: FeatureEdgeKind | null = null;
    if (entry.adjacentFaces === 1) {
      kind = 'open-boundary';
    } else if (entry.adjacentFaces > 2) {
      kind = 'non-manifold';
    } else {
      const [a, b] = entry.normals;
      // Absolute dot product tolerates inconsistent face winding in exports.
      const absoluteDot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
      if (absoluteDot < cosineLimit) kind = 'sharp';
    }
    if (kind) {
      edges.push({
        start: entry.start,
        end: entry.end,
        kind,
        adjacentFaces: entry.adjacentFaces,
        ...(entry.shellIndices.size === 1 ? { shellIndex: [...entry.shellIndices][0] } : {}),
      });
    }
  }
  return { edges, analyzedFaces, ignoredDegenerateFaces };
}
