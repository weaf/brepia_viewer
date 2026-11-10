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


/** Two snapped points define a line; its slope is relative to the fixed
 * world-horizontal XZ plane (Three.js Y-up = OpenSCAD Z-up). */
export function inclinationFromHorizontal(first: ModelPoint, second: ModelPoint): number | null {
  const dx = second[0] - first[0];
  const dy = second[1] - first[1];
  const dz = second[2] - first[2];
  const horizontal = Math.hypot(dx, dz);
  const length = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(length) || length <= 1e-9) return null;
  return Math.atan2(Math.abs(dy), horizontal) * 180 / Math.PI;
}

/** Horizontal baseline and 3D arc starting at the first reference point. */
export function inclinationGuides(
  first: ModelPoint, second: ModelPoint, segments = 24,
): { horizontalEnd: ModelPoint; arc: ModelPoint[] } | null {
  const degrees = inclinationFromHorizontal(first, second);
  if (degrees === null) return null;
  const dx = second[0] - first[0];
  const dy = second[1] - first[1];
  const dz = second[2] - first[2];
  const horizontal = Math.hypot(dx, dz);
  const length = Math.hypot(dx, dy, dz);
  const ux = horizontal > 1e-9 ? dx / horizontal : 1;
  const uz = horizontal > 1e-9 ? dz / horizontal : 0;
  const sign = dy >= 0 ? 1 : -1;
  const radius = length * 0.22;
  const count = Math.max(4, Math.min(64, Math.floor(segments)));
  const arc = degrees < 1e-6 ? [] : Array.from({ length: count + 1 }, (_, index): ModelPoint => {
    const a = degrees * Math.PI / 180 * index / count;
    return [first[0] + radius * ux * Math.cos(a),
      first[1] + radius * sign * Math.sin(a),
      first[2] + radius * uz * Math.cos(a)];
  });
  return {
    horizontalEnd: [first[0] + length * 0.38 * ux, first[1],
      first[2] + length * 0.38 * uz],
    arc,
  };
}
