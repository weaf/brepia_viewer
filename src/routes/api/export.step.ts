import { createFileRoute } from '@tanstack/react-router';
import {
  corsHeaders,
  isRecord,
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import {
  OPENSCAD_PROJECT_MAX_TOTAL_BYTES,
  type OpenScadProject,
} from '@shared/openScadProject';
import {
  StepExportError,
  exportOpenScadProjectToStep,
} from '@/server/stepExport';
import { createServerOpenScadProjectAssetResolver } from '@/server/openScadProjectAssetStorage';

// Project source text can expand one UTF-8 byte to six ASCII bytes when JSON
// escapes control characters. Add a bounded envelope for source paths, asset
// descriptors and request metadata. Asset bytes themselves are never inline.
const STEP_EXPORT_REQUEST_LIMIT_BYTES =
  OPENSCAD_PROJECT_MAX_TOTAL_BYTES * 6 + 1024 * 1024;

class StepExportRequestError extends Error {
  constructor(
    public readonly code: 'request_too_large' | 'invalid_json',
    public readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
    this.name = 'StepExportRequestError';
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (
      Number.isFinite(declaredBytes) &&
      declaredBytes > STEP_EXPORT_REQUEST_LIMIT_BYTES
    ) {
      throw new StepExportRequestError(
        'request_too_large',
        413,
        'STEP export request body is too large.',
      );
    }
  }

  if (!request.body) {
    throw new StepExportRequestError(
      'invalid_json',
      400,
      'STEP export request body must be JSON.',
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > STEP_EXPORT_REQUEST_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new StepExportRequestError(
          'request_too_large',
          413,
          'STEP export request body is too large.',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new StepExportRequestError(
      'invalid_json',
      400,
      'STEP export request body must be valid UTF-8 JSON.',
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StepExportRequestError(
      'invalid_json',
      400,
      'STEP export request body must be valid JSON.',
    );
  }
}

function projectFromRequestBody(
  body: Record<string, unknown>,
): OpenScadProject | null {
  if (isRecord(body.project)) {
    return body.project as unknown as OpenScadProject;
  }

  // Compatibility for an already-open pre-Step-8 browser bundle. The server
  // still converts this through the project-directory sandbox path.
  if (typeof body.sourceCode === 'string' && body.sourceCode.trim()) {
    return {
      schemaVersion: 1,
      entrypointPath: 'model.scad',
      files: [{ path: 'model.scad', content: body.sourceCode }],
    };
  }

  return null;
}

function errorResponse(error: unknown) {
  if (error instanceof StepExportRequestError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  if (error instanceof StepExportError) {
    if (error.code === 'capacity_exceeded') {
      return Response.json(
        { error: error.message, code: error.code },
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Cache-Control': 'no-store',
            'Retry-After': '2',
          },
        },
      );
    }
    const status = error.code === 'provider_unavailable' ? 503 : 400;
    return json({ error: error.message, code: error.code }, status);
  }
  if (isUnauthorizedError(error)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  console.error('[STEP export] Unexpected failure:', error);
  return json({ error: 'step_export_failed' }, 500);
}

export const Route = createFileRoute('/api/export/step')({
  server: {
    handlers: {
      GET: methodNotAllowed,
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          const user = await requireUser(request);
          const body = await readBoundedJson(request);
          if (!isRecord(body)) {
            return json({ error: 'invalid_scad_project' }, 400);
          }

          const project = projectFromRequestBody(body);
          if (!project) {
            return json({ error: 'invalid_scad_project' }, 400);
          }

          let resolveAsset;
          if (body.conversationId != null) {
            if (
              typeof body.conversationId !== 'string' ||
              !body.conversationId.trim()
            ) {
              return json({ error: 'invalid_conversation_id' }, 400);
            }
            try {
              resolveAsset = createServerOpenScadProjectAssetResolver(
                body.conversationId.trim(),
                user.id,
              );
            } catch {
              return json({ error: 'invalid_conversation_id' }, 400);
            }
          }

          const result = await exportOpenScadProjectToStep(
            project,
            resolveAsset,
          );
          const responseBytes = new Uint8Array(result.bytes.byteLength);
          responseBytes.set(result.bytes);
          return new Response(responseBytes.buffer, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Cache-Control': 'private, no-store',
              'Content-Type': 'model/step',
              'Content-Disposition': 'attachment; filename="model.step"',
              'X-Content-Type-Options': 'nosniff',
              'X-BREPIA-Step-Provider': result.provider,
              'X-BREPIA-Step-Warning-Count': String(result.warnings.length),
            },
          });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
