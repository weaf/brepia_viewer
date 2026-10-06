import { createFileRoute } from '@tanstack/react-router';
import {
  authenticateUser,
  isRecord,
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import {
  AccountAdminError,
  assertUserCanBeDeleted,
  bootstrapFirstAdmin,
  createLocalUser,
  getAccountAccess,
  getRegistrationSettings,
  listAdminUsers,
  requireAdmin,
  updateAdminUser,
  updateRegistrationSettings,
  type AccountRole,
  type AccountStatus,
  type RegistrationIdentityPolicy,
} from '@/server/accountAdmin';
import { getServiceRoleSupabaseClient } from '@/server/supabaseClient';
import { teardownUser } from '@/server/deleteUserTeardown';

function accountError(error: unknown) {
  if (error instanceof AccountAdminError) {
    return json({ error: error.code }, error.status);
  }
  if (isUnauthorizedError(error)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  console.error('[account-admin]', error);
  return json({ error: 'internal_error' }, 500);
}

function stringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export const Route = createFileRoute('/api/delete-user')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request }) => {
        const scope = new URL(request.url).searchParams.get('scope');
        try {
          if (scope === 'registration') {
            return json(await getRegistrationSettings());
          }
          if (scope === 'access') {
            const user = await authenticateUser(request);
            return json(
              await getAccountAccess(user, { allowAdminBootstrap: true }),
            );
          }

          const user = await requireUser(request);
          if (scope === 'users') {
            await requireAdmin(user);
            return json({ users: await listAdminUsers() });
          }
          return json({ error: 'invalid_scope' }, 400);
        } catch (error) {
          return accountError(error);
        }
      },
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));

        try {
          if (isRecord(body) && body.action === 'bootstrap-admin') {
            const identifier = stringValue(body, 'identifier') ?? '';
            const password = stringValue(body, 'password') ?? '';
            return json(
              await bootstrapFirstAdmin({ identifier, password }),
              201,
            );
          }

          const user = await requireUser(request);

          // Backward-compatible self-delete contract used by the existing
          // DeleteAccountDialog. Admin users additionally get last-admin
          // protection so the local installation cannot be orphaned.
          if (!isRecord(body) || typeof body.action !== 'string') {
            await assertUserCanBeDeleted(user.id);
            const supabase = getServiceRoleSupabaseClient();
            await teardownUser(supabase, { id: user.id });
            return json({ success: true });
          }

          await requireAdmin(user);
          const action = body.action;

          if (action === 'create-user') {
            const username = stringValue(body, 'username') ?? '';
            const password = stringValue(body, 'password') ?? '';
            const fullName = stringValue(body, 'fullName');
            const contactEmail = stringValue(body, 'contactEmail');
            const created = await createLocalUser({
              username,
              password,
              fullName,
              contactEmail,
            });
            return json(created, 201);
          }

          if (action === 'update-user') {
            const userId = stringValue(body, 'userId');
            if (!userId) return json({ error: 'user_id_required' }, 400);
            const statusValue = stringValue(body, 'status');
            const roleValue = stringValue(body, 'role');
            const status = statusValue as AccountStatus | undefined;
            const role = roleValue as AccountRole | undefined;
            return json(
              await updateAdminUser({
                userId,
                username: Object.prototype.hasOwnProperty.call(body, 'username')
                  ? (stringValue(body, 'username') ?? '')
                  : undefined,
                password: Object.prototype.hasOwnProperty.call(body, 'password')
                  ? (stringValue(body, 'password') ?? '')
                  : undefined,
                fullName: Object.prototype.hasOwnProperty.call(body, 'fullName')
                  ? (stringValue(body, 'fullName') ?? '')
                  : undefined,
                contactEmail: Object.prototype.hasOwnProperty.call(
                  body,
                  'contactEmail',
                )
                  ? (stringValue(body, 'contactEmail') ?? null)
                  : undefined,
                role,
                status,
              }),
            );
          }

          if (action === 'delete-user') {
            const userId = stringValue(body, 'userId');
            if (!userId) return json({ error: 'user_id_required' }, 400);
            await assertUserCanBeDeleted(userId);
            const supabase = getServiceRoleSupabaseClient();
            await teardownUser(
              supabase,
              { id: userId },
              { awaitStorage: true },
            );
            return json({ success: true });
          }

          if (action === 'update-registration') {
            const identityPolicy = stringValue(body, 'identityPolicy') as
              RegistrationIdentityPolicy | undefined;
            const providers = Array.isArray(body.allowedSocialProviders)
              ? body.allowedSocialProviders.filter(
                  (value): value is string => typeof value === 'string',
                )
              : [];
            if (!identityPolicy) {
              return json({ error: 'identity_policy_required' }, 400);
            }
            return json(
              await updateRegistrationSettings({
                allowRegistration: body.allowRegistration === true,
                requireAdminApproval: body.requireAdminApproval !== false,
                identityPolicy,
                allowedSocialProviders: providers,
              }),
            );
          }

          return json({ error: 'invalid_action' }, 400);
        } catch (error) {
          return accountError(error);
        }
      },
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
      HEAD: methodNotAllowed,
    },
  },
});
