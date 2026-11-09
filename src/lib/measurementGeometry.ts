import type { ModelPoint } from './measureDistance';

export type DistanceUnit = 'mm' | 'cm' | 'm';

/**
 * OpenSCAD geometry is unitless; the viewer assumes that 1 model unit = 1 mm.
 * Changing the display unit never transforms geometry or alters export data.
 */
export function formatDistanceFromModelUnits(value: number, unit: DistanceUnit): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid distance');
  const divisor = unit === 'mm' ? 1 : unit === 'cm' ? 10 : 1000;
  const decimals = unit === 'mm' ? 2 : unit === 'cm' ? 3 : 5;
  const result = (value / divisor).toFixed(decimals)
    .replace(/[.]0+$/, '')
    .replace(/([.][0-9]*?[1-9])0+$/, '$1');
  return result + ' ' + unit;
}

function armFrom(vertex: ModelPoint, point: ModelPoint): [number, number, number] {
  return [point[0] - vertex[0], point[1] - vertex[1], point[2] - vertex[2]];
}
const dot = (a: ModelPoint, b: ModelPoint) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (p: ModelPoint) => Math.hypot(p[0], p[1], p[2]);

/** The middle of the three selected points is the angle vertex. */
export function angleBetweenModelPoints(
  first: ModelPoint,
  vertex: ModelPoint,
  last: ModelPoint,
): number | null {
  const a = armFrom(vertex, first);
  const b = armFrom(vertex, last);
  const aLength = norm(a);
  const bLength = norm(b);
  if (!Number.isFinite(aLength) || !Number.isFinite(bLength) ||
      aLength <= 1e-9 || bLength <= 1e-9) return null;
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (aLength * bLength)))) * 180 / Math.PI;
}

/** View-only points for an angle arc, never added to OpenSCAD or exported mesh. */
export function angleArcPoints(
  first: ModelPoint,
  vertex: ModelPoint,
  last: ModelPoint,
  segments = 24,
): [number, number, number][] {
  const degrees = angleBetweenModelPoints(first, vertex, last);
  if (degrees === null || !Number.isFinite(segments)) return [];
  const stepCount = Math.max(4, Math.min(64, Math.floor(segments)));
  const a = armFrom(vertex, first);
  const b = armFrom(vertex, last);
  const aLength = norm(a), bLength = norm(b);
  const u: [number, number, number] = a.map((n) => n / aLength) as [number, number, number];
  const v = b.map((n) => n / bLength) as [number, number, number];
  const cosAngle = Math.max(-1, Math.min(1, dot(u, v)));
  let perp = v.map((n, i) => n - u[i] * cosAngle) as [number, number, number];
  let perpLength = norm(perp);
  if (perpLength < 1e-9) {
    const seed: ModelPoint = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    perp = seed.map((n, i) => n - u[i] * dot(u, seed)) as [number, number, number];
    perpLength = norm(perp);
  }
  perp = perp.map((n) => n / perpLength) as [number, number, number];
  const radius = Math.min(aLength, bLength) * 0.28;
  const radians = degrees * Math.PI / 180;
  return Array.from({ length: stepCount + 1 }, (_, index) => {
    const t = (index / stepCount) * radians;
    return [
      vertex[0] + radius * (u[0] * Math.cos(t) + perp[0] * Math.sin(t)),
      vertex[1] + radius * (u[1] * Math.cos(t) + perp[1] * Math.sin(t)),
      vertex[2] + radius * (u[2] * Math.cos(t) + perp[2] * Math.sin(t)),
    ];
  });
}
