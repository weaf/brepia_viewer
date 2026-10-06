import { createFileRoute } from '@tanstack/react-router';
import {
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import { discoverRuntimeIntegrations } from '@/server/runtimeIntegrations';
import {
  discoverLocalModels,
  updateLocalModelMetadata,
} from '@/server/localModels';
import { discoverCreativeRuntimeModels } from '@/server/creativeRuntimeModels';

export const Route = createFileRoute('/api/settings/runtimeIntegrations')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request }) => {
        try {
          const user = await requireUser(request);
          const integrations = await discoverRuntimeIntegrations(user.id);
          const searchParams = new URL(request.url).searchParams;
          const includeModels = searchParams.get('includeModels') === '1';
          const includeCreativeModels =
            searchParams.get('includeCreativeModels') === '1';
          if (!includeModels && !includeCreativeModels) {
            return json(integrations);
          }

          const [localModels, creativeRuntimeModels] = await Promise.all([
            includeModels
              ? discoverLocalModels(user.id).catch(() => [])
              : Promise.resolve([]),
            includeCreativeModels
              ? discoverCreativeRuntimeModels()
              : Promise.resolve([]),
          ]);

          return json({
            integrations,
            ...(includeModels ? { localModels } : {}),
            ...(includeCreativeModels ? { creativeRuntimeModels } : {}),
          });
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_discover_runtimes',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      PUT: async ({ request }) => {
        try {
          const user = await requireUser(request);
          const body = await request.json().catch(() => ({}));
          if (typeof body.modelId !== 'string' || !body.modelId.trim()) {
            return json({ error: 'modelId is required' }, 400);
          }
          for (const key of [
            'supportsTools',
            'supportsThinking',
            'supportsVision',
            'isVisible',
          ] as const) {
            if (typeof body[key] !== 'boolean') {
              return json({ error: `${key} must be boolean` }, 400);
            }
          }
          for (const key of ['contextLimit', 'outputLimit'] as const) {
            if (
              body[key] !== undefined &&
              body[key] !== null &&
              (!Number.isInteger(body[key]) || body[key] <= 0)
            ) {
              return json(
                { error: `${key} must be a positive integer or null` },
                400,
              );
            }
          }
          if (
            body.displayName !== undefined &&
            (typeof body.displayName !== 'string' ||
              body.displayName.length > 200)
          ) {
            return json(
              { error: 'displayName must be a string up to 200 characters' },
              400,
            );
          }

          return json(
            await updateLocalModelMetadata(user.id, {
              modelId: body.modelId,
              ...(typeof body.displayName === 'string'
                ? { displayName: body.displayName }
                : {}),
              supportsTools: body.supportsTools,
              supportsThinking: body.supportsThinking,
              supportsVision: body.supportsVision,
              contextLimit: body.contextLimit ?? null,
              outputLimit: body.outputLimit ?? null,
              isVisible: body.isVisible,
            }),
          );
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : err instanceof Error
                  ? err.message
                  : 'failed_to_update_local_model_metadata',
            },
            isUnauthorizedError(err) ? 401 : 400,
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
