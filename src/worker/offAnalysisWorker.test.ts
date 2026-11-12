import { describe, expect, it, vi } from 'vitest';

describe('Experimental OFF analysis worker', () => {
  it('returns cloneable OFF vertices, colors and edge analysis without Three.js objects', async () => {
    const postMessage = vi.fn();
    const context: { postMessage: typeof postMessage; onmessage?: (event: MessageEvent<{ text: string }>) => void } = { postMessage };
    vi.stubGlobal('self', context);
    try {
      await import('./offAnalysisWorker');
      const off = [
        'OFF', '4 2 0',
        '0 0 0', '10 0 0', '0 10 0', '0 0 10',
        '3 0 1 2 255 0 0', '3 0 2 3 0 0 255',
      ].join('\n');
      context.onmessage?.({ data: { text: off } } as MessageEvent<{ text: string }>);
      expect(postMessage).toHaveBeenCalledOnce();
      const result = postMessage.mock.calls[0][0];
      expect(result.ok).toBe(true);
      expect(result.inspection.triangleCount).toBe(2);
      expect(result.inspection.palette.map((color: { hex: string }) => color.hex))
        .toEqual(['#FF0000', '#0000FF']);
      expect(result.parsed.faces).toHaveLength(2);
      expect(result.edges.length).toBeGreaterThan(0);
      expect(structuredClone(result)).toEqual(result);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports malformed OFF as a result instead of crashing the worker', async () => {
    const postMessage = vi.fn();
    const context: { postMessage: typeof postMessage; onmessage?: (event: MessageEvent<{ text: string }>) => void } = { postMessage };
    vi.stubGlobal('self', context);
    try {
      // The worker module is cached from the previous test. Rebind its handler
      // from the module by isolating imports with a new module registry.
      vi.resetModules();
      await import('./offAnalysisWorker');
      context.onmessage?.({ data: { text: 'not OFF' } } as MessageEvent<{ text: string }>);
      expect(postMessage).toHaveBeenCalledOnce();
      expect(postMessage.mock.calls[0][0]).toMatchObject({ ok: false, error: 'Missing OFF header' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
