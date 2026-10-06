import { isRecord } from '@/server/api';
import { deleteUserConversationWorkspaces } from '@/server/conversationTeardown';
import {
  getServiceRoleSupabaseClient,
  type SupabaseClient,
} from '@/server/supabaseClient';

export type TeardownOptions = {
  /**
   * Await storage deletion BEFORE removing the auth user, and let a storage
   * failure propagate. Used by the server-to-server purge route so its 200
   * only means "actually erased" and a failure leaves the auth user intact for
   * a safe retry (the retry re-lists and finishes the job). The default
   * (session-initiated delete) removes the auth user first and cleans storage
   * in the background, for a fast user-facing response.
   */
  awaitStorage?: boolean;
};

/**
 * Runs the full teardown for a single user: deletes Brepia's local
 * conversation workspaces, deletes the Supabase auth user (which cascades
 * sessions, accounts, and user-keyed rows via FK / RLS cascade), and removes
 * the user's storage objects. Both the session-authed `delete-user` route and
 * the internal server-to-server `internal/account/delete` route call this so
 * teardown behavior stays identical.
 *
 * Local workspace deletion always happens while conversation rows still exist,
 * because auth deletion cascades those rows. Storage ordering depends on
 * `awaitStorage` (see TeardownOptions).
 */
export async function teardownUser(
  supabase: SupabaseClient,
  user: { id: string },
  options: TeardownOptions = {},
): Promise<void> {
  if (options.awaitStorage) {
    // Storage/workspace-first, awaited: if either throws the auth user still
    // exists, so the caller can retry without silently orphaning artifacts.
    await deleteUserStorageItems(supabase, user.id);
    await deleteUserConversationWorkspaces(supabase, user.id);
    const { error: deleteError } = await supabase.auth.admin.deleteUser(
      user.id,
    );
    if (deleteError) {
      throw new Error(`Failed to delete auth user: ${deleteError.message}`);
    }
    return;
  }

  // Local workspaces must be enumerated before auth deletion cascades the
  // conversation rows. Storage remains background cleanup for the fast
  // user-facing path, preserving the existing response semantics.
  await deleteUserConversationWorkspaces(supabase, user.id);
  const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
  if (deleteError) {
    throw new Error(`Failed to delete auth user: ${deleteError.message}`);
  }
  runBackgroundTask(deleteUserStorageItems(supabase, user.id));
}

/**
 * Look up a Supabase auth user by email (case-insensitive, trimmed). Returns
 * null when no user matches. Uses the admin `listUsers` pagination because the
 * installed auth-js does not expose a direct get-by-email admin method.
 */
export async function findAuthUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      throw new Error(`Failed to list auth users: ${error.message}`);
    }
    for (const candidate of data.users) {
      if (candidate.email?.trim().toLowerCase() === normalized) {
        return { id: candidate.id, email: candidate.email };
      }
    }
    if (data.users.length < perPage) break;
  }
  return null;
}

export { getServiceRoleSupabaseClient };

function runBackgroundTask(task: Promise<unknown>) {
  const loggedTask = task.catch((error) => {
    console.error('Failed to delete user storage items:', error);
  });
  const requestContext = Reflect.get(
    globalThis,
    Symbol.for('@vercel/request-context'),
  );
  if (isRecord(requestContext) && typeof requestContext.get === 'function') {
    const context = requestContext.get();
    if (isRecord(context) && typeof context.waitUntil === 'function') {
      context.waitUntil(loggedTask);
      return;
    }
  }
  void loggedTask;
}

/**
 * Delete every object the user owns across the storage buckets. Errors
 * PROPAGATE (they used to be swallowed): the background caller wraps this in
 * runBackgroundTask (which logs), while the awaited purge caller relies on the
 * throw to retry. Idempotent — a retry re-lists and removes only what remains.
 */
async function deleteUserStorageItems(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  for (const bucket of ['images', 'meshes', 'previews']) {
    const paths = await listAllPaths(supabase, bucket, userId);
    for (let i = 0; i < paths.length; i += 1000) {
      const { error } = await supabase.storage
        .from(bucket)
        .remove(paths.slice(i, i + 1000));
      if (error) throw error;
    }
  }
}

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
