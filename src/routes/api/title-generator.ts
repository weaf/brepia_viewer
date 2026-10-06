import { createFileRoute } from '@tanstack/react-router';
import { conversationTitleFromText } from '@shared/conversationTitle';
import {
  isRecord,
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';

  return parts
    .flatMap((part) =>
      isRecord(part) && part.type === 'text' && typeof part.text === 'string'
        ? [part.text]
        : [],
    )
    .join('\n')
    .trim();
}

function nonNegativeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export const Route = createFileRoute('/api/title-generator')({
  server: {
    handlers: {
      GET: methodNotAllowed,
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          await requireUser(request);
        } catch (err) {
          if (isUnauthorizedError(err)) {
            return json({ error: 'Unauthorized' }, 401);
          }
          throw err;
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          body = null;
        }

        if (!isRecord(body)) {
          return json({ title: conversationTitleFromText('') });
        }

        const trimmedText =
          typeof body.text === 'string' ? body.text.trim() : '';
        const text = trimmedText || textFromParts(body.parts);
        const context = {
          imageCount: nonNegativeCount(body.imageCount),
          meshCount: nonNegativeCount(body.meshCount),
        };

        // Conversation naming is deterministic unless an explicit auxiliary
        // model is introduced in AI Settings. Never invoke a hidden provider or
        // hardcoded LLM merely to improve a title.
        return json({ title: conversationTitleFromText(text, context) });
      },
    },
  },
});
