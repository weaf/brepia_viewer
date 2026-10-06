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
import { readBoundedBrepJson } from '@/routes/api/brep/evaluate';
import {
  BrepGrasshopperContractError,
  createBrepGrasshopperContract,
} from '@shared/brepGrasshopperContract';
import {
  BrepGrasshopperPackagePlanError,
  createBrepGrasshopperPackagePlan,
} from '@shared/brepGrasshopperPackagePlan';

export const BREP_GRASSHOPPER_PACKAGE_PLAN_MEDIA_TYPE =
  'application/vnd.brepia.grasshopper-package-plan+json' as const;

export async function createBrepGrasshopperPackagePlanFromRequest(
  value: unknown,
) {
  if (!isRecord(value)) {
    throw new BrepGrasshopperPackagePlanError(
      'invalid_plan',
      'Grasshopper package request must be an object.',
    );
  }

  const contract = createBrepGrasshopperContract({
    project: value.project,
    sourceRevisionId:
      typeof value.sourceRevisionId === 'string' ? value.sourceRevisionId : '',
  });
  return createBrepGrasshopperPackagePlan(contract);
}

export function brepGrasshopperPackagePlanErrorResponse(error: unknown) {
  if (
    error instanceof BrepGrasshopperContractError ||
    error instanceof BrepGrasshopperPackagePlanError
  ) {
    return json(
      {
        code: 'invalid_grasshopper_package_request',
        error: error.message,
      },
      error.code === 'too_large' ? 413 : 400,
    );
  }
  if (error instanceof RangeError) {
    return json({ code: 'request_too_large', error: error.message }, 413);
  }
  if (error instanceof SyntaxError) {
    return json(
      { code: 'invalid_grasshopper_package_request', error: error.message },
      400,
    );
  }
  if (isUnauthorizedError(error)) return json({ error: 'Unauthorized' }, 401);
  console.error('[BRep Grasshopper package plan] Unexpected failure:', error);
  return json(
    {
      code: 'grasshopper_package_plan_failed',
      error: 'Grasshopper package plan generation failed.',
    },
    500,
  );
}

export const Route = createFileRoute('/api/brep/export/grasshopper-plan')({
  server: {
    handlers: {
      GET: methodNotAllowed,
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const body = await readBoundedBrepJson(request);
          const plan = await createBrepGrasshopperPackagePlanFromRequest(body);
          return new Response(`${JSON.stringify(plan, null, 2)}\n`, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Cache-Control': 'private, no-store',
              'Content-Type': `${BREP_GRASSHOPPER_PACKAGE_PLAN_MEDIA_TYPE}; charset=utf-8`,
              'X-Content-Type-Options': 'nosniff',
              'X-Brepia-Grasshopper-Plan-Version': String(plan.schemaVersion),
            },
          });
        } catch (error) {
          return brepGrasshopperPackagePlanErrorResponse(error);
        }
      },
    },
  },
});
