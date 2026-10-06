import { lstat, readFile, realpath, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { conversationRoot } from './conversationWorkspace';
import { deleteOwnedConversations } from './conversationTeardown';
import { getServiceRoleSupabaseClient } from './supabaseClient';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export type AdminWorkspaceDeleteResult = {
  success: true;
  orphaned: boolean;
};

function assertConversationId(conversationId: string): void {
  if (!UUID_PATTERN.test(conversationId)) {
    throw new Error('invalid_conversation_id');
  }
}

function normalizePath(value: string): string {
  return value.split('\\').join('/');
}

function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  ) {
    return;
  }
  throw new Error('invalid_asset_path');
}

export async function readAdminWorkspaceImage(
  conversationId: string,
  relativePath: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  assertConversationId(conversationId);
  if (!relativePath || isAbsolute(relativePath)) {
    throw new Error('invalid_asset_path');
  }

  const normalized = normalizePath(relativePath);
  if (
    !normalized.startsWith('renders/') &&
    !normalized.startsWith('input/images/')
  ) {
    throw new Error('invalid_asset_path');
  }

  const extension = normalized.split('.').at(-1)?.toLowerCase() ?? '';
  const contentType = IMAGE_CONTENT_TYPES[extension];
  if (!contentType) throw new Error('invalid_asset_type');

  const root = conversationRoot(conversationId);
  const target = resolve(root, normalized);
  assertInside(root, target);

  const fileStat = await lstat(target);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error('invalid_asset_path');
  }

  const [realRoot, realTarget] = await Promise.all([
    realpath(root),
    realpath(target),
  ]);
  assertInside(realRoot, realTarget);

  return { bytes: new Uint8Array(await readFile(realTarget)), contentType };
}

export async function deleteAdminModelWorkspace(
  conversationId: string,
): Promise<AdminWorkspaceDeleteResult> {
  assertConversationId(conversationId);

  const supabase = getServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from('conversations')
    .select('id,user_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw error;

  if (data) {
    await deleteOwnedConversations(supabase, data.user_id, [conversationId]);
    return { success: true, orphaned: false };
  }

  // An orphaned workspace has no authoritative conversation row and therefore
  // no trustworthy user/storage ownership to act on. Only remove its validated
  // local UUID workspace; never guess a Supabase storage prefix.
  await rm(conversationRoot(conversationId), { recursive: true, force: true });
  return { success: true, orphaned: true };
}
