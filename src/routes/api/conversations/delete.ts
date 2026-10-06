import { createFileRoute } from '@tanstack/react-router';
import {
  isRecord,
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import { deleteOwnedConversations } from '@/server/conversationTeardown';
import { getServiceRoleSupabaseClient } from '@/server/supabaseClient';

function errorResponse(error: unknown) {
  if (isUnauthorizedError(error)) return json({ error: 'Unauthorized' }, 401);
  if (error instanceof Error && error.message === 'conversation_not_found_or_not_owned') {
    return json({ error: error.message }, 404);
  }
  console.error('[conversation-delete]', error);
  return json({ error: 'internal_error' }, 500);
}

export const Route = createFileRoute('/api/conversations/delete')({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          const user = await requireUser(request);
          const body = await request.json().catch(() => null);
          if (!isRecord(body) || !Array.isArray(body.conversationIds)) {
            return json({ error: 'invalid_body' }, 400);
          }

          const conversationIds = body.conversationIds.filter(
            (value): value is string => typeof value === 'string' && value.length > 0,
          );
          if (conversationIds.length !== body.conversationIds.length) {
            return json({ error: 'invalid_conversation_ids' }, 400);
          }

          const supabase = getServiceRoleSupabaseClient();
          await deleteOwnedConversations(supabase, user.id, conversationIds);
          return json({ success: true });
        } catch (error) {
          return errorResponse(error);
        }
      },
      GET: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
      HEAD: methodNotAllowed,
    },
  },
});
