import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { createLocalProjectBackup, readLocalProjectBackup } from './localProjectBackup';
import type { LocalModelRecord } from '@/services/localModelLibrary';
import { normalizeOpenScadProject, type OpenScadProject } from '@shared/openScadProject';

const encoder = new TextEncoder();

async function makeFixture(): Promise<LocalModelRecord> {
  const assetData = encoder.encode('solid simple\nendsolid simple\n');
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', assetData.buffer)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const project: OpenScadProject = {
    schemaVersion: 1,
    entrypointPath: 'main.scad',
    files: [
      { path: 'main.scad', content: 'include <lib/helper.scad>;\nimport("mesh.stl");\nwidth=12;\n' },
      { path: 'lib/helper.scad', content: 'module helper(){cube(2);}\n' },
    ],
    assets: [{
      path: 'mesh.stl',
      storagePath: 'saved/assets/mesh.stl',
      mediaType: 'model/stl',
      byteLength: assetData.byteLength,
      sha256: digest,
    }],
  };
  return {
    id: 'upload:fixture-original',
    name: 'Multi-file example',
    origin: 'upload',
    project,
    assetBlobs: { 'mesh.stl': new Blob([assetData], { type: 'model/stl' }) },
    updatedAt: '2026-11-08T20:00:00.000Z',
  };
}

describe('private local project ZIP backup', () => {
  it('round-trips a multi-file project and validates its binary asset', async () => {
    const original = await makeFixture();
    const backup = await createLocalProjectBackup([original]);
    expect(backup.size).toBeGreaterThan(0);
    const copies = await readLocalProjectBackup(backup);
    expect(copies).toHaveLength(1);
    expect(copies[0].id).not.toBe(original.id);
    expect(copies[0].origin).toBe('upload');
    expect(copies[0].project).toEqual(normalizeOpenScadProject(original.project));
    expect(await copies[0].assetBlobs['mesh.stl'].text())
      .toBe(await original.assetBlobs['mesh.stl'].text());
  });
  it('rejects a tampered ZIP asset instead of silently restoring it', async () => {
    const backup = await createLocalProjectBackup([await makeFixture()]);
    const files = unzipSync(new Uint8Array(await backup.arrayBuffer()));
    files['assets/0/0'][0] = 88;
    const tampered = new Blob([new Uint8Array(zipSync(files))]);
    await expect(readLocalProjectBackup(tampered)).rejects.toThrow(/checksum/);
  });
  it('rejects unrecognized extra entries and invalid ZIP input', async () => {
    const backup = await createLocalProjectBackup([await makeFixture()]);
    const files = unzipSync(new Uint8Array(await backup.arrayBuffer()));
    files['outside.txt'] = encoder.encode('unexpected');
    const injected = new Blob([new Uint8Array(zipSync(files))]);
    await expect(readLocalProjectBackup(injected)).rejects.toThrow(/unsafe entry/);
    await expect(readLocalProjectBackup(new Blob(['not zip']))).rejects.toThrow();
  });
  it('creates distinct copies when two projects are restored', async () => {
    const original = await makeFixture();
    const second: LocalModelRecord = {
      ...original,
      id: 'built-in:example',
      origin: 'built-in',
      name: 'Edited built-in',
    };
    const copies = await readLocalProjectBackup(await createLocalProjectBackup([original, second]));
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map((item) => item.id)).size).toBe(2);
    expect(copies[1].origin).toBe('upload');
    expect(copies[1].name).toBe('Edited built-in');
  });
});
