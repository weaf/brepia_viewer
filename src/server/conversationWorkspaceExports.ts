import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  conversationExportRevisionMetadataPath,
  conversationExportRevisionPath,
  type ConversationExportFormat,
} from './conversationWorkspace';

export type ConversationExportMetadata = {
  revision: number;
  format: ConversationExportFormat;
  projectSha256: string;
  artifactSha256: string;
  byteLength: number;
  savedAt: string;
};

export type PersistConversationExportInput = {
  conversationId: string;
  format: ConversationExportFormat;
  revision: number;
  projectSha256: string;
  bytes: Uint8Array;
};

export type PersistConversationExportResult = {
  revision: number;
  format: ConversationExportFormat;
  written: boolean;
  artifactSha256: string;
};

function artifactSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, bytes);
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function atomicWriteText(path: string, content: string): Promise<void> {
  await atomicWrite(path, new TextEncoder().encode(content));
}

async function readExistingMetadata(
  path: string,
): Promise<ConversationExportMetadata | null> {
  if (!(await pathExists(path))) return null;
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.revision !== 'number' ||
    (record.format !== 'stl' &&
      record.format !== '3mf' &&
      record.format !== 'dxf') ||
    typeof record.projectSha256 !== 'string' ||
    typeof record.artifactSha256 !== 'string' ||
    typeof record.byteLength !== 'number' ||
    typeof record.savedAt !== 'string'
  ) {
    return null;
  }
  return record as ConversationExportMetadata;
}

/**
 * Persist the canonical exported representation for a model revision. A repeat
 * export with identical bytes is a no-op. If the exporter produces different
 * bytes for the same project revision, replace the canonical export atomically
 * and update its sidecar rather than accumulating timestamped duplicates.
 */
export async function persistConversationExportArtifact(
  input: PersistConversationExportInput,
): Promise<PersistConversationExportResult> {
  const artifactPath = conversationExportRevisionPath(
    input.conversationId,
    input.format,
    input.revision,
  );
  const metadataPath = conversationExportRevisionMetadataPath(
    input.conversationId,
    input.format,
    input.revision,
  );
  const hash = artifactSha256(input.bytes);
  const existing = await readExistingMetadata(metadataPath);

  if (
    existing?.artifactSha256 === hash &&
    existing.projectSha256 === input.projectSha256 &&
    existing.byteLength === input.bytes.byteLength &&
    (await pathExists(artifactPath))
  ) {
    return {
      revision: input.revision,
      format: input.format,
      written: false,
      artifactSha256: hash,
    };
  }

  const metadata: ConversationExportMetadata = {
    revision: input.revision,
    format: input.format,
    projectSha256: input.projectSha256,
    artifactSha256: hash,
    byteLength: input.bytes.byteLength,
    savedAt: new Date().toISOString(),
  };

  await atomicWrite(artifactPath, input.bytes);
  await atomicWriteText(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  return {
    revision: input.revision,
    format: input.format,
    written: true,
    artifactSha256: hash,
  };
}
