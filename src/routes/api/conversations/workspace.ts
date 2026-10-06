import { createFileRoute } from '@tanstack/react-router';
import {
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import { syncConversationWorkspaceForChatRequest } from '@/server/conversationWorkspaceLifecycle';

function errorResponse(error: unknown) {
  if (isUnauthorizedError(error)) return json({ error: 'Unauthorized' }, 401);
  console.error('[conversation-workspace-sync]', error);
  return json({ error: 'internal_error' }, 500);
}

export const Route = createFileRoute('/api/conversations/workspace')({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const synced = await syncConversationWorkspaceForChatRequest(request);
          if (!synced) {
            return json({ error: 'conversation_not_found_or_not_owned' }, 404);
          }
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
