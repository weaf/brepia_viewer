import { z } from 'zod';
import { apiJson } from '@/services/api';

const SuccessSchema = z.object({ success: z.literal(true) });

export function syncConversationWorkspace(conversationId: string) {
  return apiJson(
    'conversations/workspace',
    {
      method: 'POST',
      body: JSON.stringify({ conversationId }),
    },
    SuccessSchema,
  );
}
