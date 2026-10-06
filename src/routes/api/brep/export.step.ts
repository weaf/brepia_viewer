import { createFileRoute } from '@tanstack/react-router';
import {
  corsHeaders,
  isRecord,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import {
  brepEvaluationErrorResponse,
  readBoundedBrepJson,
} from '@/routes/api/brep/evaluate';
import {
  exportBrepProjectTo3dm,
  exportBrepProjectToStep,
} from '@/server/brepEvaluation';
import { normalizeBrepEvaluationRequest } from '@shared/brepProvider';

const THREEDM_MEDIA_TYPE = 'model/vnd.3dm';

function wantsThreeDm(request: Request): boolean {
  return (request.headers.get('accept') ?? '')
    .toLowerCase()
    .split(',')
    .some((value) => value.trim().split(';', 1)[0] === THREEDM_MEDIA_TYPE);
}

export const Route = createFileRoute('/api/brep/export/step')({
  server: {
    handlers: {
      GET: methodNotAllowed,
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const body = await readBoundedBrepJson(request);
          if (!isRecord(body))
            return Response.json(
              {
                code: 'invalid_brep_request',
                error: 'BRep request must be an object.',
              },
              { status: 400, headers: corsHeaders },
            );
          const normalized = normalizeBrepEvaluationRequest(body);
          const threeDm = wantsThreeDm(request);
          const bytes = threeDm
            ? await exportBrepProjectTo3dm(
                normalized.project,
                normalized.parameterValues,
                request.signal,
              )
            : await exportBrepProjectToStep(
                normalized.project,
                normalized.parameterValues,
                request.signal,
              );
          const responseBytes = new Uint8Array(bytes.byteLength);
          responseBytes.set(bytes);
          return new Response(responseBytes.buffer, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Cache-Control': 'private, no-store',
              'Content-Type': threeDm ? THREEDM_MEDIA_TYPE : 'model/step',
              'Content-Disposition': threeDm
                ? 'attachment; filename="brepia-model.3dm"'
                : 'attachment; filename="brepia-model.step"',
              'X-Content-Type-Options': 'nosniff',
              ...(threeDm
                ? { 'X-BREPIA-3DM-Provider': 'rhino3dm' }
                : { 'X-BREPIA-Step-Provider': 'build123d-occt' }),
            },
          });
        } catch (error) {
          return brepEvaluationErrorResponse(error);
        }
      },
    },
  },
});
