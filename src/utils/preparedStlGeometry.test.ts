import { describe, expect, it } from 'vitest';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import {
  buildGeometryFromPreparedStl,
  prepareStlGeometry,
  transferableStlGeometryBuffers,
} from './preparedStlGeometry';

function binaryStl(): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + 50 * 2);
  const view = new DataView(buffer);
  view.setUint32(80, 2, true);
  const faces = [
    [[0, 0, 0], [4, 0, 0], [0, 4, 0]],
    [[0, 0, 0], [0, 4, 0], [0, 0, 3]],
  ];
  for (let f = 0; f < faces.length; f++) {
    for (let v = 0; v < 3; v++) {
      for (let component = 0; component < 3; component++) {
        view.setFloat32(84 + f * 50 + 12 + v * 12 + component * 4, faces[f][v][component], true);
      }
    }
  }
  return buffer;
}

describe('Experimental STL geometry worker preparation', () => {
  it('preserves the STLLoader output, centering and recomputed normals without a main-thread STLLoader', () => {
    const bytes = binaryStl();
    const original = new STLLoader().parse(bytes);
    original.center();
    original.computeVertexNormals();
    const { prepared, timings } = prepareStlGeometry(bytes);
    const restored = buildGeometryFromPreparedStl(prepared);
    try {
      expect(Array.from(restored.getAttribute('position').array))
        .toEqual(Array.from(original.getAttribute('position').array));
      expect(Array.from(restored.getAttribute('normal').array))
        .toEqual(Array.from(original.getAttribute('normal').array));
      expect(restored.getAttribute('position').array).toBe(prepared.positions);
      expect(restored.getAttribute('normal').array).toBe(prepared.normals);
      expect(restored.getAttribute('position').count).toBe(6);
      expect(timings.totalMs).toBeGreaterThanOrEqual(0);
      expect(timings.decodeMs).toBeGreaterThanOrEqual(0);
      expect(timings.centerMs).toBeGreaterThanOrEqual(0);
      expect(timings.normalsMs).toBeGreaterThanOrEqual(0);
      expect(bytes.byteLength).toBe(184);
    } finally {
      original.dispose();
      restored.dispose();
    }
  });

  it('transfers position and normal backing buffers without cloning them', () => {
    const { prepared } = prepareStlGeometry(binaryStl());
    const transfers = transferableStlGeometryBuffers(prepared);
    expect(transfers).toHaveLength(2);
    const received = structuredClone(prepared, { transfer: transfers });
    expect(prepared.positions.byteLength).toBe(0);
    expect(prepared.normals.byteLength).toBe(0);
    const restored = buildGeometryFromPreparedStl(received);
    expect(restored.getAttribute('position').count).toBe(6);
    restored.dispose();
  });

  it('preserves the legacy loader for text STL as well', () => {
    const source = [
      'solid example',
      'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 2 0 0',
      'vertex 0 2 0', 'endloop', 'endfacet', 'endsolid example',
    ].join('\n');
    const bytes = new TextEncoder().encode(source).buffer;
    const legacy = new STLLoader().parse(bytes);
    legacy.center();
    legacy.computeVertexNormals();
    const prepared = prepareStlGeometry(bytes).prepared;
    expect(Array.from(prepared.positions)).toEqual(Array.from(legacy.getAttribute('position').array));
    expect(Array.from(prepared.normals)).toEqual(Array.from(legacy.getAttribute('normal').array));
    legacy.dispose();
  });
});
