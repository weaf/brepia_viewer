import { createFileRoute } from '@tanstack/react-router';
import {
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import {
  getProviderModels,
  createProviderModel,
} from '@/server/customProviders';

export const Route = createFileRoute(
  '/api/ai-settings/providers/$providerId/models',
)({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request, params }) => {
        try {
          // Require auth to access provider models
          const user = await requireUser(request);
          // B6: Ownership guard — pass userId to prevent cross-user model enumeration
          const models = await getProviderModels(params.providerId, user.id);
          return json(models);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_load_provider_models',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      POST: async ({ request, params }) => {
        try {
          const user = await requireUser(request);
          const body = await request.json().catch(() => ({}));

          const modelId = body.modelId as string;
          const displayName = body.displayName as string;

          if (!modelId || !displayName) {
            return json(
              { error: 'Missing required fields: modelId, displayName' },
              400,
            );
          }

          const model = await createProviderModel(params.providerId, user.id, {
            modelId,
            displayName,
            description: body.description ?? null,
            supportsTools: body.supportsTools ?? false,
            supportsThinking: body.supportsThinking ?? false,
            supportsVision: body.supportsVision ?? false,
            contextLimit: body.contextLimit ?? null,
            outputLimit: body.outputLimit ?? null,
            isVisible: body.isVisible !== false,
          });

          return json(model, 201);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_create_provider_model',
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
