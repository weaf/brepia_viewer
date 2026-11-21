import type { ParsedOff } from "@/utils/offParser";
import { connectedClosedShells } from "@/utils/orcaSplitSafeThreeMf";

type Vector3 = readonly [number, number, number];
type Vector2 = readonly [number, number];
type Face = readonly [Vector3, Vector3, Vector3];

// This is deliberately a narrow fallback for small remesh regions. The common
// case still uses exact, quantized triangle matching in sourceMoveWriteback.
const MAX_FACES_FOR_FALLBACK = 40_000;
const MAX_CHANGED_TRIANGLES = 96;
const MAX_SURFACE_DEVIATION_MM = 0.012;
const MIN_NORMAL_ALIGNMENT = 0.999;

const subtract = (a: Vector3, b: Vector3): Vector3 =>
  [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vector3, b: Vector3): Vector3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vector3, b: Vector3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function normal(face: Face): Vector3 | null {
  const n = cross(subtract(face[1], face[0]), subtract(face[2], face[0]));
  const length = Math.hypot(...n);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return [n[0] / length, n[1] / length, n[2] / length];
}

function polygon(off: ParsedOff, index: number, moved: boolean, delta: Vector3): Face {
  const coordinates = off.faces[index].vertices.map(vertexIndex => {
    const v = off.vertices[vertexIndex];
    return [
      v[0] + (moved ? delta[0] : 0),
      v[1] + (moved ? delta[1] : 0),
      v[2] + (moved ? delta[2] : 0),
    ] as Vector3;
  });
  return [coordinates[0], coordinates[1], coordinates[2]];
}

function fingerprint(face: Face): string {
  return face.map(v => v.map(c => Math.round(c * 100)).join(",")).sort().join("|");
}

function project(p: Vector3, drop: number): Vector2 {
  return drop === 0 ? [p[1], p[2]] : drop === 1 ? [p[0], p[2]] : [p[0], p[1]];
}
function cross2(a: Vector2, b: Vector2, c: Vector2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function signedArea(poly: readonly Vector2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a[0] * b[1] - a[1] * b[0];
  }
  return sum / 2;
}

/** 2D convex clipping (Sutherland-Hodgman). No sampling or bounding-box guesses. */
function intersectionArea(subject: readonly Vector2[], clipTriangle: readonly Vector2[]): number {
  const orientation = signedArea(clipTriangle) >= 0 ? 1 : -1;
  let result: Vector2[] = [...subject];
  for (let i = 0; i < 3 && result.length; i += 1) {
    const a = clipTriangle[i];
    const b = clipTriangle[(i + 1) % 3];
    const input = result;
    result = [];
    for (let j = 0; j < input.length; j += 1) {
      const start = input[j];
      const end = input[(j + 1) % input.length];
      const da = cross2(a, b, start) * orientation;
      const db = cross2(a, b, end) * orientation;
      const insideStart = da >= -1e-9;
      const insideEnd = db >= -1e-9;
      if (insideStart !== insideEnd) {
        const denom = da - db;
        if (Math.abs(denom) > 1e-12) {
          const t = da / denom;
          result.push([
            start[0] + t * (end[0] - start[0]),
            start[1] + t * (end[1] - start[1]),
          ]);
        }
      }
      if (insideEnd) result.push(end);
    }
  }
  return result.length >= 3 ? Math.abs(signedArea(result)) : 0;
}


function pointTriangleDistance(point: Vector3, triangle: Face): number {
  const [a,b,c] = triangle;
  const n = normal(triangle);
  if (!n) return Infinity;
  const ap = subtract(point,a);
  const signed = dot(ap,n);
  const projected: Vector3 = [
    point[0] - signed*n[0], point[1] - signed*n[1], point[2] - signed*n[2],
  ];
  const u = subtract(b,a);
  const v = subtract(c,a);
  const w = subtract(projected,a);
  const uu = dot(u,u), uv = dot(u,v), vv = dot(v,v);
  const wu = dot(w,u), wv = dot(w,v);
  const denom = uu*vv - uv*uv;
  if (denom > 1e-18) {
    const beta = (vv*wu - uv*wv)/denom;
    const gamma = (uu*wv - uv*wu)/denom;
    if (beta >= -1e-9 && gamma >= -1e-9 && beta + gamma <= 1+1e-9) return Math.abs(signed);
  }
  const segmentDistance = (start: Vector3, end: Vector3) => {
    const d = subtract(end,start);
    const length2 = dot(d,d);
    const t = length2 > 0 ? Math.max(0,Math.min(1,dot(subtract(point,start),d)/length2)) : 0;
    return Math.hypot(...subtract(point,[
      start[0]+t*d[0],start[1]+t*d[1],start[2]+t*d[2],
    ]));
  };
  return Math.min(segmentDistance(a,b),segmentDistance(b,c),segmentDistance(c,a));
}

/**
 * OFF may move a near-degenerate sliver by one serialized precision step,
 * leaving no projected 2D overlap. A seven-point bidirectional 3D proximity
 * proof is allowed ONLY for facets under 0.005 mm² and with edges <= 10 mm.
 * Never use this for a normal-sized facet.
 */
function nearbySliver(reference: Face, candidates: readonly Face[]): boolean {
  const n = normal(reference);
  if (!n) return false;
  const area3d = Math.hypot(...cross(subtract(reference[1],reference[0]),
    subtract(reference[2],reference[0])))/2;
  const lengths = reference.map((p,i) =>
    Math.hypot(...subtract(p,reference[(i+1)%3])));
  if (area3d <= 0 || area3d > 0.005 || Math.max(...lengths) > 10) return false;
  const midpoint = (a: Vector3,b: Vector3): Vector3 =>
    [(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
  const samples: Vector3[] = [
    ...reference,
    midpoint(reference[0],reference[1]),
    midpoint(reference[1],reference[2]),
    midpoint(reference[2],reference[0]),
    [
      (reference[0][0]+reference[1][0]+reference[2][0])/3,
      (reference[0][1]+reference[1][1]+reference[2][1])/3,
      (reference[0][2]+reference[1][2]+reference[2][2])/3,
    ],
  ];
  const nearPlanes = candidates.filter(candidate => {
    const m = normal(candidate);
    return m && Math.abs(dot(n,m)) >= MIN_NORMAL_ALIGNMENT;
  });
  return nearPlanes.length > 0 && samples.every(point =>
    nearPlanes.some(candidate =>
      pointTriangleDistance(point,candidate) <= MAX_SURFACE_DEVIATION_MM));
}

/**
 * Demand symmetric surface coverage for every changed triangle. Only near-
 * coplanar triangles can contribute to the overlap of a reference triangle.
 * This permits a triangulation split without accepting changed 3D surfaces.
 */
function fullyCovered(reference: Face, candidates: readonly Face[],
  details?: (value: Record<string, number | string>) => void): boolean {
  const n = normal(reference);
  if (!n) { details?.({reason:"degenerate-reference"}); return false; }
  const drop = Math.abs(n[0]) > Math.abs(n[1])
    ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2)
    : (Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2);
  const projected = reference.map(v => project(v, drop));
  const area = Math.abs(signedArea(projected));
  if (area < 1e-9) { details?.({reason:"degenerate-area",area}); return false; }
  const perimeter = projected.reduce((sum, p, i) =>
    sum + Math.hypot(p[0] - projected[(i + 1) % 3][0],
      p[1] - projected[(i + 1) % 3][1]), 0);
  let covered = 0;
  let compatible = 0;
  for (const candidate of candidates) {
    const candidateNormal = normal(candidate);
    if (!candidateNormal || Math.abs(dot(n, candidateNormal)) < MIN_NORMAL_ALIGNMENT) continue;
    if (candidate.some(v =>
      Math.abs(dot(n, subtract(v, reference[0]))) > MAX_SURFACE_DEVIATION_MM)) continue;
    compatible += 1;
    covered += intersectionArea(candidate.map(v => project(v, drop)), projected);
  }
  // Never accept an entirely missing or extra triangle, including tiny ones.
  const tolerance = Math.min(area * 0.12, perimeter * MAX_SURFACE_DEVIATION_MM + 1e-7);
  const surfaceCoverage = covered >= area * 0.88 && Math.abs(covered - area) <= tolerance;
  const valid = surfaceCoverage || nearbySliver(reference,candidates);
  if (!valid) details?.({reason:"surface-coverage",area,covered,tolerance,compatible});
  return valid;
}

/**
 * Strict, fail-closed retessellation fallback.
 *
 * Preconditions: exact face matching has failed, but a verified source-call
 * exclusion has already linked the chosen part to its OpenSCAD call.
 *
 * CSG can re-triangulate even UNMOVED shells when the selected module moves.
 * Each changed triangle, in any shell, must be symmetrically covered by the
 * other mesh within 0.012 mm; unchanged face keys are still checked first.
 * Shell count must not change. No volume, bbox or face-count shortcut passes.
 */
export function verifySourceMoveRetessellation(
  original: ParsedOff,
  translated: ParsedOff,
  partIndex: number,
  delta: Vector3,
  report?: (result: {reason: string; [key: string]: string | number}) => void,
): boolean {
  const reject = (reason: string, data: Record<string, string | number> = {}) => {
    report?.({reason, ...data});
    return false;
  };
  if (original.faces.length === 0 ||
      original.faces.length > MAX_FACES_FOR_FALLBACK ||
      translated.faces.length > MAX_FACES_FOR_FALLBACK ||
      original.vertices.some(v => v.some(x => !Number.isFinite(x))) ||
      translated.vertices.some(v => v.some(x => !Number.isFinite(x))) ||
      delta.some(x => !Number.isFinite(x))) return reject("unsupported-input");

  const originalShells = connectedClosedShells(original);
  const selected = originalShells[partIndex];
  if (!selected || !selected.faceIndices.length) return reject("selected-shell-missing");
  // Do not accept an accidental merge/split of the user's selectable parts.
  const translatedShellCount = connectedClosedShells(translated).length;
  if (translatedShellCount !== originalShells.length) return reject("shell-count-changed", {
    before:originalShells.length, after:translatedShellCount,
  });
  const selectedFaces = new Set(selected.faceIndices);
  const expectedByKey = new Map<string, number[]>();
  const actualByKey = new Map<string, number[]>();

  for (let i = 0; i < original.faces.length; i += 1) {
    const moved = selectedFaces.has(i);
    const key = fingerprint(polygon(original, i, moved, delta));
    const list = expectedByKey.get(key) ?? [];
    list.push(i);
    expectedByKey.set(key, list);
  }
  for (let i = 0; i < translated.faces.length; i += 1) {
    const key = fingerprint(polygon(translated, i, false, delta));
    const list = actualByKey.get(key) ?? [];
    list.push(i);
    actualByKey.set(key, list);
  }
  const missing: number[] = [];
  const added: number[] = [];
  for (const [key, before] of expectedByKey) {
    const after = actualByKey.get(key) ?? [];
    missing.push(...before.slice(Math.min(before.length, after.length)));
    if (after.length > before.length) added.push(...after.slice(before.length));
  }
  for (const [key, after] of actualByKey) {
    if (!expectedByKey.has(key)) added.push(...after);
  }
  if (!missing.length || !added.length ||
      missing.length > MAX_CHANGED_TRIANGLES ||
      added.length > MAX_CHANGED_TRIANGLES) return reject("residual-limit", {
        missing:missing.length,added:added.length,
      });
  const expected = missing.map(index =>
    polygon(original, index, selectedFaces.has(index), delta));
  const actual = added.map(index => polygon(translated, index, false, delta));
  for (let i = 0; i < expected.length; i += 1) {
    let detail: Record<string, string | number> = {};
    if (!fullyCovered(expected[i],actual,value=>{detail=value;})) return reject("expected-surface-not-covered", {
      index:i,missing:missing.length,added:added.length,...detail,
    });
  }
  for (let i = 0; i < actual.length; i += 1) {
    let detail: Record<string, string | number> = {};
    if (!fullyCovered(actual[i],expected,value=>{detail=value;})) return reject("extra-surface-not-covered", {
      index:i,missing:missing.length,added:added.length,...detail,
    });
  }
  return true;
}
