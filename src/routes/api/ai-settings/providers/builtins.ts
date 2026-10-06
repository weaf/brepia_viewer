import { createFileRoute } from '@tanstack/react-router';
import {
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import {
  BUILTIN_PROVIDER_DRIVERS,
  listBuiltinProviderSettings,
  resetBuiltinProviderSettings,
  saveBuiltinProviderSettings,
  type BuiltinProviderDriver,
} from '@/server/builtinProviderOverrides';

function isDriver(value: unknown): value is BuiltinProviderDriver {
  return (
    typeof value === 'string' &&
    BUILTIN_PROVIDER_DRIVERS.includes(value as BuiltinProviderDriver)
  );
}

export const Route = createFileRoute('/api/ai-settings/providers/builtins')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request }) => {
        try {
          const user = await requireUser(request);
          return json(await listBuiltinProviderSettings(user));
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : err instanceof Error
                  ? err.message
                  : 'failed_to_load_builtin_providers',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      PUT: async ({ request }) => {
        try {
          const user = await requireUser(request);
          const body = await request.json().catch(() => ({}));
          if (!isDriver(body.driver)) {
            return json({ error: 'Invalid built-in provider driver' }, 400);
          }

          if (body.reset === true) {
            return json(await resetBuiltinProviderSettings(user, body.driver));
          }

          if (
            body.baseUrl !== undefined &&
            (typeof body.baseUrl !== 'string' || !body.baseUrl.trim())
          ) {
            return json({ error: 'baseUrl must be a non-empty URL' }, 400);
          }
          if (typeof body.baseUrl === 'string') {
            try {
              const parsed = new URL(body.baseUrl);
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return json({ error: 'baseUrl must use http or https' }, 400);
              }
            } catch {
              return json({ error: 'baseUrl must be a valid URL' }, 400);
            }
          }
          if (
            body.credential !== undefined &&
            body.credential !== null &&
            typeof body.credential !== 'string'
          ) {
            return json({ error: 'credential must be a string or null' }, 400);
          }
          if (
            typeof body.credential === 'string' &&
            body.credential.length > 4096
          ) {
            return json({ error: 'credential is too long' }, 400);
          }
          if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
            return json({ error: 'enabled must be boolean' }, 400);
          }

          return json(
            await saveBuiltinProviderSettings(user, {
              driver: body.driver,
              ...(typeof body.baseUrl === 'string'
                ? { baseUrl: body.baseUrl.trim() }
                : {}),
              ...(body.credential !== undefined
                ? { credential: body.credential }
                : {}),
              ...(typeof body.enabled === 'boolean'
                ? { enabled: body.enabled }
                : {}),
            }),
          );
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : err instanceof Error
                  ? err.message
                  : 'failed_to_update_builtin_provider',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      POST: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
      HEAD: methodNotAllowed,
    },
  },
});
