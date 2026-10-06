import { createFileRoute } from '@tanstack/react-router';
import {
  isRecord,
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import { testProvider } from '@/server/customProviders';
import type { CreateProviderInput } from '@shared/aiSettings';

/**
 * UI-facing provider connection test route.
 *
 * Existing-provider test:
 *   { "id": "<provider uuid>" }
 *
 * Unsaved/draft-provider test:
 *   { "draftConfig": { slug, name, driver, baseUrl, credential } }
 *
 * This is the canonical test endpoint for the Providers Settings UI.
 */
export const Route = createFileRoute('/api/ai-settings/providers/test')({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          const user = await requireUser(request);
          const body = await request.json().catch(() => null);
          if (!isRecord(body)) {
            return json({ error: 'invalid_request' }, 400);
          }

          const id = typeof body.id === 'string' ? body.id : undefined;
          const rawDraft = isRecord(body.draftConfig)
            ? body.draftConfig
            : undefined;

          if (!id && !rawDraft) {
            return json({ error: 'provider_id_or_draft_required' }, 400);
          }

          let draftConfig: CreateProviderInput | undefined;
          if (rawDraft) {
            const slug = rawDraft.slug;
            const name = rawDraft.name;
            const driver = rawDraft.driver;
            if (
              typeof slug !== 'string' ||
              typeof name !== 'string' ||
              (driver !== 'openai-compatible' &&
                driver !== 'anthropic' &&
                driver !== 'google' &&
                driver !== 'openrouter')
            ) {
              return json({ error: 'invalid_draft_provider' }, 400);
            }

            draftConfig = {
              slug,
              name,
              driver,
              baseUrl:
                typeof rawDraft.baseUrl === 'string'
                  ? rawDraft.baseUrl
                  : undefined,
              credential:
                typeof rawDraft.credential === 'string'
                  ? rawDraft.credential
                  : undefined,
            };
          }

          const result = await testProvider(user.id, id, draftConfig);
          return json(result);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_test_provider',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
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
