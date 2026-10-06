import { BrepScalarEvaluationError } from './brepScalar.ts';

export type BrepResolvedProfilePoint = readonly [number, number];
export type BrepProfileOperation = 'extrude' | 'revolve';

export type BrepResolvedRectangleProfileLoop = {
  type: 'rectangle';
  centerU: number;
  centerV: number;
  width: number;
  height: number;
};

export type BrepResolvedCircleProfileLoop = {
  type: 'circle';
  centerU: number;
  centerV: number;
  radius: number;
};

export type BrepResolvedClosedPolylineProfileLoop = {
  type: 'closedPolyline';
  points: readonly BrepResolvedProfilePoint[];
};

export type BrepResolvedProfileLoop =
  | BrepResolvedRectangleProfileLoop
  | BrepResolvedCircleProfileLoop
  | BrepResolvedClosedPolylineProfileLoop;

const GEOMETRY_EPSILON = 1e-9;

function nearlyZero(value: number): boolean {
  return Math.abs(value) <= GEOMETRY_EPSILON;
}

function samePoint(
  left: BrepResolvedProfilePoint,
  right: BrepResolvedProfilePoint,
): boolean {
  return (
    Math.abs(left[0] - right[0]) <= GEOMETRY_EPSILON &&
    Math.abs(left[1] - right[1]) <= GEOMETRY_EPSILON
  );
}

function orientation(
  a: BrepResolvedProfilePoint,
  b: BrepResolvedProfilePoint,
  c: BrepResolvedProfilePoint,
): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(
  a: BrepResolvedProfilePoint,
  b: BrepResolvedProfilePoint,
  point: BrepResolvedProfilePoint,
): boolean {
  return (
    nearlyZero(orientation(a, b, point)) &&
    point[0] >= Math.min(a[0], b[0]) - GEOMETRY_EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + GEOMETRY_EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - GEOMETRY_EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + GEOMETRY_EPSILON
  );
}

function segmentsIntersect(
  a: BrepResolvedProfilePoint,
  b: BrepResolvedProfilePoint,
  c: BrepResolvedProfilePoint,
  d: BrepResolvedProfilePoint,
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);

  if (
    ((abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON) ||
      (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON)) &&
    ((cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON) ||
      (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON))
  ) {
    return true;
  }

  return (
    (nearlyZero(abC) && onSegment(a, b, c)) ||
    (nearlyZero(abD) && onSegment(a, b, d)) ||
    (nearlyZero(cdA) && onSegment(c, d, a)) ||
    (nearlyZero(cdB) && onSegment(c, d, b))
  );
}

function edgesAreAdjacent(left: number, right: number, edgeCount: number): boolean {
  return (
    left === right ||
    (left + 1) % edgeCount === right ||
    (right + 1) % edgeCount === left
  );
}

function rectanglePoints(
  loop: BrepResolvedRectangleProfileLoop,
): readonly BrepResolvedProfilePoint[] {
  const halfWidth = loop.width / 2;
  const halfHeight = loop.height / 2;
  return [
    [loop.centerU - halfWidth, loop.centerV - halfHeight],
    [loop.centerU + halfWidth, loop.centerV - halfHeight],
    [loop.centerU + halfWidth, loop.centerV + halfHeight],
    [loop.centerU - halfWidth, loop.centerV + halfHeight],
  ];
}

function polygonPoints(
  loop: BrepResolvedProfileLoop,
): readonly BrepResolvedProfilePoint[] | null {
  switch (loop.type) {
    case 'rectangle':
      return rectanglePoints(loop);
    case 'closedPolyline':
      return loop.points;
    case 'circle':
      return null;
  }
}

function forEachEdge(
  points: readonly BrepResolvedProfilePoint[],
  visitor: (a: BrepResolvedProfilePoint, b: BrepResolvedProfilePoint) => boolean,
): boolean {
  for (let index = 0; index < points.length; index += 1) {
    if (visitor(points[index]!, points[(index + 1) % points.length]!)) return true;
  }
  return false;
}

function pointSegmentDistanceSquared(
  point: BrepResolvedProfilePoint,
  a: BrepResolvedProfilePoint,
  b: BrepResolvedProfilePoint,
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= GEOMETRY_EPSILON * GEOMETRY_EPSILON) {
    const px = point[0] - a[0];
    const py = point[1] - a[1];
    return px * px + py * py;
  }
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared),
  );
  const closestU = a[0] + t * dx;
  const closestV = a[1] + t * dy;
  const du = point[0] - closestU;
  const dv = point[1] - closestV;
  return du * du + dv * dv;
}

function pointInPolygonStrict(
  point: BrepResolvedProfilePoint,
  polygon: readonly BrepResolvedProfilePoint[],
): boolean {
  if (forEachEdge(polygon, (a, b) => onSegment(a, b, point))) return false;

  let inside = false;
  const [u, v] = point;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index]!;
    const prior = polygon[previous]!;
    const intersects =
      (current[1] > v) !== (prior[1] > v) &&
      u <
        ((prior[0] - current[0]) * (v - current[1])) /
          (prior[1] - current[1]) +
          current[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInLoopStrict(
  point: BrepResolvedProfilePoint,
  loop: BrepResolvedProfileLoop,
): boolean {
  if (loop.type === 'circle') {
    const du = point[0] - loop.centerU;
    const dv = point[1] - loop.centerV;
    const radius = loop.radius - GEOMETRY_EPSILON;
    return radius > 0 && du * du + dv * dv < radius * radius;
  }
  return pointInPolygonStrict(point, polygonPoints(loop)!);
}

function polygonBoundaryIntersectsPolygonBoundary(
  left: readonly BrepResolvedProfilePoint[],
  right: readonly BrepResolvedProfilePoint[],
): boolean {
  return forEachEdge(left, (a, b) =>
    forEachEdge(right, (c, d) => segmentsIntersect(a, b, c, d)),
  );
}

function polygonBoundaryIntersectsCircle(
  polygon: readonly BrepResolvedProfilePoint[],
  circle: BrepResolvedCircleProfileLoop,
): boolean {
  const center: BrepResolvedProfilePoint = [circle.centerU, circle.centerV];
  const threshold = circle.radius + GEOMETRY_EPSILON;
  return forEachEdge(
    polygon,
    (a, b) => pointSegmentDistanceSquared(center, a, b) <= threshold * threshold,
  );
}

function boundariesIntersectOrTouch(
  left: BrepResolvedProfileLoop,
  right: BrepResolvedProfileLoop,
): boolean {
  if (left.type === 'circle' && right.type === 'circle') {
    const du = left.centerU - right.centerU;
    const dv = left.centerV - right.centerV;
    const distanceSquared = du * du + dv * dv;
    const sum = left.radius + right.radius + GEOMETRY_EPSILON;
    const difference = Math.abs(left.radius - right.radius) - GEOMETRY_EPSILON;
    return distanceSquared <= sum * sum && distanceSquared >= Math.max(0, difference) ** 2;
  }

  if (left.type === 'circle') {
    return polygonBoundaryIntersectsCircle(polygonPoints(right)!, left);
  }
  if (right.type === 'circle') {
    return polygonBoundaryIntersectsCircle(polygonPoints(left)!, right);
  }
  return polygonBoundaryIntersectsPolygonBoundary(
    polygonPoints(left)!,
    polygonPoints(right)!,
  );
}

function representativePoint(loop: BrepResolvedProfileLoop): BrepResolvedProfilePoint {
  if (loop.type === 'circle') return [loop.centerU, loop.centerV];
  if (loop.type === 'rectangle') return [loop.centerU, loop.centerV];

  let doubledArea = 0;
  let weightedU = 0;
  let weightedV = 0;
  for (let index = 0; index < loop.points.length; index += 1) {
    const current = loop.points[index]!;
    const next = loop.points[(index + 1) % loop.points.length]!;
    const cross = current[0] * next[1] - next[0] * current[1];
    doubledArea += cross;
    weightedU += (current[0] + next[0]) * cross;
    weightedV += (current[1] + next[1]) * cross;
  }
  if (!nearlyZero(doubledArea)) {
    const centroid: BrepResolvedProfilePoint = [
      weightedU / (3 * doubledArea),
      weightedV / (3 * doubledArea),
    ];
    if (pointInPolygonStrict(centroid, loop.points)) return centroid;
  }

  // A valid simple polygon always has a point immediately inside one of its
  // edges. Move from an edge midpoint toward the arithmetic mean and use the
  // first candidate that is strictly internal.
  const average: BrepResolvedProfilePoint = [
    loop.points.reduce((sum, point) => sum + point[0], 0) / loop.points.length,
    loop.points.reduce((sum, point) => sum + point[1], 0) / loop.points.length,
  ];
  for (let index = 0; index < loop.points.length; index += 1) {
    const a = loop.points[index]!;
    const b = loop.points[(index + 1) % loop.points.length]!;
    const midpoint: BrepResolvedProfilePoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const fraction of [0.01, 0.05, 0.1, 0.25, 0.5]) {
      const candidate: BrepResolvedProfilePoint = [
        midpoint[0] + (average[0] - midpoint[0]) * fraction,
        midpoint[1] + (average[1] - midpoint[1]) * fraction,
      ];
      if (pointInPolygonStrict(candidate, loop.points)) return candidate;
    }
  }
  return loop.points[0]!;
}

function loopStrictlyInside(
  inner: BrepResolvedProfileLoop,
  outer: BrepResolvedProfileLoop,
): boolean {
  if (boundariesIntersectOrTouch(inner, outer)) return false;

  if (inner.type === 'circle') {
    const center: BrepResolvedProfilePoint = [inner.centerU, inner.centerV];
    if (!pointInLoopStrict(center, outer)) return false;
    if (outer.type === 'circle') {
      const du = inner.centerU - outer.centerU;
      const dv = inner.centerV - outer.centerV;
      return Math.sqrt(du * du + dv * dv) + inner.radius < outer.radius - GEOMETRY_EPSILON;
    }
    return !forEachEdge(
      polygonPoints(outer)!,
      (a, b) =>
        pointSegmentDistanceSquared(center, a, b) <=
        (inner.radius + GEOMETRY_EPSILON) * (inner.radius + GEOMETRY_EPSILON),
    );
  }

  const points = polygonPoints(inner)!;
  if (!points.every((point) => pointInLoopStrict(point, outer))) return false;

  if (outer.type === 'circle') return true;
  return !polygonBoundaryIntersectsPolygonBoundary(points, polygonPoints(outer)!);
}

function loopsOverlapTouchOrNest(
  left: BrepResolvedProfileLoop,
  right: BrepResolvedProfileLoop,
): boolean {
  if (boundariesIntersectOrTouch(left, right)) return true;
  return (
    pointInLoopStrict(representativePoint(left), right) ||
    pointInLoopStrict(representativePoint(right), left)
  );
}

/**
 * Validate an already-resolved closed polyline boundary before either geometry
 * kernel sees it. Closure is implicit: the last point is connected to point 0.
 */
export function validateBrepClosedPolylineProfilePoints(
  points: readonly BrepResolvedProfilePoint[],
  nodeId: string,
  operation: BrepProfileOperation = 'extrude',
): void {
  const owner = `BRep ${operation} ${nodeId}`;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    if (samePoint(points[index]!, points[next]!)) {
      throw new BrepScalarEvaluationError(
        `${owner} closedPolyline profile contains a zero-length edge at index ${index}.`,
      );
    }
  }

  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    doubledArea += current[0] * next[1] - next[0] * current[1];
  }
  if (nearlyZero(doubledArea)) {
    throw new BrepScalarEvaluationError(
      `${owner} closedPolyline profile must have non-zero area.`,
    );
  }

  for (let left = 0; left < points.length; left += 1) {
    const leftNext = (left + 1) % points.length;
    for (let right = left + 1; right < points.length; right += 1) {
      if (edgesAreAdjacent(left, right, points.length)) continue;
      const rightNext = (right + 1) % points.length;
      if (
        segmentsIntersect(
          points[left]!,
          points[leftNext]!,
          points[right]!,
          points[rightNext]!,
        )
      ) {
        throw new BrepScalarEvaluationError(
          `${owner} closedPolyline profile self-intersects between edges ${left} and ${right}.`,
        );
      }
    }
  }
}

/**
 * Validate strict outer/hole relationships after all profile scalars have been
 * resolved. Explicit outer/hole role is semantic; winding is deliberately not.
 */
export function validateBrepMultiLoopProfileGeometry(
  outer: BrepResolvedProfileLoop,
  holes: readonly BrepResolvedProfileLoop[],
  nodeId: string,
): void {
  const owner = `BRep extrude ${nodeId}`;

  for (let index = 0; index < holes.length; index += 1) {
    const hole = holes[index]!;
    if (!loopStrictlyInside(hole, outer)) {
      throw new BrepScalarEvaluationError(
        `${owner} hole ${index} must be strictly inside the outer profile without touching it.`,
      );
    }
  }

  for (let left = 0; left < holes.length; left += 1) {
    for (let right = left + 1; right < holes.length; right += 1) {
      if (loopsOverlapTouchOrNest(holes[left]!, holes[right]!)) {
        throw new BrepScalarEvaluationError(
          `${owner} holes ${left} and ${right} must be disjoint, non-touching, and non-nested.`,
        );
      }
    }
  }
}
