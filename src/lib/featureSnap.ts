import * as THREE from 'three';
import type { FeatureEdge } from './featureEdgeTopology';
import type { ModelPoint } from './measureDistance';

export type FeatureSnap = {
  point: ModelPoint;
  kind: 'corner' | 'edge';
  pixelDistance: number;
  /** Geometric OFF shell only, never inferred source module identity. */
  shellIndex?: number;
};

export type FeatureSnapArgs = {
  edges: readonly FeatureEdge[];
  pointerNdc: { x: number; y: number };
  camera: THREE.Camera;
  viewport: { width: number; height: number };
  ray: THREE.Ray;
  maxPixels: number;
  isVisible?: (point: THREE.Vector3) => boolean;
};

const toVector = (p: ModelPoint) => new THREE.Vector3(p[0], p[1], p[2]);

/**
 * Select real feature corners before sharp edges, within a screen-space radius.
 * The caller supplies already world-transformed coordinates. No mesh writes.
 */
export function pickFeatureSnap({
  edges, pointerNdc, camera, viewport, ray, maxPixels, isVisible,
}: FeatureSnapArgs): FeatureSnap | null {
  if (viewport.width <= 0 || viewport.height <= 0 ||
      !Number.isFinite(maxPixels) || maxPixels <= 0) return null;
  const candidates: FeatureSnap[] = [];
  const corners = new Map<string, FeatureSnap>();
  const pixel = (projected: THREE.Vector3) => ({
    x: (projected.x - pointerNdc.x) * viewport.width / 2,
    y: (projected.y - pointerNdc.y) * viewport.height / 2,
  });
  for (const edge of edges) {
    if (edge.kind !== 'sharp') continue;
    const a = toVector(edge.start), b = toVector(edge.end);
    const pa = a.clone().project(camera);
    const pb = b.clone().project(camera);
    if (![pa.x,pa.y,pa.z,pb.x,pb.y,pb.z].every(Number.isFinite)) continue;
    for (const [p,projected] of [[a,pa],[b,pb]] as const) {
      if (projected.z < -1 || projected.z > 1) continue;
      const key = p.toArray().join('/');
      const existingCorner = corners.get(key);
      if (existingCorner) {
        if (existingCorner.shellIndex !== edge.shellIndex) delete existingCorner.shellIndex;
        continue;
      }
      const delta = pixel(projected);
      const distance = Math.hypot(delta.x,delta.y);
      if (distance <= maxPixels) {
        const candidate: FeatureSnap = { point: [p.x,p.y,p.z], kind:'corner', pixelDistance:distance };
        if (edge.shellIndex !== undefined) candidate.shellIndex = edge.shellIndex;
        corners.set(key, candidate);
        candidates.push(candidate);
      }
    }
    if (pa.z < -1 || pa.z > 1 || pb.z < -1 || pb.z > 1) continue;
    const start = pixel(pa), end = pixel(pb);
    const dx=end.x-start.x, dy=end.y-start.y;
    const lengthSquared=dx*dx+dy*dy;
    if (lengthSquared < 1e-9) continue;
    const t = Math.max(0,Math.min(1,-(start.x*dx+start.y*dy)/lengthSquared));
    const projectedGap = Math.hypot(start.x+t*dx,start.y+t*dy);
    if (projectedGap > maxPixels) continue;
    const pointOnSegment = new THREE.Vector3();
    ray.distanceSqToSegment(a,b,undefined,pointOnSegment);
    candidates.push({
      point: [pointOnSegment.x,pointOnSegment.y,pointOnSegment.z],
      kind: 'edge',
      pixelDistance:projectedGap,
      ...(edge.shellIndex !== undefined ? { shellIndex: edge.shellIndex } : {}),
    });
  }
  // Prefer nearby corners for precise measurement, but do not pull a touch
  // across most of the snap radius when a sharp edge is under the pointer.
  // A six-pixel corner advantage works for both touch and mouse coordinates.
  const cornerAdvantagePixels = 6;
  candidates.sort((a,b) =>
    (a.pixelDistance - (a.kind === 'corner' ? cornerAdvantagePixels : 0))
    - (b.pixelDistance - (b.kind === 'corner' ? cornerAdvantagePixels : 0))
    || (a.kind === b.kind ? 0 : a.kind === 'corner' ? -1 : 1));
  const checked = Math.min(candidates.length,120);
  for (let i=0;i<checked;i++) {
    const candidate=candidates[i];
    if (!isVisible || isVisible(toVector(candidate.point))) return candidate;
  }
  return null;
}
