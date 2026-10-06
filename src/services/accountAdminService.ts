import { z } from 'zod';
import { apiJson } from '@/services/api';

export const AccountAccessSchema = z.object({
  userId: z.string(),
  username: z.string().nullable(),
  role: z.enum(['admin', 'user']),
  status: z.enum(['pending', 'active', 'disabled']),
});

export type AccountAccess = z.infer<typeof AccountAccessSchema>;

export const RegistrationSettingsSchema = z.object({
  allowRegistration: z.boolean(),
  requireAdminApproval: z.boolean(),
  identityPolicy: z.enum(['email', 'social', 'email_or_social']),
  allowedSocialProviders: z.array(z.string()),
  bootstrapAvailable: z.boolean(),
});

export type RegistrationSettings = z.infer<typeof RegistrationSettingsSchema>;

export const AdminUserSchema = AccountAccessSchema.extend({
  email: z.string().nullable(),
  fullName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  localAccount: z.boolean(),
  providers: z.array(z.string()),
});

export type AdminUser = z.infer<typeof AdminUserSchema>;

const AdminUsersSchema = z.object({ users: z.array(AdminUserSchema) });

export function getAccountAccess() {
  return apiJson(
    'delete-user?scope=access',
    { method: 'GET' },
    AccountAccessSchema,
  );
}

export function getRegistrationSettings() {
  return apiJson(
    'delete-user?scope=registration',
    { method: 'GET' },
    RegistrationSettingsSchema,
  );
}

export async function getAdminUsers() {
  const response = await apiJson(
    'delete-user?scope=users',
    { method: 'GET' },
    AdminUsersSchema,
  );
  return response.users;
}

function adminAction<T>(body: Record<string, unknown>, schema: z.ZodType<T>) {
  return apiJson(
    'delete-user',
    { method: 'POST', body: JSON.stringify(body) },
    schema,
  );
}

const SuccessSchema = z.object({ success: z.boolean() });

export function bootstrapFirstAdmin(input: {
  identifier: string;
  password: string;
}) {
  return adminAction(
    { action: 'bootstrap-admin', ...input },
    z.object({
      userId: z.string(),
      username: z.string().nullable(),
      email: z.string().nullable(),
    }),
  );
}

export function createLocalUser(input: {
  username: string;
  password: string;
  fullName?: string;
  contactEmail?: string;
}) {
  return adminAction(
    { action: 'create-user', ...input },
    z.object({ userId: z.string() }),
  );
}

export function updateAdminUser(input: {
  userId: string;
  username?: string;
  password?: string;
  fullName?: string;
  contactEmail?: string | null;
  role?: 'admin' | 'user';
  status?: 'pending' | 'active' | 'disabled';
}) {
  return adminAction({ action: 'update-user', ...input }, SuccessSchema);
}

export function deleteAdminUser(userId: string) {
  return adminAction({ action: 'delete-user', userId }, SuccessSchema);
}

export function saveRegistrationSettings(
  settings: Omit<RegistrationSettings, 'bootstrapAvailable'>,
) {
  return adminAction(
    { action: 'update-registration', ...settings },
    RegistrationSettingsSchema,
  );
}
