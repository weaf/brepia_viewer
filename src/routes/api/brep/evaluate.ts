import { createFileRoute } from '@tanstack/react-router';
import {
  isRecord,
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import {
  BrepEvaluationError,
  evaluateBrepProject,
} from '@/server/brepEvaluation';
import {
  BrepGenerationPreviewError,
  BrepGenerationPreviewLifecycle,
  isRetryableBrepPreviewErrorCode,
  normalizeBrepGenerationPreviewContext,
} from '@/server/brepGenerationPreviewLifecycle';
import {
  BrepEvaluationRequestError,
  normalizeBrepEvaluationRequest,
} from '@shared/brepProvider';

export const BREP_EVALUATION_REQUEST_LIMIT_BYTES = 512 * 1024;

export async function readBoundedBrepJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (
    Number.isFinite(declared) &&
    declared > BREP_EVALUATION_REQUEST_LIMIT_BYTES
  )
    throw new RangeError('BRep evaluation request body is too large.');
  if (!request.body)
    throw new SyntaxError('BRep evaluation request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > BREP_EVALUATION_REQUEST_LIMIT_BYTES) {
        await reader.cancel();
        throw new RangeError('BRep evaluation request body is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  ) as unknown;
}

export function brepEvaluationErrorResponse(error: unknown) {
  if (error instanceof RangeError)
    return json({ code: 'request_too_large', error: error.message }, 413);
  if (error instanceof BrepGenerationPreviewError)
    return json({ code: error.code, error: error.message }, error.httpStatus);
  if (
    error instanceof SyntaxError ||
    error instanceof BrepEvaluationRequestError
  )
    return json(
      {
        code: 'invalid_brep_request',
        error: error instanceof Error ? error.message : 'Invalid BRep request.',
      },
      400,
    );
  if (error instanceof BrepEvaluationError) {
    if (error.code === 'capacity_exceeded')
      return json({ code: error.code, error: error.message }, 429);
    if (
      error.code === 'evaluation_timeout' ||
      error.code === 'evaluation_cancelled'
    )
      return json({ code: error.code, error: error.message }, 408);
    return json(
      { code: error.code, error: error.message },
      error.code === 'provider_unavailable' ? 503 : 400,
    );
  }
  if (isUnauthorizedError(error)) return json({ error: 'Unauthorized' }, 401);
  console.error('[BRep evaluation] Unexpected failure:', error);
  return json(
    { code: 'brep_evaluation_failed', error: 'BRep evaluation failed.' },
    500,
  );
}

async function settleLinkedPreviewFailure(
  lifecycle: BrepGenerationPreviewLifecycle | undefined,
  error: unknown,
): Promise<void> {
  if (!lifecycle) return;

  try {
    if (
      error instanceof BrepEvaluationError &&
      isRetryableBrepPreviewErrorCode(error.code)
    ) {
      await lifecycle.retryable(error.code);
      return;
    }

    await lifecycle.failed(
      error instanceof BrepEvaluationError
        ? `brep_${error.code}`
        : 'brep_preview_status_failed',
    );
  } catch (statusError) {
    console.error('[BRep evaluation] Generation status update failed:', statusError);
  }
}

export const Route = createFileRoute('/api/brep/evaluate')({
  server: {
    handlers: {
      GET: methodNotAllowed,
      OPTIONS: preflight,
      POST: async ({ request }) => {
        let previewLifecycle: BrepGenerationPreviewLifecycle | undefined;
        try {
          const user = await requireUser(request);
          const body = await readBoundedBrepJson(request);
          if (!isRecord(body))
            return json(
              {
                code: 'invalid_brep_request',
                error: 'BRep request must be an object.',
              },
              400,
            );
          const previewContext = normalizeBrepGenerationPreviewContext(
            body.generationContext,
          );
          const normalized = normalizeBrepEvaluationRequest(body);
          previewLifecycle = await BrepGenerationPreviewLifecycle.begin({
            userId: user.id,
            context: previewContext,
            project: normalized.project,
          });

          const artifact = await evaluateBrepProject(
            normalized.project,
            normalized.parameterValues,
            request.signal,
          );
          await previewLifecycle?.preparingViewer();
          await previewLifecycle?.completed();
          return json(artifact.result);
        } catch (error) {
          await settleLinkedPreviewFailure(previewLifecycle, error);
          return brepEvaluationErrorResponse(error);
        }
      },
    },
  },
});
