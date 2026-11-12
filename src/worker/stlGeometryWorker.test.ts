import { describe, expect, it, vi } from 'vitest';

describe('Experimental STL preparation worker', () => {
  it('returns centered STL geometry as cloneable typed arrays with transferred buffers', async () => {
    const postMessage = vi.fn();
    const selfMock: {
      postMessage: typeof postMessage;
      onmessage?: (e: MessageEvent<{ buffer: ArrayBuffer }>) => void;
    } = { postMessage };
    vi.stubGlobal('self', selfMock);
    try {
      vi.resetModules();
      await import('./stlGeometryWorker');
      const buffer = new ArrayBuffer(84 + 50);
      const view = new DataView(buffer);
      view.setUint32(80, 1, true);
      for (const [vertex, xyz] of [[0,[0,0,0]],[1,[1,0,0]],[2,[0,1,0]]] as const) {
        for (let axis = 0; axis < 3; axis++)
          view.setFloat32(84 + 12 + vertex*12 + axis*4, xyz[axis], true);
      }
      selfMock.onmessage?.({ data: { buffer } } as MessageEvent<{ buffer: ArrayBuffer }>);
      expect(postMessage).toHaveBeenCalledOnce();
      const [response, transfers] = postMessage.mock.calls[0];
      expect(response.ok).toBe(true);
      expect(response.prepared.positions).toBeInstanceOf(Float32Array);
      expect(response.prepared.normals).toBeInstanceOf(Float32Array);
      expect(response.prepared.positions.length).toBe(9);
      expect(transfers).toHaveLength(2);
      expect(response.timings.totalMs).toBeGreaterThanOrEqual(0);
      const delivered = structuredClone(response, { transfer: transfers });
      expect(delivered.prepared.normals.length).toBe(9);
      expect(response.prepared.positions.byteLength).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handles malformed or truncated STL safely as an error result', async () => {
    const postMessage = vi.fn();
    const selfMock: {
      postMessage: typeof postMessage;
      onmessage?: (e: MessageEvent<{ buffer: ArrayBuffer }>) => void;
    } = { postMessage };
    vi.stubGlobal('self', selfMock);
    try {
      vi.resetModules();
      await import('./stlGeometryWorker');
      const data = new ArrayBuffer(84);
      new DataView(data).setUint32(80, 12, true);
      selfMock.onmessage?.({ data: { buffer: data } } as MessageEvent<{ buffer: ArrayBuffer }>);
      expect(postMessage).toHaveBeenCalledOnce();
      const response = postMessage.mock.calls[0][0];
      expect(response.ok).toBe(false);
      expect(response.error).toEqual(expect.any(String));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
