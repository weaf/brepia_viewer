import { buildSelectableCatalog } from './modelCatalog';
import { isRecord, isUnauthorizedError, json, requireUser } from './api';

type ChatModelGuardMode = 'parametric' | 'creative';

type RequestHandler = (request: Request) => Promise<Response> | Response;

function isCancelRequest(body: unknown): boolean {
  return isRecord(body) && body.action === 'cancel';
}

function requestedModelId(
  body: unknown,
  mode: ChatModelGuardMode,
): string | null {
  if (!isRecord(body)) return null;
  const value = mode === 'creative' ? body.agentModel : body.model;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Enforce the Settings model catalog as the server-side authority for chat
 * model selection. A client cannot route an arbitrary/stale model id directly
 * to a provider just by posting it to a chat endpoint.
 */
export async function withConfiguredChatModel(
  request: Request,
  mode: ChatModelGuardMode,
  handler: RequestHandler,
): Promise<Response> {
  if (request.method !== 'POST') return handler(request);

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return handler(request);
  }

  // Cancellation owns no model selection and must reach the existing durable
  // generation cancellation lifecycle unchanged.
  if (isCancelRequest(body)) return handler(request);

  const modelId = requestedModelId(body, mode);

  // Creative can omit agentModel because its server resolver owns the
  // conversation-pinned/catalog fallback. That resolver independently checks
  // the same selectable Settings catalog.
  if (!modelId && mode === 'creative') return handler(request);

  if (!modelId) {
    return json(
      {
        error: 'model_not_configured',
        message: 'Select an available AI model in Settings before generating.',
      },
      400,
    );
  }

  try {
    const user = await requireUser(request);
    const catalog = await buildSelectableCatalog(user);
    if (!catalog.some((entry) => entry.id === modelId)) {
      return json(
        {
          error: 'model_not_configured',
          message: `AI model is not enabled in Settings: ${modelId}`,
        },
        400,
      );
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return json({ error: 'unauthorized' }, 401);
    }
    return json(
      {
        error: 'model_catalog_unavailable',
        message: 'AI model settings could not be verified.',
      },
      503,
    );
  }

  return handler(request);
}
