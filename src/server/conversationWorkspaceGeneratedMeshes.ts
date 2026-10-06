import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { conversationGeneratedModelDir } from './conversationWorkspace';
import { isUserUploadedInputPrompt } from './conversationWorkspaceInputs';
import { getAnonSupabaseClient } from './supabaseClient';
import { logError } from './serverLog';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTENSION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,15}$/i;

export type ConversationGeneratedMeshArtifact = {
  id: string;
  extension: string;
  storagePath: string;
};

export type ConversationGeneratedMeshMirrorResult = {
  discovered: number;
  copied: number;
  existing: number;
  failed: number;
};

type GeneratedMeshDependencies = {
  listArtifacts?: (
    request: Request,
    conversationId: string,
  ) => Promise<ConversationGeneratedMeshArtifact[]>;
  downloadArtifact?: (
    request: Request,
    artifact: ConversationGeneratedMeshArtifact,
  ) => Promise<Uint8Array>;
};

export function conversationGeneratedMeshPath(
  conversationId: string,
  meshId: string,
  extension: string,
): string {
  if (!UUID_PATTERN.test(meshId)) {
    throw new Error(`Invalid generated mesh UUID: ${meshId}`);
  }
  const normalizedExtension = extension.replace(/^\./, '').toLowerCase();
  if (!EXTENSION_PATTERN.test(normalizedExtension)) {
    throw new Error(`Invalid generated mesh extension: ${extension}`);
  }
  return join(
    conversationGeneratedModelDir(conversationId),
    `${meshId}.${normalizedExtension}`,
  );
}

async function defaultListArtifacts(
  request: Request,
  conversationId: string,
): Promise<ConversationGeneratedMeshArtifact[]> {
  const supabase = getAnonSupabaseClient({
    global: {
      headers: { Authorization: request.headers.get('Authorization') ?? '' },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return [];

  const { data, error } = await supabase
    .from('meshes')
    .select('id, prompt, status, file_type')
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id);
  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    if (
      row.status !== 'success' ||
      typeof row.file_type !== 'string' ||
      isUserUploadedInputPrompt(row.prompt, 'mesh')
    ) {
      return [];
    }
    const extension = row.file_type;
    return [
      {
        id: row.id,
        extension,
        storagePath: `${user.id}/${conversationId}/${row.id}.${extension}`,
      },
    ];
  });
}

async function defaultDownloadArtifact(
  request: Request,
  artifact: ConversationGeneratedMeshArtifact,
): Promise<Uint8Array> {
  const supabase = getAnonSupabaseClient({
    global: {
      headers: { Authorization: request.headers.get('Authorization') ?? '' },
    },
  });
  const { data, error } = await supabase.storage
    .from('meshes')
    .download(artifact.storagePath);
  if (error) throw error;
  if (!data) throw new Error('Missing generated mesh storage object');
  return new Uint8Array(await data.arrayBuffer());
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

async function writeGeneratedMesh(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, bytes);
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Mirror successful generated meshes from authoritative Supabase storage into
 * `models/generated/` for the owning UUID conversation. User-uploaded mesh
 * inputs remain owned by `input/meshes/` and are deliberately excluded here.
 *
 * The mirror is idempotent and best-effort per artifact: one stale storage
 * object cannot prevent other generated meshes from being copied.
 */
export async function syncConversationGeneratedMeshes(
  request: Request,
  conversationId: string,
  dependencies: GeneratedMeshDependencies = {},
): Promise<ConversationGeneratedMeshMirrorResult> {
  const listArtifacts = dependencies.listArtifacts ?? defaultListArtifacts;
  const downloadArtifact =
    dependencies.downloadArtifact ?? defaultDownloadArtifact;
  const artifacts = await listArtifacts(request, conversationId);

  let copied = 0;
  let existing = 0;
  let failed = 0;

  for (const artifact of artifacts) {
    try {
      const destination = conversationGeneratedMeshPath(
        conversationId,
        artifact.id,
        artifact.extension,
      );
      if (await pathExists(destination)) {
        existing += 1;
        continue;
      }
      const bytes = await downloadArtifact(request, artifact);
      await writeGeneratedMesh(destination, bytes);
      copied += 1;
    } catch (error) {
      failed += 1;
      logError(error, {
        functionName: 'conversation-workspace-generated-meshes',
        statusCode: 500,
        conversationId,
        additionalContext: {
          operation: 'mirror_generated_mesh',
          meshId: artifact.id,
          extension: artifact.extension,
        },
      });
    }
  }

  return { discovered: artifacts.length, copied, existing, failed };
}
