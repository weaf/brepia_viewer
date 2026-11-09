/** Coordinates are in the unscaled 3D viewer world; OpenSCAD units are unitless. */
export type ModelPoint = readonly [number, number, number];

export function distanceBetweenModelPoints(a: ModelPoint, b: ModelPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
