import { BufferAttribute, BufferGeometry } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

export type PreparedStlGeometry = {
  positions: Float32Array;
  normals: Float32Array;
  colors?: Float32Array;
};

export type StlWorkerTimings = {
  decodeMs: number;
  centerMs: number;
  normalsMs: number;
  totalMs: number;
};

/**
 * Uses the exact legacy STLLoader, center(), and vertex-normal operations,
 * but produces transferable buffers instead of transferring Three.js objects.
 * The compiler's original STL Blob stays untouched for export.
 */
export function prepareStlGeometry(
  buffer: ArrayBuffer,
): { prepared: PreparedStlGeometry; timings: StlWorkerTimings } {
  const started = performance.now();
  const geometry = new STLLoader().parse(buffer);
  const decoded = performance.now();
  geometry.center();
  const centered = performance.now();
  geometry.computeVertexNormals();
  const finished = performance.now();
  const positions = geometry.getAttribute('position').array as Float32Array;
  const normals = geometry.getAttribute('normal').array as Float32Array;
  const colorAttribute = geometry.getAttribute('color');
  const colors = colorAttribute?.array as Float32Array | undefined;
  return {
    prepared: { positions, normals, ...(colors ? { colors } : {}) },
    timings: {
      decodeMs: decoded - started,
      centerMs: centered - decoded,
      normalsMs: finished - centered,
      totalMs: finished - started,
    },
  };
}

/** Attach typed arrays without another vertex copy; Three.js stays in the UI. */
export function buildGeometryFromPreparedStl(prepared: PreparedStlGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(prepared.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(prepared.normals, 3));
  if (prepared.colors) geometry.setAttribute('color', new BufferAttribute(prepared.colors, 3));
  return geometry;
}

export function transferableStlGeometryBuffers(prepared: PreparedStlGeometry): ArrayBuffer[] {
  return [
    prepared.positions.buffer as ArrayBuffer,
    prepared.normals.buffer as ArrayBuffer,
    ...(prepared.colors ? [prepared.colors.buffer as ArrayBuffer] : []),
  ];
}
