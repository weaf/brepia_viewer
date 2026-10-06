import { createFileRoute } from '@tanstack/react-router';
import {
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import { getUserProviders, createProvider } from '@/server/customProviders';

const VALID_DRIVERS = new Set([
  'openai-compatible',
  'anthropic',
  'google',
  'openrouter',
]);

export const Route = createFileRoute('/api/ai-settings/providers')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request }) => {
        try {
          const user = await requireUser(request);
          const providers = await getUserProviders(user);
          return json(providers);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_load_providers',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      POST: async ({ request }) => {
        try {
          const user = await requireUser(request);
          const body = await request.json().catch(() => ({}));

          const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          const driver =
            typeof body.driver === 'string' ? body.driver.trim() : '';

          if (!slug || !name || !driver) {
            return json(
              { error: 'Missing required fields: slug, name, driver' },
              400,
            );
          }
          if (slug.startsWith('builtin-')) {
            return json(
              {
                error:
                  'The builtin-* namespace is reserved for managed provider overrides',
              },
              400,
            );
          }
          if (!VALID_DRIVERS.has(driver)) {
            return json({ error: 'Unsupported provider driver' }, 400);
          }

          const provider = await createProvider(user, {
            slug,
            name,
            driver: driver as
              'openai-compatible' | 'anthropic' | 'google' | 'openrouter',
            baseUrl: body.baseUrl,
            credential: body.credential,
          });

          return json(provider, 201);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : err instanceof Error
                  ? err.message
                  : 'failed_to_create_provider',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
      HEAD: methodNotAllowed,
    },
  },
});
