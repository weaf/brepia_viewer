import { describe, expect, it } from 'vitest';
import { BufferAttribute, Mesh, MeshStandardMaterial } from 'three';
import { parseColoredOff } from './offParser';
import {
  buildColoredGroupFromOff,
  buildColoredGroupFromPreparedOff,
  disposeColoredGroup,
} from './coloredOffMesh';
import { prepareColoredOffMesh, transferableOffMeshBuffers } from './preparedOffMesh';

const sample = [
  'OFF', '7 5 0',
  '0 0 0', '3 0 0', '0 2 0',
  '0 0 4', '3 2 1', '1 3 2', '1 2 3',
  '3 0 1 2 255 140 0',
  '3 0 2 3 107 142 35',
  '3 1 4 5 249 215 44',
  '3 3 5 6 157 203 81',
  '3 1 5 6 23 128 240 128',
].join('\n');

describe('Experimental transferable colored OFF mesh buffers', () => {
  it('matches existing Three.js geometry positions, normals, colors and transparency', () => {
    const oldParsed = parseColoredOff(sample);
    const newParsed = parseColoredOff(sample);
    const legacy = buildColoredGroupFromOff(sample, 0x00a6ff, oldParsed);
    const prepared = prepareColoredOffMesh(newParsed);
    const next = buildColoredGroupFromPreparedOff(prepared, 0x00a6ff);
    expect(legacy).not.toBeNull();
    expect(next).not.toBeNull();
    try {
      expect(next!.children).toHaveLength(legacy!.children.length);
      expect(prepared.triangleCount).toBe(5);
      // Pure worker preparation must not mutate the source used by the inspector.
      expect(newParsed.faces[2].color).not.toBeNull();
      for (let index = 0; index < legacy!.children.length; index++) {
        const before = legacy!.children[index] as Mesh;
        const after = next!.children[index] as Mesh;
        const oldPositions = before.geometry.getAttribute('position') as BufferAttribute;
        const newPositions = after.geometry.getAttribute('position') as BufferAttribute;
        const oldNormals = before.geometry.getAttribute('normal') as BufferAttribute;
        const newNormals = after.geometry.getAttribute('normal') as BufferAttribute;
        expect(Array.from(newPositions.array)).toEqual(Array.from(oldPositions.array));
        for (let i = 0; i < oldNormals.array.length; i++) {
          expect(Math.abs(Number(oldNormals.array[i]) - Number(newNormals.array[i]))).toBeLessThan(1e-6);
        }
        const oldMaterial = before.material as MeshStandardMaterial;
        const newMaterial = after.material as MeshStandardMaterial;
        expect(newMaterial.color.getHex()).toBe(oldMaterial.color.getHex());
        expect(newMaterial.transparent).toBe(oldMaterial.transparent);
        expect(newMaterial.opacity).toBe(oldMaterial.opacity);
        expect(newMaterial.metalness).toBe(oldMaterial.metalness);
        expect(newMaterial.roughness).toBe(oldMaterial.roughness);
        expect(newPositions.array).toBe(prepared.buckets[index].positions);
        expect(newNormals.array).toBe(prepared.buckets[index].normals);
      }
    } finally {
      if (legacy) disposeColoredGroup(legacy);
      if (next) disposeColoredGroup(next);
    }
  });

  it('transfers underlying position and normal arrays without cloning and keeps color group order', () => {
    const prepared = prepareColoredOffMesh(parseColoredOff(sample));
    expect(prepared.buckets).toHaveLength(4);
    expect(prepared.buckets.map(b => b.color && b.color.slice(0, 3).map(x => Math.round(x * 255))))
      .toEqual([[255, 140, 0], [107, 142, 35], null, [23, 128, 240]]);
    const transfers = transferableOffMeshBuffers(prepared);
    expect(transfers).toHaveLength(8);
    const cloned = structuredClone(prepared, { transfer: transfers });
    expect(prepared.buckets[0].positions.byteLength).toBe(0);
    expect(cloned.buckets[0].positions.byteLength).toBeGreaterThan(0);
    expect(cloned.triangleCount).toBe(5);
  });

  it('returns no geometry for an empty OFF mesh without creating Three.js objects', () => {
    const prepared = prepareColoredOffMesh(parseColoredOff('OFF\n3 0 0\n0 0 0\n1 0 0\n0 1 0'));
    expect(prepared.buckets).toEqual([]);
    expect(buildColoredGroupFromPreparedOff(prepared, 0x00a6ff)).toBeNull();
  });
});
