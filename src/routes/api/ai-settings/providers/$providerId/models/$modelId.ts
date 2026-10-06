import { createFileRoute } from '@tanstack/react-router';
import {
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import {
  getModelById,
  updateProviderModel,
  deleteProviderModel,
} from '@/server/customProviders';

export const Route = createFileRoute(
  '/api/ai-settings/providers/$providerId/models/$modelId',
)({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request, params }) => {
        try {
          const user = await requireUser(request);
          const model = await getModelById(params.modelId, user.id);
          if (!model) {
            return json({ error: 'Provider model not found' }, 404);
          }
          return json(model);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_load_provider_model',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      POST: methodNotAllowed,
      PATCH: async ({ request, params }) => {
        try {
          const user = await requireUser(request);
          const body = await request.json().catch(() => ({}));

          const updateFields: Record<string, unknown> = {};
          if (body.displayName !== undefined)
            updateFields.displayName = body.displayName;
          if (body.description !== undefined)
            updateFields.description = body.description;
          if (body.supportsTools !== undefined)
            updateFields.supportsTools = body.supportsTools;
          if (body.supportsThinking !== undefined)
            updateFields.supportsThinking = body.supportsThinking;
          if (body.supportsVision !== undefined)
            updateFields.supportsVision = body.supportsVision;
          if (body.contextLimit !== undefined)
            updateFields.contextLimit = body.contextLimit;
          if (body.outputLimit !== undefined)
            updateFields.outputLimit = body.outputLimit;
          if (body.isVisible !== undefined)
            updateFields.isVisible = body.isVisible;

          if (Object.keys(updateFields).length === 0) {
            return json({ error: 'No fields to update' }, 400);
          }

          const model = await updateProviderModel(params.modelId, user.id, {
            displayName: updateFields.displayName as string | undefined,
            description: updateFields.description as string | null | undefined,
            supportsTools: updateFields.supportsTools as boolean | undefined,
            supportsThinking: updateFields.supportsThinking as
              boolean | undefined,
            supportsVision: updateFields.supportsVision as boolean | undefined,
            contextLimit: updateFields.contextLimit as
              number | null | undefined,
            outputLimit: updateFields.outputLimit as number | null | undefined,
            isVisible: updateFields.isVisible as boolean | undefined,
          });

          return json(model);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_update_provider_model',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      PUT: methodNotAllowed,
      DELETE: async ({ request, params }) => {
        try {
          const user = await requireUser(request);
          await deleteProviderModel(params.modelId, user.id);
          return json({ success: true }, 200);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_delete_provider_model',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      HEAD: methodNotAllowed,
    },
  },
});
