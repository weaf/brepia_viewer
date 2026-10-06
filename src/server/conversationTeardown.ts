import { rm } from 'node:fs/promises';
import { conversationRoot } from './conversationWorkspace';
import type { SupabaseClient } from './supabaseClient';

const STORAGE_BUCKETS = ['images', 'meshes', 'previews'] as const;

async function listAllPaths(
  supabase: SupabaseClient,
  bucket: string,
  folder: string,
): Promise<string[]> {
  const paths: string[] = [];
  const limit = 1000;

  for (let offset = 0; ; offset += limit) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    if (!data.length) break;

    for (const item of data) {
      const path = `${folder}/${item.name}`;
      if ('id' in item && item.id) paths.push(path);
      else paths.push(...(await listAllPaths(supabase, bucket, path)));
    }

    if (data.length < limit) break;
  }

  return paths;
}

async function deleteStorageFolder(
  supabase: SupabaseClient,
  bucket: string,
  folder: string,
): Promise<void> {
  const paths = await listAllPaths(supabase, bucket, folder);
  for (let i = 0; i < paths.length; i += 1000) {
    const { error } = await supabase.storage
      .from(bucket)
      .remove(paths.slice(i, i + 1000));
    if (error) throw error;
  }
}

export async function deleteConversationArtifacts(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<void> {
  const storageFolder = `${userId}/${conversationId}`;

  for (const bucket of STORAGE_BUCKETS) {
    await deleteStorageFolder(supabase, bucket, storageFolder);
  }

  // conversationRoot validates the UUID and guarantees that the resolved path
  // remains inside BREPIA_CONVERSATIONS_DIR before rm ever sees it.
  await rm(conversationRoot(conversationId), { recursive: true, force: true });
}

export async function deleteOwnedConversations(
  supabase: SupabaseClient,
  userId: string,
  conversationIds: string[],
): Promise<void> {
  const uniqueIds = Array.from(new Set(conversationIds));
  if (uniqueIds.length === 0) return;

  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .in('id', uniqueIds);
  if (error) throw error;

  const ownedIds = new Set((data ?? []).map((row) => row.id));
  if (ownedIds.size !== uniqueIds.length) {
    throw new Error('conversation_not_found_or_not_owned');
  }

  // Artifact cleanup happens before the database delete so a successful DB
  // deletion cannot leave Brepia-managed files orphaned on disk or in storage.
  for (const conversationId of uniqueIds) {
    await deleteConversationArtifacts(supabase, userId, conversationId);
  }

  const { error: deleteError } = await supabase
    .from('conversations')
    .delete()
    .eq('user_id', userId)
    .in('id', uniqueIds);
  if (deleteError) throw deleteError;
}

export async function deleteUserConversationWorkspaces(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId);
  if (error) throw error;

  for (const row of data ?? []) {
    await rm(conversationRoot(row.id), { recursive: true, force: true });
  }
}
