import { describe, expect, it, vi } from 'vitest';
import { assertOpenScadOutputWithinLimit, resolveOpenScadOutputLimitBytes, OPENSCAD_MAX_OUTPUT_BYTES } from './openScadLimits';
import { requestPreviewWithOutputFallback } from './openScadPreviewFallback';

const mib = 1024 * 1024;
describe('bounded mesh output limits', () => {
  it('defaults to 128 MiB and counts all outputs', () => {
    expect(OPENSCAD_MAX_OUTPUT_BYTES).toBe(128 * mib);
    expect(() => assertOpenScadOutputWithinLimit({ output: { byteLength: 100 * mib }, extraOutputs: { off: { byteLength: 28 * mib } } })).not.toThrow();
    expect(() => assertOpenScadOutputWithinLimit({ output: { byteLength: 100 * mib }, extraOutputs: { off: { byteLength: 28 * mib + 1 } } })).toThrow(/OpenSCAD output exceeds/);
  });
  it('accepts only the explicit capacity choices and enforces their exact boundaries', () => {
    for (const cap of [64, 128, 256, 512]) {
      expect(resolveOpenScadOutputLimitBytes(cap)).toBe(cap * mib);
      expect(() => assertOpenScadOutputWithinLimit({ output: { byteLength: cap * mib } }, cap)).not.toThrow();
      expect(() => assertOpenScadOutputWithinLimit({ output: { byteLength: cap * mib + 1 } }, cap)).toThrow(/OpenSCAD output exceeds/);
    }
    for (const value of [0, -1, 1024, Infinity, NaN, '512', null]) {
      expect(() => resolveOpenScadOutputLimitBytes(value)).toThrow(/Invalid/);
    }
  });
});
describe('interactive preview fallback', () => {
  const tooLarge = new Error('OpenSCAD output exceeds 134217728 bytes.');
  it('keeps the colored response on success', async () => {
    const request = vi.fn(async () => 'colored');
    await expect(requestPreviewWithOutputFallback(request, undefined, () => true)).resolves.toEqual({ response: 'colored', usedFallback: false });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('retries once without colors after a size limit error', async () => {
    const request = vi.fn(async (colors: boolean | undefined) => { if (colors !== false) throw tooLarge; return 'binary STL'; });
    await expect(requestPreviewWithOutputFallback(request, undefined, () => true)).resolves.toEqual({ response: 'binary STL', usedFallback: true });
    expect(request.mock.calls).toEqual([[undefined], [false]]);
  });
  it('does not retry cancelled, STL-only, or other failures', async () => {
    const request = vi.fn(async () => { throw tooLarge; });
    await expect(requestPreviewWithOutputFallback(request, false, () => true)).rejects.toThrow(tooLarge.message);
    await expect(requestPreviewWithOutputFallback(request, undefined, () => false)).rejects.toThrow(tooLarge.message);
    expect(request).toHaveBeenCalledTimes(2);
    const syntax = vi.fn(async () => { throw new Error('syntax error'); });
    await expect(requestPreviewWithOutputFallback(syntax, true, () => true)).rejects.toThrow('syntax error');
    expect(syntax).toHaveBeenCalledTimes(1);
  });
  it('propagates an oversized binary STL failure without looping', async () => {
    const request = vi.fn(async () => { throw tooLarge; });
    await expect(requestPreviewWithOutputFallback(request, true, () => true)).rejects.toThrow(tooLarge.message);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
