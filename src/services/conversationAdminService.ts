import { z } from 'zod';
import { apiJson } from '@/services/api';

const SuccessSchema = z.object({ success: z.boolean() });

export function deleteConversations(conversationIds: string[]) {
  return apiJson(
    'conversations/delete',
    {
      method: 'POST',
      body: JSON.stringify({ conversationIds }),
    },
    SuccessSchema,
  );
}
