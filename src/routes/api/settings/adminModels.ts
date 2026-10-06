import { createFileRoute } from '@tanstack/react-router';
import {
  isRecord,
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import { AccountAdminError, requireAdmin } from '@/server/accountAdmin';
import { listAdminModelInventory } from '@/server/adminModelInventory';
import {
  deleteAdminModelWorkspace,
  readAdminWorkspaceImage,
} from '@/server/adminModelManagement';

function adminModelsError(error: unknown) {
  if (error instanceof AccountAdminError) {
    return json({ error: error.code }, error.status);
  }
  if (isUnauthorizedError(error)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (error instanceof Error) {
    if (error.message === 'invalid_conversation_id') {
      return json({ error: 'invalid_conversation_id' }, 400);
    }
    if (
      error.message === 'invalid_asset_path' ||
      error.message === 'invalid_asset_type'
    ) {
      return json({ error: error.message }, 400);
    }
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  ) {
    return json({ error: 'asset_not_found' }, 404);
  }
  console.error('[admin-model-inventory]', error);
  return json({ error: 'internal_error' }, 500);
}

export const Route = createFileRoute('/api/settings/adminModels')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request }) => {
        try {
          const user = await requireUser(request);
          await requireAdmin(user);

          const url = new URL(request.url);
          const assetConversationId = url.searchParams.get(
            'assetConversationId',
          );
          const assetPath = url.searchParams.get('assetPath');
          if (assetConversationId || assetPath) {
            if (!assetConversationId || !assetPath) {
              return json({ error: 'asset_parameters_required' }, 400);
            }
            const asset = await readAdminWorkspaceImage(
              assetConversationId,
              assetPath,
            );
            return new Response(asset.bytes, {
              status: 200,
              headers: {
                'Content-Type': asset.contentType,
                'Cache-Control': 'private, no-store',
              },
            });
          }

          return json(await listAdminModelInventory());
        } catch (error) {
          return adminModelsError(error);
        }
      },
      POST: async ({ request }) => {
        try {
          const user = await requireUser(request);
          await requireAdmin(user);
          const body: unknown = await request.json().catch(() => null);
          if (
            !isRecord(body) ||
            typeof body.conversationId !== 'string' ||
            !body.conversationId
          ) {
            return json({ error: 'conversation_id_required' }, 400);
          }
          return json(await deleteAdminModelWorkspace(body.conversationId));
        } catch (error) {
          return adminModelsError(error);
        }
      },
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
      HEAD: methodNotAllowed,
    },
  },
});
