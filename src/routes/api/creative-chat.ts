import { createFileRoute } from '@tanstack/react-router';
import { handleAiChatRequest } from '@/server/aiChat';
import { withConversationWorkspaceLifecycle } from '@/server/conversationWorkspaceLifecycle';
import { withConfiguredChatModel } from '@/server/configuredChatModelGuard';

const handleRequest = (request: Request) =>
  withConfiguredChatModel(request, 'creative', (guardedRequest) =>
    withConversationWorkspaceLifecycle(guardedRequest, handleAiChatRequest),
  );

export const Route = createFileRoute('/api/creative-chat')({
  server: {
    handlers: {
      GET: ({ request }) => handleRequest(request),
      POST: ({ request }) => handleRequest(request),
      OPTIONS: ({ request }) => handleRequest(request),
    },
  },
});
