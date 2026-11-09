import { zipSync } from 'fflate';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { normalizeOpenScadProject, type OpenScadProject } from '@shared/openScadProject';
import {
  validateOpenScadProjectAssetReferences,
  validateOpenScadProjectSourceReferences,
} from '@shared/openScadProjectReferences';
import { createUuid } from '@/lib/uuid';
import type { LocalModelRecord } from '@/services/localModelLibrary';

const BACKUP_KIND = 'brepia-viewer-local-projects';
const BACKUP_VERSION = 1;
const MAX_MODELS = 200;
const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 96 * 1024 * 1024;
const MAX_ENTRIES = 1 + MAX_MODELS * 32;
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;

type BackupModel = {
  name: string;
  originalOrigin: 'upload' | 'built-in';
  project: OpenScadProject;
};

type BackupManifest = {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  models: BackupModel[];
};

type ReadableZipEntry = {
  getData: (writer: Uint8ArrayWriter) => Promise<Uint8Array>;
};

function hasEntryData(entry: unknown): entry is ReadableZipEntry {
  return typeof entry === 'object' && entry !== null &&
    'getData' in entry &&
    typeof (entry as { getData?: unknown }).getData === 'function';
}

function assetFileName(modelIndex: number, assetIndex: number): string {
  // Content names are positional, never based on untrusted model paths.
  return 'assets/' + modelIndex + '/' + assetIndex;
}

function assertSize(currentBytes: number): void {
  if (currentBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new Error('Project backup exceeds the safe browser memory limit.');
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', stable.buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Serialize browser-local projects without writing or changing local storage. */
export async function createLocalProjectBackup(
  records: readonly LocalModelRecord[],
): Promise<Blob> {
  if (records.length < 1 || records.length > MAX_MODELS) {
    throw new Error('Select between 1 and ' + MAX_MODELS + ' saved projects for backup.');
  }

  const files: Record<string, Uint8Array> = {};
  const models: BackupModel[] = [];
  let bytesTotal = 0;

  for (const [modelIndex, record] of records.entries()) {
    if (typeof record.name !== 'string' || !record.name.trim() || record.name.length > 200) {
      throw new Error('Saved project has an invalid name.');
    }
    const project = normalizeOpenScadProject(record.project);
    validateOpenScadProjectSourceReferences(project);
    validateOpenScadProjectAssetReferences(project);
    for (const [assetIndex, asset] of (project.assets ?? []).entries()) {
      const blob = record.assetBlobs[asset.path];
      if (!(blob instanceof Blob) || blob.size !== asset.byteLength) {
        throw new Error('Saved asset missing or has wrong size: ' + asset.path);
      }
      const data = new Uint8Array(await blob.arrayBuffer());
      if (await sha256(data) !== asset.sha256) {
        throw new Error('Saved asset checksum mismatch: ' + asset.path);
      }
      files[assetFileName(modelIndex, assetIndex)] = data;
      bytesTotal += data.byteLength;
      assertSize(bytesTotal);
    }
    models.push({ name: record.name, originalOrigin: record.origin, project });
  }

  const manifest: BackupManifest = {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    models,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('Project backup manifest is too large.');
  }
  bytesTotal += manifestBytes.byteLength;
  assertSize(bytesTotal);
  files['manifest.json'] = manifestBytes;
  const archive = zipSync(files, { level: 4 });
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('Project backup ZIP is too large.');
  }
  return new Blob([new Uint8Array(archive)], { type: 'application/zip' });
}

/**
 * Validate every file before offering copies to the caller.
 * This function never mutates IndexedDB: callers must confirm and persist.
 */
export async function readLocalProjectBackup(
  archive: Blob,
): Promise<LocalModelRecord[]> {
  if (!(archive instanceof Blob) || archive.size < 10 || archive.size > MAX_ARCHIVE_BYTES) {
    throw new Error('Invalid or oversized Brepia backup ZIP.');
  }
  const reader = new ZipReader(new BlobReader(archive));
  try {
    const entries = await reader.getEntries();
    if (!entries.length || entries.length > MAX_ENTRIES) {
      throw new Error('Backup ZIP contains an invalid number of entries.');
    }

    const byName = new Map<string, (typeof entries)[number]>();
    let totalBytes = 0;
    for (const entry of entries) {
      if (entry.directory || byName.has(entry.filename) ||
          !/^(manifest\.json|assets\/[0-9]+\/[0-9]+)$/.test(entry.filename)) {
        throw new Error('Backup ZIP contains a duplicate or unsafe entry.');
      }
      if (!Number.isSafeInteger(entry.uncompressedSize) ||
          entry.uncompressedSize < 0) {
        throw new Error('Backup ZIP contains an invalid uncompressed size.');
      }
      totalBytes += entry.uncompressedSize;
      assertSize(totalBytes);
      byName.set(entry.filename, entry);
    }

    const manifestEntry = byName.get('manifest.json');
    if (!hasEntryData(manifestEntry) || manifestEntry.uncompressedSize > MAX_MANIFEST_BYTES) {
      throw new Error('Backup ZIP is missing a valid manifest.');
    }
    const manifestBytes = await manifestEntry.getData(new Uint8ArrayWriter());
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as BackupManifest;
    if (!parsed || parsed.kind !== BACKUP_KIND ||
        parsed.version !== BACKUP_VERSION ||
        !Array.isArray(parsed.models) ||
        parsed.models.length < 1 ||
        parsed.models.length > MAX_MODELS) {
      throw new Error('Unsupported Brepia backup format or version.');
    }

    const expected = new Set<string>(['manifest.json']);
    const copies: LocalModelRecord[] = [];
    for (const [modelIndex, saved] of parsed.models.entries()) {
      if (!saved || typeof saved.name !== 'string' ||
          !saved.name.trim() || saved.name.length > 200 ||
          (saved.originalOrigin !== 'upload' && saved.originalOrigin !== 'built-in')) {
        throw new Error('Backup manifest contains an invalid model.');
      }
      const project = normalizeOpenScadProject(saved.project);
      validateOpenScadProjectSourceReferences(project);
      validateOpenScadProjectAssetReferences(project);

      const assetBlobs: Record<string, Blob> = {};
      for (const [assetIndex, asset] of (project.assets ?? []).entries()) {
        const name = assetFileName(modelIndex, assetIndex);
        expected.add(name);
        const entry = byName.get(name);
        if (!hasEntryData(entry) || entry.uncompressedSize !== asset.byteLength) {
          throw new Error('Backup is missing an expected asset: ' + asset.path);
        }
        const raw = await entry.getData(new Uint8ArrayWriter());
        const data = new Uint8Array(raw);
        if (data.byteLength !== asset.byteLength || await sha256(data) !== asset.sha256) {
          throw new Error('Backup asset checksum mismatch: ' + asset.path);
        }
        assetBlobs[asset.path] = new Blob([data], { type: asset.mediaType });
      }
      copies.push({
        id: 'upload:' + createUuid(),
        name: saved.name,
        origin: 'upload', // Never overwrite a built-in or existing local record.
        project,
        assetBlobs,
        updatedAt: new Date().toISOString(),
      });
    }
    if (expected.size !== byName.size ||
        [...byName.keys()].some((name) => !expected.has(name))) {
      throw new Error('Backup ZIP contains unexpected content.');
    }
    return copies;
  } finally {
    await reader.close();
  }
}
