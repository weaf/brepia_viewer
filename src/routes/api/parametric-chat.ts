import { createFileRoute } from '@tanstack/react-router';
import { handleAiChatRequest } from '@/server/aiChat';
import {
  handleConversationWorkspaceExportRequest,
  isConversationWorkspaceExportRequest,
} from '@/server/conversationWorkspaceExportRequest';
import { withConversationWorkspaceLifecycle } from '@/server/conversationWorkspaceLifecycle';
import { withConfiguredChatModel } from '@/server/configuredChatModelGuard';

const handleRequest = (request: Request) => {
  if (isConversationWorkspaceExportRequest(request)) {
    return handleConversationWorkspaceExportRequest(request);
  }
  return withConfiguredChatModel(request, 'parametric', (guardedRequest) =>
    withConversationWorkspaceLifecycle(guardedRequest, handleAiChatRequest),
  );
};

export const Route = createFileRoute('/api/parametric-chat')({
  server: {
    handlers: {
      GET: ({ request }) => handleRequest(request),
      POST: ({ request }) => handleRequest(request),
      OPTIONS: ({ request }) => handleRequest(request),
    },
  },
});
