import { corsHeaders } from './api';
import { scheduleActiveGenerationCancellation } from './activeGeneration';
import { syncConversationGeneratedMeshes } from './conversationWorkspaceGeneratedMeshes';
import {
  resolveCreativeMeshProvider,
  type CreativeMeshProviderAdapter,
} from './creativeMeshProviderRegistry';
import { createInFlightRequestDeduper } from './inFlightRequestDeduper';
import { logError } from './serverLog';

type ResponseSnapshot = {
  body: string;
  headers: Record<string, string>;
  status: number;
  statusText: string;
};

const localMeshRequests = createInFlightRequestDeduper<ResponseSnapshot>();

function recordBody(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function requestModel(body: unknown): string | null {
  const record = recordBody(body);
  const model = record?.model;
  return typeof model === 'string' ? model : null;
}

function requestConversationId(body: unknown): string | null {
  const record = recordBody(body);
  const conversationId = record?.conversationId;
  return typeof conversationId === 'string' && conversationId
    ? conversationId
    : null;
}

function requestMeshId(body: unknown): string | null {
  const record = recordBody(body);
  const meshId = record?.mesh;
  return typeof meshId === 'string' && meshId ? meshId : null;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function localMeshRequestKey(
  request: Request,
  conversationId: string,
  model: string,
): string | null {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;

  // Local Creative generation is intentionally single-flight per
  // conversation/backend. Android/Chrome can lose only the client stream while
  // the native job keeps running; reconnects must join that same job instead of
  // starting a second expensive native Creative generation.
  return `${authorization}\n${conversationId}\n${model}`;
}

async function snapshotResponse(response: Response): Promise<ResponseSnapshot> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    body: await response.text(),
    headers,
    status: response.status,
    statusText: response.statusText,
  };
}

function responseFromSnapshot(snapshot: ResponseSnapshot): Response {
  return new Response(snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

async function executeProviderRequest(
  request: Request,
  body: unknown,
  conversationId: string | null,
  provider: CreativeMeshProviderAdapter,
): Promise<ResponseSnapshot> {
  const response = await provider.handleRequest(request, body);

  if (
    response.ok &&
    conversationId &&
    provider.syncGeneratedMeshesAfterSuccess
  ) {
    try {
      await syncConversationGeneratedMeshes(request, conversationId);
    } catch (error) {
      logError(error, {
        functionName: 'conversation-workspace-generated-meshes',
        statusCode: 500,
        conversationId,
        additionalContext: {
          operation: 'post_creative_mesh_generation_sync',
          provider: provider.id,
        },
      });
    }
  } else if (!response.ok && conversationId && provider.singleFlight) {
    // Native/local runtime failures are terminal for this Creative turn. Stop
    // the multi-step agent before it immediately retries the expensive backend.
    scheduleActiveGenerationCancellation(conversationId);
  }

  return snapshotResponse(response);
}

/**
 * Stable entry point for Creative mesh generation.
 *
 * The built-in local backend is a model-neutral product mode. Hosted services
 * are optional provider adapters selected by configuration. Retired model-specific
 * local backend IDs are normalized forward to the neutral native mode so old
 * conversations stay usable without selecting a concrete runtime model in code.
 */
export async function handleMeshRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  const body = await request
    .clone()
    .json()
    .catch(() => null);
  const requestedModel = requestModel(body);
  if (!requestedModel) {
    return jsonError('Creative mesh model is required.', 400);
  }

  const resolved = resolveCreativeMeshProvider(requestedModel);
  if (!resolved) {
    return jsonError(`Unsupported Creative mesh model: ${requestedModel}`, 400);
  }
  if (!resolved.enabled) {
    return jsonError(
      `${resolved.provider.label} is not enabled for Creative mesh generation.`,
      503,
    );
  }

  if (requestMeshId(body) && !resolved.definition.supportsMeshEdit) {
    return jsonError(
      'Follow-up editing is not supported by this Creative mesh backend. Create a new generation instead.',
      422,
    );
  }

  // Legacy local IDs are read-compatibility aliases only. Rewrite the parsed
  // request before handing it to the native adapter so the removed backend can
  // never be started again.
  const normalizedBody = {
    ...(recordBody(body) ?? {}),
    model: resolved.modelId,
  };
  const conversationId = requestConversationId(normalizedBody);

  if (!resolved.provider.singleFlight || !conversationId) {
    return responseFromSnapshot(
      await executeProviderRequest(
        request,
        normalizedBody,
        conversationId,
        resolved.provider,
      ),
    );
  }

  const key = localMeshRequestKey(request, conversationId, resolved.modelId);
  if (!key) {
    return responseFromSnapshot(
      await executeProviderRequest(
        request,
        normalizedBody,
        conversationId,
        resolved.provider,
      ),
    );
  }

  const { promise, reused } = localMeshRequests.getOrRun(key, () =>
    executeProviderRequest(
      request,
      normalizedBody,
      conversationId,
      resolved.provider,
    ),
  );
  if (reused) {
    console.info(
      '[creative-mesh] reusing in-flight generation after reconnect',
      {
        conversationId,
        model: resolved.modelId,
        provider: resolved.provider.id,
      },
    );
  }
  return responseFromSnapshot(await promise);
}
