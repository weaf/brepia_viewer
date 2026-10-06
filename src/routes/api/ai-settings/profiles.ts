import { createFileRoute } from '@tanstack/react-router';
import {
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import {
  getUserPromptProfiles,
  createPromptProfile,
} from '@/server/promptProfiles';
import {
  PromptProfileScopeSchema,
  type PromptProfileScope,
} from '@shared/aiSettings';

function parseScope(value: unknown): PromptProfileScope {
  if (value == null || value === '') return 'parametric';
  const parsed = PromptProfileScopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Unknown prompt profile scope: ${String(value)}`);
  }
  return parsed.data;
}

export const Route = createFileRoute('/api/ai-settings/profiles')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request }) => {
        try {
          const user = await requireUser(request);
          const scope = parseScope(
            new URL(request.url).searchParams.get('scope'),
          );
          const profiles = await getUserPromptProfiles(user, false, scope);
          return json(profiles);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_load_profiles',
            },
            isUnauthorizedError(err) ? 401 : 500,
          );
        }
      },
      POST: async ({ request }) => {
        try {
          const user = await requireUser(request);
          const body = await request.json().catch(() => ({}));

          const name = body.name as string;
          const promptTemplate = body.promptTemplate as string;

          if (!name || !promptTemplate) {
            return json(
              {
                error: 'Missing required fields: name, promptTemplate',
              },
              400,
            );
          }

          const profile = await createPromptProfile(user, {
            name,
            promptTemplate,
            description: body.description,
            mode: body.mode as 'overlay' | 'fork' | undefined,
            scope: parseScope(body.scope),
            baseRevision: body.baseRevision,
          });

          return json(profile, 201);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'failed_to_create_profile',
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
