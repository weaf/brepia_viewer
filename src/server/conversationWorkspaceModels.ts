import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  getOpenScadEntrypoint,
  normalizeOpenScadProject,
  replaceOpenScadProjectFileContent,
  type OpenScadProject,
} from '@shared/openScadProject';
import {
  conversationCurrentModelDir,
  conversationModelDir,
  conversationModelRevisionDir,
  conversationModelRevisionFilePath,
  conversationModelRevisionProjectPath,
  conversationModelRevisionsDir,
} from './conversationWorkspace';
import { getAnonSupabaseClient } from './supabaseClient';

export type ConversationMessageRow = {
  id: string;
  parent_message_id: string | null;
  created_at: string | null;
  role: string;
  parts: unknown;
  metadata?: unknown;
};

export type ConversationModelRevisionSource = 'build' | 'parameter-edit';

export type SuccessfulParametricBuild = {
  toolCallId: string;
  messageId: string;
  messageCreatedAt: string | null;
  title: string;
  version: string;
  project: OpenScadProject;
  source: ConversationModelRevisionSource;
};

export type ConversationModelSyncResult = {
  discovered: number;
  revisionsCreated: number;
  currentRevision: number | null;
};

export type ConversationModelRevisionMetadata = {
  revision: number;
  toolCallId: string;
  messageId: string;
  messageCreatedAt: string | null;
  title: string;
  version: string;
  source: ConversationModelRevisionSource;
  projectSha256: string;
  entrypointPath: string;
  savedAt: string;
};

type RevisionState = {
  metadata: ConversationModelRevisionMetadata[];
  maxRevision: number;
};

type ModelSyncDependencies = {
  loadMessages?: (
    request: Request,
    conversationId: string,
  ) => Promise<ConversationMessageRow[]>;
};

const conversationLocks = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function conversationModelProjectSha256(project: OpenScadProject): string {
  const normalized = normalizeOpenScadProject(project);
  return createHash('sha256')
    .update(JSON.stringify(normalized), 'utf8')
    .digest('hex');
}

function originalCodeFromMessage(
  message: ConversationMessageRow,
): string | null {
  if (!isRecord(message.metadata)) return null;
  const originalCode = message.metadata.originalCode;
  return typeof originalCode === 'string' && originalCode.trim()
    ? originalCode
    : null;
}

function normalizeProject(value: unknown): OpenScadProject | null {
  if (!isRecord(value)) return null;
  try {
    return normalizeOpenScadProject(value as OpenScadProject);
  } catch {
    return null;
  }
}

function parseSuccessfulBuildPart(
  part: unknown,
  message: ConversationMessageRow,
): SuccessfulParametricBuild[] {
  if (!isRecord(part)) return [];
  if (part.type !== 'tool-build_parametric_model') return [];
  if (part.state !== 'output-available') return [];
  if (typeof part.toolCallId !== 'string' || !part.toolCallId) return [];
  if (!isRecord(part.input) || !isRecord(part.output)) return [];
  if (part.output.status !== 'success') return [];

  const title = part.input.title;
  const version = part.input.version;
  const project = normalizeProject(part.input.project);
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    typeof version !== 'string' ||
    !version.trim() ||
    !project
  ) {
    return [];
  }

  const shared = {
    toolCallId: part.toolCallId,
    messageId: message.id,
    messageCreatedAt: message.created_at,
    title,
    version,
  };
  const originalCode = originalCodeFromMessage(message);
  const entrypointCode = getOpenScadEntrypoint(project).content;
  if (originalCode && originalCode !== entrypointCode) {
    const originalProject = replaceOpenScadProjectFileContent(
      project,
      project.entrypointPath,
      originalCode,
    );
    return [
      { ...shared, project: originalProject, source: 'build' },
      { ...shared, project, source: 'parameter-edit' },
    ];
  }

  return [{ ...shared, project, source: 'build' }];
}

/**
 * Walk only the active parent chain. Successful builds that exist solely on an
 * abandoned sibling branch never become the current project snapshot.
 *
 * Parameter edits are persisted in-place on the original tool part. When the
 * UI has captured `metadata.originalCode`, emit both the original project
 * snapshot and the currently edited project. Only the entrypoint differs; all
 * support files remain part of both complete snapshots.
 */
export function collectSuccessfulParametricBuilds(
  rows: ConversationMessageRow[],
  leafId: string | null,
): SuccessfulParametricBuild[] {
  if (!leafId) return [];

  const byId = new Map(rows.map((row) => [row.id, row]));
  const branch: ConversationMessageRow[] = [];
  const seen = new Set<string>();
  let currentId: string | null = leafId;

  while (currentId) {
    if (seen.has(currentId)) {
      throw new Error(`Conversation message parent cycle at ${currentId}`);
    }
    seen.add(currentId);

    const row = byId.get(currentId);
    if (!row) {
      throw new Error(`Conversation branch message not found: ${currentId}`);
    }
    branch.push(row);
    currentId = row.parent_message_id;
  }

  branch.reverse();
  const builds: SuccessfulParametricBuild[] = [];
  for (const row of branch) {
    if (row.role !== 'assistant' || !Array.isArray(row.parts)) continue;
    for (const part of row.parts) {
      builds.push(...parseSuccessfulBuildPart(part, row));
    }
  }
  return builds;
}

async function defaultLoadMessages(
  request: Request,
  conversationId: string,
): Promise<ConversationMessageRow[]> {
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
    .from('messages')
    .select('id, parent_message_id, created_at, role, parts, metadata')
    .eq('conversation_id', conversationId);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    parent_message_id: row.parent_message_id,
    created_at: row.created_at,
    role: row.role,
    parts: row.parts,
    metadata: row.metadata,
  }));
}

function revisionNumberFromEntry(entry: string): number | null {
  const match = /^(\d{3,})$/.exec(entry);
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}

function parseRevisionMetadata(
  raw: unknown,
): ConversationModelRevisionMetadata | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.revision !== 'number' ||
    typeof raw.toolCallId !== 'string' ||
    typeof raw.messageId !== 'string' ||
    !(raw.messageCreatedAt === null || typeof raw.messageCreatedAt === 'string') ||
    typeof raw.title !== 'string' ||
    typeof raw.version !== 'string' ||
    typeof raw.projectSha256 !== 'string' ||
    typeof raw.entrypointPath !== 'string' ||
    typeof raw.savedAt !== 'string'
  ) {
    return null;
  }

  const source: ConversationModelRevisionSource =
    raw.source === 'parameter-edit' ? 'parameter-edit' : 'build';
  return {
    revision: raw.revision,
    toolCallId: raw.toolCallId,
    messageId: raw.messageId,
    messageCreatedAt: raw.messageCreatedAt,
    title: raw.title,
    version: raw.version,
    source,
    projectSha256: raw.projectSha256,
    entrypointPath: raw.entrypointPath,
    savedAt: raw.savedAt,
  };
}

async function readRevisionState(
  conversationId: string,
): Promise<RevisionState> {
  const directory = conversationModelRevisionsDir(conversationId);
  const entries = await readdir(directory).catch((error: unknown) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return [] as string[];
    }
    throw error;
  });

  let maxRevision = 0;
  const metadata: ConversationModelRevisionMetadata[] = [];
  for (const entry of entries) {
    const revision = revisionNumberFromEntry(entry);
    if (!revision) continue;
    maxRevision = Math.max(maxRevision, revision);
    const projectPath = conversationModelRevisionProjectPath(
      conversationId,
      revision,
    );
    let parsed: ConversationModelRevisionMetadata | null = null;
    try {
      const manifest: unknown = JSON.parse(await readFile(projectPath, 'utf8'));
      if (isRecord(manifest)) parsed = parseRevisionMetadata(manifest.metadata);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue;
      }
      throw error;
    }
    if (parsed) metadata.push(parsed);
  }
  metadata.sort((a, b) => a.revision - b.revision);
  return { metadata, maxRevision };
}

export async function listConversationModelRevisions(
  conversationId: string,
): Promise<ConversationModelRevisionMetadata[]> {
  return (await readRevisionState(conversationId)).metadata;
}

export async function findConversationModelRevisionByProjectSha(
  conversationId: string,
  projectSha256: string,
): Promise<ConversationModelRevisionMetadata | null> {
  const revisions = await listConversationModelRevisions(conversationId);
  return (
    revisions
      .filter((metadata) => metadata.projectSha256 === projectSha256)
      .sort((a, b) => b.revision - a.revision)[0] ?? null
  );
}

function snapshotDocument(
  project: OpenScadProject,
  metadata: ConversationModelRevisionMetadata,
): string {
  return `${JSON.stringify({ project, metadata }, null, 2)}\n`;
}

async function materializeSnapshot(
  root: string,
  project: OpenScadProject,
  metadata: ConversationModelRevisionMetadata,
): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const file of project.files) {
    const destination = join(root, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, 'utf8');
  }
  await writeFile(
    join(root, 'project.json'),
    snapshotDocument(project, metadata),
    'utf8',
  );
}

async function readSnapshotProject(path: string): Promise<OpenScadProject> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isRecord(raw) || !isRecord(raw.project)) {
    throw new Error(`Invalid OpenSCAD project snapshot: ${path}`);
  }
  return normalizeOpenScadProject(raw.project as OpenScadProject);
}

async function ensureExistingRevisionMatches(
  conversationId: string,
  metadata: ConversationModelRevisionMetadata,
  build: SuccessfulParametricBuild,
): Promise<void> {
  const expectedHash = conversationModelProjectSha256(build.project);
  if (expectedHash !== metadata.projectSha256) {
    throw new Error(
      `Immutable model revision ${metadata.revision} identity mismatch`,
    );
  }

  const snapshotPath = conversationModelRevisionProjectPath(
    conversationId,
    metadata.revision,
  );
  const project = await readSnapshotProject(snapshotPath);
  if (conversationModelProjectSha256(project) !== metadata.projectSha256) {
    throw new Error(
      `Immutable model revision ${metadata.revision} checksum mismatch`,
    );
  }

  for (const file of project.files) {
    const materialized = await readFile(
      conversationModelRevisionFilePath(
        conversationId,
        metadata.revision,
        file.path,
      ),
      'utf8',
    );
    if (materialized !== file.content) {
      throw new Error(
        `Immutable model revision ${metadata.revision} materialized file mismatch: ${file.path}`,
      );
    }
  }
}

async function createRevision(
  conversationId: string,
  revision: number,
  build: SuccessfulParametricBuild,
): Promise<ConversationModelRevisionMetadata> {
  const project = normalizeOpenScadProject(build.project);
  const metadata: ConversationModelRevisionMetadata = {
    revision,
    toolCallId: build.toolCallId,
    messageId: build.messageId,
    messageCreatedAt: build.messageCreatedAt,
    title: build.title,
    version: build.version,
    source: build.source,
    projectSha256: conversationModelProjectSha256(project),
    entrypointPath: project.entrypointPath,
    savedAt: new Date().toISOString(),
  };

  const finalDir = conversationModelRevisionDir(conversationId, revision);
  const tempDir = `${finalDir}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(finalDir), { recursive: true });
  try {
    await materializeSnapshot(tempDir, project, metadata);
    await rename(tempDir, finalDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return metadata;
}

function revisionIdentity(toolCallId: string, projectSha256: string): string {
  return `${toolCallId}:${projectSha256}`;
}

async function replaceCurrentSnapshot(
  conversationId: string,
  build: SuccessfulParametricBuild,
  metadata: ConversationModelRevisionMetadata,
): Promise<void> {
  const finalDir = conversationCurrentModelDir(conversationId);
  const tempDir = `${finalDir}.${process.pid}.${randomUUID()}.tmp`;
  const project = normalizeOpenScadProject(build.project);
  try {
    await materializeSnapshot(tempDir, project, metadata);
    await rm(finalDir, { recursive: true, force: true });
    await rename(tempDir, finalDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function removeLegacyModelMirror(conversationId: string): Promise<void> {
  const modelDir = conversationModelDir(conversationId);
  const revisionsDir = conversationModelRevisionsDir(conversationId);
  await Promise.all([
    rm(join(modelDir, 'current.scad'), { force: true }),
    rm(join(modelDir, 'current.json'), { force: true }),
  ]);
  const entries = await readdir(revisionsDir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((entry) => /^\d{3,}\.(?:scad|json)$/.test(entry))
      .map((entry) => rm(join(revisionsDir, entry), { force: true })),
  );
}

async function persistBuildsLocked(
  conversationId: string,
  builds: SuccessfulParametricBuild[],
): Promise<ConversationModelSyncResult> {
  await removeLegacyModelMirror(conversationId);
  const state = await readRevisionState(conversationId);
  const byIdentity = new Map(
    state.metadata.map((metadata) => [
      revisionIdentity(metadata.toolCallId, metadata.projectSha256),
      metadata,
    ]),
  );
  let nextRevision = state.maxRevision + 1;
  let revisionsCreated = 0;
  let currentMetadata: ConversationModelRevisionMetadata | null = null;

  for (const build of builds) {
    const projectHash = conversationModelProjectSha256(build.project);
    const identity = revisionIdentity(build.toolCallId, projectHash);
    let metadata = byIdentity.get(identity);
    if (metadata) {
      await ensureExistingRevisionMatches(conversationId, metadata, build);
    } else {
      metadata = await createRevision(conversationId, nextRevision, build);
      byIdentity.set(identity, metadata);
      nextRevision += 1;
      revisionsCreated += 1;
    }
    currentMetadata = metadata;
  }

  const latestBuild = builds.at(-1);
  if (latestBuild && currentMetadata) {
    await replaceCurrentSnapshot(conversationId, latestBuild, currentMetadata);
  }

  return {
    discovered: builds.length,
    revisionsCreated,
    currentRevision: currentMetadata?.revision ?? null,
  };
}

async function withConversationLock<T>(
  conversationId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = conversationLocks.get(conversationId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  conversationLocks.set(conversationId, queued);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (conversationLocks.get(conversationId) === queued) {
      conversationLocks.delete(conversationId);
    }
  }
}

/**
 * Mirror complete normalized OpenSCAD project snapshots from the active
 * authoritative conversation branch. Revisions are immutable and idempotent
 * by toolCallId + whole-project hash. The local filesystem remains a
 * best-effort operational mirror; Supabase/message state is authoritative.
 */
export async function syncConversationModelSources(
  request: Request,
  conversationId: string,
  leafId: string | null,
  dependencies: ModelSyncDependencies = {},
): Promise<ConversationModelSyncResult> {
  if (!leafId) {
    return { discovered: 0, revisionsCreated: 0, currentRevision: null };
  }
  const loadMessages = dependencies.loadMessages ?? defaultLoadMessages;
  const rows = await loadMessages(request, conversationId);
  const builds = collectSuccessfulParametricBuilds(rows, leafId);
  return withConversationLock(conversationId, () =>
    persistBuildsLocked(conversationId, builds),
  );
}
