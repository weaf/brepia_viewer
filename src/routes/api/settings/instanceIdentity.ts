import { createFileRoute } from '@tanstack/react-router';
import {
  isRecord,
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import { AccountAdminError, requireAdmin } from '@/server/accountAdmin';
import {
  getInstanceIdentity,
  InstanceIdentityError,
  updateInstanceIdentity,
  type InstanceIdentityInput,
} from '@/server/instanceIdentity';

function nullableString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return value === null || typeof value === 'string' ? value : undefined;
}

function instanceError(error: unknown) {
  if (error instanceof InstanceIdentityError) {
    return json({ error: error.code }, error.status);
  }
  if (error instanceof AccountAdminError) {
    return json({ error: error.code }, error.status);
  }
  if (isUnauthorizedError(error)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  console.error('[instance-identity]', error);
  return json({ error: 'internal_error' }, 500);
}

export const Route = createFileRoute('/api/settings/instanceIdentity')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async () => {
        try {
          // Public by design. getInstanceIdentity returns only the whitelisted
          // presentation/contact fields intended for unauthenticated surfaces.
          return json(await getInstanceIdentity());
        } catch (error) {
          return instanceError(error);
        }
      },
      PUT: async ({ request }) => {
        try {
          const user = await requireUser(request);
          await requireAdmin(user);
          const body = await request.json().catch(() => null);
          if (!isRecord(body)) return json({ error: 'invalid_body' }, 400);

          const operatorName = nullableString(body, 'operatorName');
          const contactEmail = nullableString(body, 'contactEmail');
          const communityUrl = nullableString(body, 'communityUrl');
          const communityLabel =
            typeof body.communityLabel === 'string'
              ? body.communityLabel
              : undefined;
          const discordUrl = nullableString(body, 'discordUrl');
          const termsUrl = nullableString(body, 'termsUrl');
          const privacyUrl = nullableString(body, 'privacyUrl');

          if (
            operatorName === undefined ||
            contactEmail === undefined ||
            communityUrl === undefined ||
            communityLabel === undefined ||
            discordUrl === undefined ||
            termsUrl === undefined ||
            privacyUrl === undefined ||
            typeof body.showCommunityLink !== 'boolean' ||
            typeof body.legalPagesEnabled !== 'boolean'
          ) {
            return json({ error: 'invalid_instance_identity' }, 400);
          }

          const input: InstanceIdentityInput = {
            operatorName,
            contactEmail,
            communityUrl,
            communityLabel,
            showCommunityLink: body.showCommunityLink,
            discordUrl,
            legalPagesEnabled: body.legalPagesEnabled,
            termsUrl,
            privacyUrl,
          };
          return json(await updateInstanceIdentity(input));
        } catch (error) {
          return instanceError(error);
        }
      },
      POST: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
      HEAD: methodNotAllowed,
    },
  },
});
