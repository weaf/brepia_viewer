import { createFileRoute } from '@tanstack/react-router';
import {
  isRecord,
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import { GithubScadImportError } from '@/lib/githubScadImport';
import { ScadImportError } from '@/lib/scadImport';
import {
  GithubScadResolveError,
  resolveGithubScadImport,
} from '@/server/githubScadImport';

const MAX_URL_LENGTH = 2_048;

function errorResponse(error: unknown) {
  if (
    error instanceof GithubScadImportError ||
    error instanceof ScadImportError ||
    error instanceof GithubScadResolveError
  ) {
    return json({ error: error.message, code: error.code }, 400);
  }
  if (isUnauthorizedError(error)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  return json({ error: 'github_scad_import_failed' }, 500);
}

export const Route = createFileRoute('/api/scad-import/github')({
  server: {
    handlers: {
      GET: methodNotAllowed,
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const body = await request.json().catch(() => null);
          if (
            !isRecord(body) ||
            typeof body.url !== 'string' ||
            body.url.length === 0 ||
            body.url.length > MAX_URL_LENGTH
          ) {
            return json({ error: 'invalid_github_url' }, 400);
          }

          const result = await resolveGithubScadImport(body.url);
          return json(result);
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
