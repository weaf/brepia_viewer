import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { conversationWorkspaceRoot } from './conversationWorkspace';
import { getServiceRoleSupabaseClient } from './supabaseClient';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_EXTENSIONS = new Set([
  '3mf',
  'dxf',
  'glb',
  'gltf',
  'obj',
  'off',
  'ply',
  'scad',
  'step',
  'stl',
  'stp',
]);
const IMAGE_EXTENSIONS = new Set(['jpeg', 'jpg', 'png', 'webp']);

export type AdminModelFileKind = 'generated' | 'parametric' | 'export';
export type AdminImageFileKind = 'render' | 'input';

export type AdminModelFile = {
  name: string;
  relativePath: string;
  absolutePath: string;
  kind: AdminModelFileKind;
  sizeBytes: number;
  modifiedAt: string;
};

export type AdminImageFile = {
  name: string;
  relativePath: string;
  absolutePath: string;
  kind: AdminImageFileKind;
  sizeBytes: number;
  modifiedAt: string;
};

export type AdminConversationWorkspace = {
  conversationId: string;
  title: string | null;
  type: string | null;
  userId: string | null;
  ownerLabel: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  workspacePath: string;
  workspaceExists: boolean;
  missingWorkspace: boolean;
  totalBytes: number;
  fileCount: number;
  modelCount: number;
  imageCount: number;
  orphaned: boolean;
  models: AdminModelFile[];
  images: AdminImageFile[];
};

export type AdminModelInventory = {
  workspaceRoot: string;
  conversationCount: number;
  workspaceCount: number;
  missingWorkspaceCount: number;
  orphanedCount: number;
  modelCount: number;
  imageCount: number;
  totalBytes: number;
  workspaces: AdminConversationWorkspace[];
};

type ConversationRow = {
  id: string;
  user_id: string;
  title: string | null;
  type: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ProfileRow = {
  user_id: string;
  full_name: string;
};

type AccountRow = {
  user_id: string;
  username: string | null;
  contact_email: string | null;
};

type WorkspaceManifest = {
  title: string | null;
  type: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type WalkResult = {
  totalBytes: number;
  fileCount: number;
  models: AdminModelFile[];
  images: AdminImageFile[];
};

function normalizePathSeparators(value: string): string {
  return value.split('\\').join('/');
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function readWorkspaceManifest(
  workspacePath: string,
): Promise<WorkspaceManifest | null> {
  try {
    const raw = JSON.parse(
      await readFile(join(workspacePath, 'conversation.json'), 'utf8'),
    ) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return null;
    }
    const record = raw as Record<string, unknown>;
    return {
      title: stringOrNull(record.title),
      type: stringOrNull(record.type),
      createdAt: stringOrNull(record.createdAt),
      updatedAt: stringOrNull(record.updatedAt),
    };
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

function modelKind(relativePath: string): AdminModelFileKind | null {
  const normalized = normalizePathSeparators(relativePath);
  const extension = normalized.split('.').at(-1)?.toLowerCase() ?? '';
  if (!MODEL_EXTENSIONS.has(extension)) return null;
  if (normalized.startsWith('models/generated/')) return 'generated';
  if (normalized.startsWith('models/')) return 'parametric';
  if (normalized.startsWith('exports/')) return 'export';
  return null;
}

function imageKind(relativePath: string): AdminImageFileKind | null {
  const normalized = normalizePathSeparators(relativePath);
  const extension = normalized.split('.').at(-1)?.toLowerCase() ?? '';
  if (!IMAGE_EXTENSIONS.has(extension)) return null;
  if (normalized.startsWith('renders/')) return 'render';
  if (normalized.startsWith('input/images/')) return 'input';
  return null;
}

async function walkWorkspace(
  root: string,
  directory: string,
): Promise<WalkResult> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      return { totalBytes: 0, fileCount: 0, models: [], images: [] };
    }
    throw error;
  }

  let totalBytes = 0;
  let fileCount = 0;
  const models: AdminModelFile[] = [];
  const images: AdminImageFile[] = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const nested = await walkWorkspace(root, absolutePath);
      totalBytes += nested.totalBytes;
      fileCount += nested.fileCount;
      models.push(...nested.models);
      images.push(...nested.images);
      continue;
    }
    if (!entry.isFile()) continue;

    const fileStat = await stat(absolutePath);
    totalBytes += fileStat.size;
    fileCount += 1;
    const relativePath = normalizePathSeparators(relative(root, absolutePath));
    const common = {
      name: entry.name,
      relativePath,
      absolutePath,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    };
    const model = modelKind(relativePath);
    if (model) models.push({ ...common, kind: model });
    const image = imageKind(relativePath);
    if (image) images.push({ ...common, kind: image });
  }

  return { totalBytes, fileCount, models, images };
}

function chunks<T>(values: T[], size = 100): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function loadAllConversations(): Promise<ConversationRow[]> {
  const supabase = getServiceRoleSupabaseClient();
  const rows: ConversationRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id,user_id,title,type,created_at,updated_at')
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as ConversationRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export async function listAdminModelInventory(): Promise<AdminModelInventory> {
  const workspaceRoot = conversationWorkspaceRoot();
  let entries: Dirent[];
  try {
    entries = await readdir(workspaceRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) entries = [];
    else throw error;
  }

  const diskConversationIds = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        UUID_PATTERN.test(entry.name),
    )
    .map((entry) => entry.name);
  const diskConversationIdSet = new Set(diskConversationIds);

  const supabase = getServiceRoleSupabaseClient();
  const conversations = await loadAllConversations();
  const conversationById = new Map(conversations.map((row) => [row.id, row]));
  const conversationIds = Array.from(
    new Set([...conversations.map((row) => row.id), ...diskConversationIds]),
  );

  const userIds = Array.from(new Set(conversations.map((row) => row.user_id)));
  const profiles: ProfileRow[] = [];
  const accounts: AccountRow[] = [];
  for (const batch of chunks(userIds)) {
    if (batch.length === 0) continue;
    const [profileResult, accountResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('user_id,full_name')
        .in('user_id', batch),
      supabase
        .from('user_accounts')
        .select('user_id,username,contact_email')
        .in('user_id', batch),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (accountResult.error) throw accountResult.error;
    profiles.push(...((profileResult.data ?? []) as ProfileRow[]));
    accounts.push(...((accountResult.data ?? []) as AccountRow[]));
  }
  const profileByUser = new Map(profiles.map((row) => [row.user_id, row]));
  const accountByUser = new Map(accounts.map((row) => [row.user_id, row]));

  const workspaces: AdminConversationWorkspace[] = [];
  for (const conversationId of conversationIds) {
    const workspacePath = join(workspaceRoot, conversationId);
    const workspaceExists = diskConversationIdSet.has(conversationId);
    const [disk, manifest] = workspaceExists
      ? await Promise.all([
          walkWorkspace(workspacePath, workspacePath),
          readWorkspaceManifest(workspacePath),
        ])
      : [
          { totalBytes: 0, fileCount: 0, models: [], images: [] } as WalkResult,
          null,
        ];
    const row = conversationById.get(conversationId) ?? null;
    const profile = row ? profileByUser.get(row.user_id) : null;
    const account = row ? accountByUser.get(row.user_id) : null;
    const ownerLabel = row
      ? profile?.full_name ||
        account?.username ||
        account?.contact_email ||
        row.user_id
      : null;

    workspaces.push({
      conversationId,
      title: row?.title || manifest?.title || null,
      type: row?.type || manifest?.type || null,
      userId: row?.user_id ?? null,
      ownerLabel,
      createdAt: row?.created_at || manifest?.createdAt || null,
      updatedAt: row?.updated_at || manifest?.updatedAt || null,
      workspacePath,
      workspaceExists,
      missingWorkspace: row !== null && !workspaceExists,
      totalBytes: disk.totalBytes,
      fileCount: disk.fileCount,
      modelCount: disk.models.length,
      imageCount: disk.images.length,
      orphaned: row === null,
      models: disk.models.sort((a, b) =>
        b.modifiedAt.localeCompare(a.modifiedAt),
      ),
      images: disk.images.sort((a, b) =>
        b.modifiedAt.localeCompare(a.modifiedAt),
      ),
    });
  }

  workspaces.sort((a, b) => {
    if (a.orphaned !== b.orphaned) return a.orphaned ? -1 : 1;
    if (a.missingWorkspace !== b.missingWorkspace) {
      return a.missingWorkspace ? -1 : 1;
    }
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  });

  return {
    workspaceRoot,
    conversationCount: conversations.length,
    workspaceCount: diskConversationIds.length,
    missingWorkspaceCount: workspaces.filter(
      (workspace) => workspace.missingWorkspace,
    ).length,
    orphanedCount: workspaces.filter((workspace) => workspace.orphaned).length,
    modelCount: workspaces.reduce(
      (sum, workspace) => sum + workspace.modelCount,
      0,
    ),
    imageCount: workspaces.reduce(
      (sum, workspace) => sum + workspace.imageCount,
      0,
    ),
    totalBytes: workspaces.reduce(
      (sum, workspace) => sum + workspace.totalBytes,
      0,
    ),
    workspaces,
  };
}
