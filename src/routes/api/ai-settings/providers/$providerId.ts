import { createFileRoute } from '@tanstack/react-router';
import {
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import {
  getProvider,
  updateProvider,
  deleteProvider,
} from '@/server/customProviders';

export const Route = createFileRoute('/api/ai-settings/providers/$providerId')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request, params }) => {
        try {
          const user = await requireUser(request);
          const provider = await getProvider(user.id, params.providerId);

          if (!provider) {
            return json({ error: 'Provider not found' }, 404);
          }

          return json(provider);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_load_provider',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          const user = await requireUser(request);
          const body = await request.json().catch(() => ({}));

          const provider = await updateProvider(user.id, params.providerId, {
            name: body.name,
            driver: body.driver,
            baseUrl: body.baseUrl,
            credential: body.credential,
            enabled: body.enabled,
          });

          return json(provider);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          if (message.includes('not found')) {
            return json({ error: 'Provider not found' }, 404);
          }
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_update_provider',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const user = await requireUser(request);
          await deleteProvider(user.id, params.providerId);
          return json({ success: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          if (message.includes('not found')) {
            return json({ error: 'Provider not found' }, 404);
          }
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_delete_provider',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      PUT: methodNotAllowed,
      POST: methodNotAllowed,
      HEAD: methodNotAllowed,
    },
  },
});
