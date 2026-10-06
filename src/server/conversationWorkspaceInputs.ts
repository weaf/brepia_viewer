import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { imageStoragePath } from '@shared/imageRefs';
import {
  conversationInputArtifactPath,
  conversationInputImagesDir,
  type ConversationInputArtifactKind,
} from './conversationWorkspace';
import { getAnonSupabaseClient } from './supabaseClient';
import { logError } from './serverLog';

const USER_UPLOADED_IMAGE_PROMPT = 'User uploaded image';
const USER_UPLOADED_MESH_PROMPT = 'User uploaded mesh';

export type ConversationInputArtifact = {
  kind: Extract<ConversationInputArtifactKind, 'image' | 'mesh'>;
  id: string;
  bucket: 'images' | 'meshes';
  storagePath: string;
  extension: string | null;
};

export type ConversationInputMirrorResult = {
  discovered: number;
  copied: number;
  existing: number;
  failed: number;
};

type DownloadedArtifact = {
  bytes: Uint8Array;
  mediaType: string | null;
};

type InputMirrorDependencies = {
  listArtifacts?: (
    request: Request,
    conversationId: string,
  ) => Promise<ConversationInputArtifact[]>;
  downloadArtifact?: (
    request: Request,
    artifact: ConversationInputArtifact,
  ) => Promise<DownloadedArtifact>;
};

function promptText(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const text = (value as Record<string, unknown>).text;
  return typeof text === 'string' ? text : null;
}

export function isUserUploadedInputPrompt(
  value: unknown,
  kind: 'image' | 'mesh',
): boolean {
  return (
    promptText(value) ===
    (kind === 'image' ? USER_UPLOADED_IMAGE_PROMPT : USER_UPLOADED_MESH_PROMPT)
  );
}

export function imageExtensionFromMediaType(mediaType: string | null): string {
  switch ((mediaType ?? '').toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'bin';
  }
}

async function defaultListArtifacts(
  request: Request,
  conversationId: string,
): Promise<ConversationInputArtifact[]> {
  const supabase = getAnonSupabaseClient({
    global: {
      headers: { Authorization: request.headers.get('Authorization') ?? '' },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return [];

  const [imagesResult, meshesResult] = await Promise.all([
    supabase
      .from('images')
      .select('id, prompt, status')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id),
    supabase
      .from('meshes')
      .select('id, prompt, status, file_type')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id),
  ]);

  if (imagesResult.error) throw imagesResult.error;
  if (meshesResult.error) throw meshesResult.error;

  const images: ConversationInputArtifact[] = (imagesResult.data ?? [])
    .filter(
      (row) =>
        row.status === 'success' &&
        isUserUploadedInputPrompt(row.prompt, 'image'),
    )
    .map((row) => ({
      kind: 'image' as const,
      id: row.id,
      bucket: 'images' as const,
      storagePath: imageStoragePath(user.id, conversationId, row.id),
      extension: null,
    }));

  const meshes: ConversationInputArtifact[] = (meshesResult.data ?? [])
    .filter(
      (row) =>
        row.status === 'success' &&
        isUserUploadedInputPrompt(row.prompt, 'mesh'),
    )
    .map((row) => ({
      kind: 'mesh' as const,
      id: row.id,
      bucket: 'meshes' as const,
      storagePath: `${user.id}/${conversationId}/${row.id}.${row.file_type}`,
      extension: row.file_type,
    }));

  return [...images, ...meshes];
}

async function defaultDownloadArtifact(
  request: Request,
  artifact: ConversationInputArtifact,
): Promise<DownloadedArtifact> {
  const supabase = getAnonSupabaseClient({
    global: {
      headers: { Authorization: request.headers.get('Authorization') ?? '' },
    },
  });
  const { data, error } = await supabase.storage
    .from(artifact.bucket)
    .download(artifact.storagePath);
  if (error) throw error;
  if (!data) throw new Error(`Missing ${artifact.kind} storage object`);

  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    mediaType: data.type || null,
  };
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

async function existingImageArtifact(
  conversationId: string,
  imageId: string,
): Promise<boolean> {
  const directory = conversationInputImagesDir(conversationId);
  try {
    const entries = await readdir(directory);
    return entries.some(
      (entry) => entry === imageId || entry.startsWith(`${imageId}.`),
    );
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

async function artifactAlreadyMirrored(
  conversationId: string,
  artifact: ConversationInputArtifact,
): Promise<boolean> {
  if (artifact.kind === 'image' && !artifact.extension) {
    return existingImageArtifact(conversationId, artifact.id);
  }
  return pathExists(
    conversationInputArtifactPath(
      conversationId,
      artifact.kind,
      artifact.id,
      artifact.extension,
    ),
  );
}

/**
 * Mirror user-uploaded inputs from private Supabase storage into the local
 * UUID-owned conversation workspace. Supabase remains authoritative; this is
 * an idempotent local copy for conversation-scoped tooling and diagnostics.
 * Individual broken/missing objects are logged and skipped so one stale input
 * cannot prevent the remaining conversation inputs from being mirrored.
 */
export async function syncConversationInputArtifacts(
  request: Request,
  conversationId: string,
  dependencies: InputMirrorDependencies = {},
): Promise<ConversationInputMirrorResult> {
  const listArtifacts = dependencies.listArtifacts ?? defaultListArtifacts;
  const downloadArtifact =
    dependencies.downloadArtifact ?? defaultDownloadArtifact;
  const artifacts = await listArtifacts(request, conversationId);

  let copied = 0;
  let existing = 0;
  let failed = 0;

  for (const artifact of artifacts) {
    try {
      if (await artifactAlreadyMirrored(conversationId, artifact)) {
        existing += 1;
        continue;
      }

      const downloaded = await downloadArtifact(request, artifact);
      const extension =
        artifact.extension ?? imageExtensionFromMediaType(downloaded.mediaType);
      const destination = conversationInputArtifactPath(
        conversationId,
        artifact.kind,
        artifact.id,
        extension,
      );
      await atomicWrite(destination, downloaded.bytes);
      copied += 1;
    } catch (error) {
      failed += 1;
      logError(error, {
        functionName: 'conversation-workspace-inputs',
        statusCode: 500,
        conversationId,
        additionalContext: {
          operation: 'mirror_input_artifact',
          artifactKind: artifact.kind,
          artifactId: artifact.id,
        },
      });
    }
  }

  return { discovered: artifacts.length, copied, existing, failed };
}
