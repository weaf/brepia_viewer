import type { User } from '@supabase/supabase-js';
import { env } from '@/server/env';
import {
  getServiceRoleSupabaseClient,
  type SupabaseClient,
} from '@/server/supabaseClient';

export type AccountRole = 'admin' | 'user';
export type AccountStatus = 'pending' | 'active' | 'disabled';
export type RegistrationIdentityPolicy = 'email' | 'social' | 'email_or_social';

export type RegistrationSettings = {
  allowRegistration: boolean;
  requireAdminApproval: boolean;
  identityPolicy: RegistrationIdentityPolicy;
  allowedSocialProviders: string[];
};

export type RegistrationState = RegistrationSettings & {
  bootstrapAvailable: boolean;
};

export type AccountAccess = {
  userId: string;
  username: string | null;
  role: AccountRole;
  status: AccountStatus;
};

export type AdminUser = AccountAccess & {
  email: string | null;
  fullName: string | null;
  contactEmail: string | null;
  localAccount: boolean;
  providers: string[];
};

type AccountRow = {
  user_id: string;
  username: string | null;
  contact_email: string | null;
  role: AccountRole;
  status: AccountStatus;
};

type RegistrationRow = {
  id: number;
  allow_registration: boolean;
  require_admin_approval: boolean;
  identity_policy: RegistrationIdentityPolicy;
  allowed_social_providers: string[];
};

export const DEFAULT_REGISTRATION_SETTINGS: RegistrationSettings = {
  allowRegistration: false,
  requireAdminApproval: true,
  identityPolicy: 'email',
  allowedSocialProviders: ['google'],
};

export class AccountAdminError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
    this.name = 'AccountAdminError';
  }
}

function isLocalAuthEmail(email: string | null | undefined) {
  return Boolean(email?.toLowerCase().endsWith('@brepia.invalid'));
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string) {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new AccountAdminError('invalid_username');
  }
  return username;
}

export function localAuthEmail(username: string) {
  return `${validateUsername(username)}@brepia.invalid`;
}

function realEmail(email: string | null | undefined) {
  if (!email || isLocalAuthEmail(email)) return null;
  return email;
}

function normalizeBootstrapIdentifier(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) throw new AccountAdminError('identifier_required');

  if (normalized.includes('@')) {
    const [local, domain, ...rest] = normalized.split('@');
    if (!local || !domain || rest.length > 0 || domain.startsWith('.')) {
      throw new AccountAdminError('invalid_email');
    }
    return {
      authEmail: normalized,
      username: null as string | null,
      contactEmail: normalized,
      displayName: local,
    };
  }

  const username = validateUsername(normalized);
  return {
    authEmail: localAuthEmail(username),
    username,
    contactEmail: null as string | null,
    displayName: username,
  };
}

function toAccess(row: AccountRow): AccountAccess {
  return {
    userId: row.user_id,
    username: row.username,
    role: row.role,
    status: row.status,
  };
}

async function getAccountRow(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccountRow | null> {
  const { data, error } = await supabase
    .from('user_accounts')
    .select('user_id,username,contact_email,role,status')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new AccountAdminError('failed_to_load_account', 500);
  return (data as AccountRow | null) ?? null;
}

async function materializeLegacyAccount(
  supabase: SupabaseClient,
  user: User,
): Promise<AccountRow> {
  const row: AccountRow = {
    user_id: user.id,
    username: isLocalAuthEmail(user.email)
      ? user.email!.slice(0, -'@brepia.invalid'.length)
      : null,
    contact_email: realEmail(user.email),
    role: 'user',
    status: 'active',
  };
  const { data, error } = await supabase
    .from('user_accounts')
    .upsert(row, { onConflict: 'user_id' })
    .select('user_id,username,contact_email,role,status')
    .single();
  if (error) throw new AccountAdminError('failed_to_create_account_state', 500);
  return data as AccountRow;
}

async function hasActiveAdmin(supabase: SupabaseClient) {
  const { count, error } = await supabase
    .from('user_accounts')
    .select('user_id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('status', 'active');
  if (error) throw new AccountAdminError('failed_to_check_admin', 500);
  return (count ?? 0) > 0;
}

async function countOtherActiveAdmins(
  supabase: SupabaseClient,
  excludedUserId: string,
) {
  const { count, error } = await supabase
    .from('user_accounts')
    .select('user_id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('status', 'active')
    .neq('user_id', excludedUserId);
  if (error) throw new AccountAdminError('failed_to_check_admin', 500);
  return count ?? 0;
}

async function assertActiveAdminInvariant(
  supabase: SupabaseClient,
  current: AccountRow,
  nextRole: AccountRole,
  nextStatus: AccountStatus,
) {
  const removesActiveAdmin =
    current.role === 'admin' &&
    current.status === 'active' &&
    (nextRole !== 'admin' || nextStatus !== 'active');

  if (
    removesActiveAdmin &&
    (await countOtherActiveAdmins(supabase, current.user_id)) === 0
  ) {
    throw new AccountAdminError('cannot_remove_last_admin', 409);
  }
}

async function canBootstrapAdmin(supabase: SupabaseClient, user: User) {
  const configuredEmail = env('BREPIA_ADMIN_EMAIL').trim().toLowerCase();
  if (configuredEmail) {
    return user.email?.trim().toLowerCase() === configuredEmail;
  }

  // Backward-compatible upgrade path for installations that existed before
  // first-user bootstrap: a sole pre-existing auth account may become admin.
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 2,
  });
  if (error)
    throw new AccountAdminError('failed_to_check_admin_bootstrap', 500);
  return data.users.length === 1 && data.users[0]?.id === user.id;
}

async function bootstrapAvailable(supabase: SupabaseClient) {
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (error) throw new AccountAdminError('failed_to_check_bootstrap', 500);
  return data.users.length === 0;
}

export async function getAccountAccess(
  user: User,
  options: { allowAdminBootstrap?: boolean } = {},
): Promise<AccountAccess> {
  const supabase = getServiceRoleSupabaseClient();
  let row = await getAccountRow(supabase, user.id);

  // A missing row means this is an account that predates the migration. It
  // remains active so rollout cannot lock out existing Brepia users.
  if (!row) row = await materializeLegacyAccount(supabase, user);

  if (
    options.allowAdminBootstrap &&
    !(await hasActiveAdmin(supabase)) &&
    (await canBootstrapAdmin(supabase, user))
  ) {
    const { data, error } = await supabase
      .from('user_accounts')
      .update({ role: 'admin', status: 'active' })
      .eq('user_id', user.id)
      .select('user_id,username,contact_email,role,status')
      .single();
    if (error) throw new AccountAdminError('failed_to_bootstrap_admin', 500);
    row = data as AccountRow;
  }

  return toAccess(row);
}

export async function requireAdmin(user: User): Promise<AccountAccess> {
  const access = await getAccountAccess(user, { allowAdminBootstrap: true });
  if (access.status !== 'active') {
    throw new AccountAdminError('account_not_active', 403);
  }
  if (access.role !== 'admin') {
    const supabase = getServiceRoleSupabaseClient();
    if (!(await hasActiveAdmin(supabase))) {
      throw new AccountAdminError('admin_bootstrap_required', 403);
    }
    throw new AccountAdminError('admin_required', 403);
  }
  return access;
}

async function loadRegistrationSettings(
  supabase: SupabaseClient,
): Promise<RegistrationSettings> {
  const { data, error } = await supabase
    .from('registration_settings')
    .select(
      'id,allow_registration,require_admin_approval,identity_policy,allowed_social_providers',
    )
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new AccountAdminError('failed_to_load_registration', 500);
  if (!data) return DEFAULT_REGISTRATION_SETTINGS;
  const row = data as RegistrationRow;
  return {
    allowRegistration: row.allow_registration,
    requireAdminApproval: row.require_admin_approval,
    identityPolicy: row.identity_policy,
    allowedSocialProviders: row.allowed_social_providers ?? [],
  };
}

export async function getRegistrationSettings(): Promise<RegistrationState> {
  const supabase = getServiceRoleSupabaseClient();
  const [settings, isBootstrapAvailable] = await Promise.all([
    loadRegistrationSettings(supabase),
    bootstrapAvailable(supabase),
  ]);
  return { ...settings, bootstrapAvailable: isBootstrapAvailable };
}

export async function updateRegistrationSettings(
  input: RegistrationSettings,
): Promise<RegistrationState> {
  if (!['email', 'social', 'email_or_social'].includes(input.identityPolicy)) {
    throw new AccountAdminError('invalid_identity_policy');
  }
  const allowedSocialProviders = Array.from(
    new Set(
      input.allowedSocialProviders
        .map((provider) => provider.trim().toLowerCase())
        .filter((provider) => ['google', 'github'].includes(provider)),
    ),
  );
  if (
    input.identityPolicy === 'social' &&
    allowedSocialProviders.length === 0
  ) {
    throw new AccountAdminError('social_provider_required');
  }

  const supabase = getServiceRoleSupabaseClient();
  const { error } = await supabase.from('registration_settings').upsert(
    {
      id: 1,
      allow_registration: Boolean(input.allowRegistration),
      require_admin_approval: Boolean(input.requireAdminApproval),
      identity_policy: input.identityPolicy,
      allowed_social_providers: allowedSocialProviders,
    },
    { onConflict: 'id' },
  );
  if (error) throw new AccountAdminError('failed_to_update_registration', 500);
  return getRegistrationSettings();
}

export type BootstrapFirstAdminInput = {
  identifier: string;
  password: string;
};

export async function bootstrapFirstAdmin(input: BootstrapFirstAdminInput) {
  if (input.password.length < 6) {
    throw new AccountAdminError('password_too_short');
  }

  const credentials = normalizeBootstrapIdentifier(input.identifier);
  const supabase = getServiceRoleSupabaseClient();
  if (!(await bootstrapAvailable(supabase))) {
    throw new AccountAdminError('bootstrap_unavailable', 409);
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: credentials.authEmail,
    password: input.password,
    email_confirm: true,
    app_metadata: { brepia_bootstrap: true },
    user_metadata: { full_name: credentials.displayName },
  });

  if (error || !data.user) {
    if (!(await bootstrapAvailable(supabase))) {
      throw new AccountAdminError('bootstrap_unavailable', 409);
    }
    throw new AccountAdminError('failed_to_create_bootstrap_admin', 500);
  }

  const account = await getAccountRow(supabase, data.user.id);
  if (!account || account.role !== 'admin' || account.status !== 'active') {
    await supabase.auth.admin.deleteUser(data.user.id);
    throw new AccountAdminError('bootstrap_unavailable', 409);
  }

  return {
    userId: data.user.id,
    username: credentials.username,
    email: credentials.contactEmail,
  };
}

async function listAuthUsers(supabase: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw new AccountAdminError('failed_to_list_users', 500);
    users.push(...data.users);
    if (data.users.length < perPage) break;
  }
  return users;
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const supabase = getServiceRoleSupabaseClient();
  const users = await listAuthUsers(supabase);
  const { data: accountData, error: accountError } = await supabase
    .from('user_accounts')
    .select('user_id,username,contact_email,role,status');
  if (accountError) throw new AccountAdminError('failed_to_list_accounts', 500);

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('user_id,full_name');
  if (profileError) throw new AccountAdminError('failed_to_list_profiles', 500);

  const accounts = new Map<string, AccountRow>(
    ((accountData ?? []) as AccountRow[]).map((row) => [row.user_id, row]),
  );
  const profiles = new Map(
    (profileData ?? []).map((row) => [row.user_id, row.full_name]),
  );

  return users.map((user) => {
    const localAccount = isLocalAuthEmail(user.email);
    const account = accounts.get(user.id);
    const fallbackUsername = localAccount
      ? user.email!.slice(0, -'@brepia.invalid'.length)
      : null;
    return {
      userId: user.id,
      username: account?.username ?? fallbackUsername,
      role: account?.role ?? 'user',
      status: account?.status ?? 'active',
      email: account?.contact_email ?? realEmail(user.email),
      contactEmail: account?.contact_email ?? null,
      fullName: profiles.get(user.id) ?? null,
      localAccount,
      providers: Array.from(
        new Set((user.identities ?? []).map((identity) => identity.provider)),
      ),
    };
  });
}

export type CreateLocalUserInput = {
  username: string;
  password: string;
  fullName?: string;
  contactEmail?: string;
};

export async function createLocalUser(input: CreateLocalUserInput) {
  const username = validateUsername(input.username);
  if (input.password.length < 6) {
    throw new AccountAdminError('password_too_short');
  }
  const contactEmail = input.contactEmail?.trim() || null;
  if (contactEmail && !contactEmail.includes('@')) {
    throw new AccountAdminError('invalid_contact_email');
  }

  const supabase = getServiceRoleSupabaseClient();
  const { data: existing } = await supabase
    .from('user_accounts')
    .select('user_id')
    .eq('username', username)
    .maybeSingle();
  if (existing) throw new AccountAdminError('username_taken', 409);

  const { data, error } = await supabase.auth.admin.createUser({
    email: localAuthEmail(username),
    password: input.password,
    email_confirm: true,
    app_metadata: { brepia_admin_created: true },
    user_metadata: {
      full_name: input.fullName?.trim() || username,
      brepia_local_account: true,
    },
  });
  if (error || !data.user) {
    throw new AccountAdminError('failed_to_create_user', 500);
  }

  const { error: accountError } = await supabase.from('user_accounts').upsert(
    {
      user_id: data.user.id,
      username,
      contact_email: contactEmail,
      role: 'user',
      status: 'active',
    },
    { onConflict: 'user_id' },
  );

  if (accountError) {
    await supabase.auth.admin.deleteUser(data.user.id);
    throw new AccountAdminError('failed_to_create_account_state', 500);
  }

  return { userId: data.user.id };
}

export type UpdateAdminUserInput = {
  userId: string;
  username?: string;
  password?: string;
  fullName?: string;
  contactEmail?: string | null;
  role?: AccountRole;
  status?: AccountStatus;
};

export async function updateAdminUser(input: UpdateAdminUserInput) {
  const supabase = getServiceRoleSupabaseClient();
  const { data, error } = await supabase.auth.admin.getUserById(input.userId);
  if (error || !data.user) throw new AccountAdminError('user_not_found', 404);
  const user = data.user;
  let account = await getAccountRow(supabase, user.id);
  if (!account) account = await materializeLegacyAccount(supabase, user);

  if (input.role && !['admin', 'user'].includes(input.role)) {
    throw new AccountAdminError('invalid_account_role');
  }
  if (
    input.status &&
    !['pending', 'active', 'disabled'].includes(input.status)
  ) {
    throw new AccountAdminError('invalid_account_status');
  }

  const nextRole = input.role ?? account.role;
  const nextStatus = input.status ?? account.status;
  await assertActiveAdminInvariant(supabase, account, nextRole, nextStatus);

  const accountUpdates: Partial<
    Pick<AccountRow, 'username' | 'contact_email' | 'role' | 'status'>
  > = {};
  let oldAuthEmail: string | null = null;

  if (input.username !== undefined) {
    if (!isLocalAuthEmail(user.email)) {
      throw new AccountAdminError('username_requires_local_account', 409);
    }
    const username = validateUsername(input.username);
    const { data: conflicting } = await supabase
      .from('user_accounts')
      .select('user_id')
      .eq('username', username)
      .neq('user_id', user.id)
      .maybeSingle();
    if (conflicting) throw new AccountAdminError('username_taken', 409);

    oldAuthEmail = user.email ?? null;
    const { error: authEmailError } = await supabase.auth.admin.updateUserById(
      user.id,
      { email: localAuthEmail(username), email_confirm: true },
    );
    if (authEmailError) {
      throw new AccountAdminError('failed_to_update_username', 500);
    }
    accountUpdates.username = username;
  }

  if (input.password !== undefined) {
    if (input.password.length < 6) {
      throw new AccountAdminError('password_too_short');
    }
    const { error: passwordError } = await supabase.auth.admin.updateUserById(
      user.id,
      { password: input.password },
    );
    if (passwordError) {
      throw new AccountAdminError('failed_to_update_password', 500);
    }
  }

  if (input.fullName !== undefined) {
    const fullName = input.fullName.trim();
    if (!fullName) throw new AccountAdminError('full_name_required');
    const { error: authMetadataError } =
      await supabase.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, full_name: fullName },
      });
    if (authMetadataError) {
      throw new AccountAdminError('failed_to_update_user_metadata', 500);
    }
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('user_id', user.id);
    if (profileError)
      throw new AccountAdminError('failed_to_update_profile', 500);
  }

  if (input.contactEmail !== undefined) {
    const contactEmail = input.contactEmail?.trim() || null;
    if (contactEmail && !contactEmail.includes('@')) {
      throw new AccountAdminError('invalid_contact_email');
    }
    accountUpdates.contact_email = contactEmail;
  }
  if (input.role !== undefined) accountUpdates.role = input.role;
  if (input.status !== undefined) accountUpdates.status = input.status;

  if (Object.keys(accountUpdates).length > 0) {
    const { error: accountError } = await supabase
      .from('user_accounts')
      .update(accountUpdates)
      .eq('user_id', user.id);
    if (accountError) {
      if (oldAuthEmail) {
        await supabase.auth.admin.updateUserById(user.id, {
          email: oldAuthEmail,
          email_confirm: true,
        });
      }
      throw new AccountAdminError('failed_to_update_account', 500);
    }
  }

  return { success: true };
}

export async function assertUserCanBeDeleted(userId: string) {
  const supabase = getServiceRoleSupabaseClient();
  const row = await getAccountRow(supabase, userId);
  if (!row || row.role !== 'admin' || row.status !== 'active') return;

  if ((await countOtherActiveAdmins(supabase, userId)) === 0) {
    throw new AccountAdminError('cannot_remove_last_admin', 409);
  }
}
