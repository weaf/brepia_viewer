import crypto from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { env } from './env';
import { getServiceRoleSupabaseClient } from './supabaseClient';
import {
  createProvider,
  deleteProvider,
  getProvider,
  getUserProviders,
  updateProvider,
} from './customProviders';

export type BuiltinProviderDriver =
  'anthropic' | 'google' | 'openrouter' | 'openai-compatible';

export const BUILTIN_PROVIDER_DRIVERS: BuiltinProviderDriver[] = [
  'anthropic',
  'google',
  'openrouter',
  'openai-compatible',
];

export const BUILTIN_PROVIDER_LABELS: Record<BuiltinProviderDriver, string> = {
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
  'openai-compatible': 'Local OpenAI / llama-swap',
};

export const BUILTIN_PROVIDER_OVERRIDE_SLUGS: Record<
  BuiltinProviderDriver,
  string
> = {
  anthropic: 'builtin-anthropic',
  google: 'builtin-google',
  openrouter: 'builtin-openrouter',
  'openai-compatible': 'builtin-openai-compatible',
};

export interface BuiltinProviderSettingsDto {
  driver: BuiltinProviderDriver;
  label: string;
  overrideId: string | null;
  customized: boolean;
  enabled: boolean;
  baseUrl: string;
  hasCredential: boolean;
  credentialSource: 'override' | 'server' | 'none';
}

export interface BuiltinProviderRuntimeOverride {
  enabled: boolean;
  baseUrl?: string;
  credential?: string;
}

export type BuiltinProviderRuntimeOverrides = Partial<
  Record<BuiltinProviderDriver, BuiltinProviderRuntimeOverride>
>;

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_ENV = 'BREPIA_CREDENTIAL_ENCRYPTION_KEY';

function serverBaseUrl(driver: BuiltinProviderDriver): string {
  switch (driver) {
    case 'anthropic': {
      const raw = env('ANTHROPIC_BASE_URL').trim();
      if (!raw) return 'https://api.anthropic.com/v1';
      const base = raw.replace(/\/+$/, '');
      return base.endsWith('/v1') ? base : `${base}/v1`;
    }
    case 'google':
      return (
        env('GOOGLE_BASE_URL').trim() ||
        'https://generativelanguage.googleapis.com/v1beta'
      );
    case 'openrouter':
      return (
        env('OPENROUTER_BASE_URL').trim() || 'https://openrouter.ai/api/v1'
      );
    case 'openai-compatible':
      return env('LOCAL_LLM_BASE_URL').trim() || 'http://localhost:11434/v1';
  }
}

function serverHasCredential(driver: BuiltinProviderDriver): boolean {
  switch (driver) {
    case 'anthropic':
      return Boolean(env('ANTHROPIC_API_KEY'));
    case 'google':
      return Boolean(env('GOOGLE_API_KEY'));
    case 'openrouter':
      return Boolean(env('OPENROUTER_API_KEY'));
    case 'openai-compatible':
      // The local provider deliberately supports keyless local servers and
      // falls back to the harmless "ollama" compatibility token at runtime.
      return Boolean(env('LOCAL_LLM_API_KEY'));
  }
}

function hasStoredCredential(row: {
  credential_ciphertext: string | null;
  credential_iv: string | null;
  credential_tag: string | null;
}): boolean {
  return Boolean(
    row.credential_ciphertext && row.credential_iv && row.credential_tag,
  );
}

function decryptStoredCredential(row: {
  credential_ciphertext: string | null;
  credential_iv: string | null;
  credential_tag: string | null;
}): string | undefined {
  if (!hasStoredCredential(row)) return undefined;

  const keyHex = env(ENCRYPTION_KEY_ENV);
  const key = Buffer.from(keyHex, 'hex');
  if (!keyHex || key.length !== 32) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} must be configured to use a saved provider credential.`,
    );
  }

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(row.credential_iv!, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(row.credential_tag!, 'base64'));
    let plaintext = decipher.update(
      row.credential_ciphertext!,
      'base64',
      'utf8',
    );
    plaintext += decipher.final('utf8');
    return plaintext;
  } catch {
    throw new Error('Saved provider credential could not be decrypted.');
  }
}

export function isBuiltinProviderOverrideSlug(slug: string): boolean {
  return Object.values(BUILTIN_PROVIDER_OVERRIDE_SLUGS).includes(slug);
}

async function overrideSummary(user: User, driver: BuiltinProviderDriver) {
  const slug = BUILTIN_PROVIDER_OVERRIDE_SLUGS[driver];
  const providers = await getUserProviders(user);
  const summary = providers.find((provider) => provider.slug === slug);
  if (!summary) return null;
  return getProvider(user.id, summary.id);
}

export async function listBuiltinProviderSettings(
  user: User,
): Promise<BuiltinProviderSettingsDto[]> {
  const providers = await getUserProviders(user);
  const summaries = new Map(
    providers.map((provider) => [provider.slug, provider]),
  );

  return Promise.all(
    BUILTIN_PROVIDER_DRIVERS.map(async (driver) => {
      const slug = BUILTIN_PROVIDER_OVERRIDE_SLUGS[driver];
      const summary = summaries.get(slug);
      const detail = summary ? await getProvider(user.id, summary.id) : null;
      const overrideCredential = Boolean(detail?.hasCredential);
      const inheritedCredential = serverHasCredential(driver);

      return {
        driver,
        label: BUILTIN_PROVIDER_LABELS[driver],
        overrideId: detail?.id ?? null,
        customized: Boolean(detail),
        enabled: detail?.enabled ?? true,
        baseUrl: detail?.baseUrl || serverBaseUrl(driver),
        hasCredential: overrideCredential || inheritedCredential,
        credentialSource: overrideCredential
          ? ('override' as const)
          : inheritedCredential
            ? ('server' as const)
            : ('none' as const),
      };
    }),
  );
}

export async function saveBuiltinProviderSettings(
  user: User,
  input: {
    driver: BuiltinProviderDriver;
    baseUrl?: string;
    credential?: string | null;
    enabled?: boolean;
  },
): Promise<BuiltinProviderSettingsDto> {
  const driver = input.driver;
  const slug = BUILTIN_PROVIDER_OVERRIDE_SLUGS[driver];
  if (!slug) throw new Error('Unsupported built-in provider');

  const existing = await overrideSummary(user, driver);
  if (existing) {
    await updateProvider(user.id, existing.id, {
      name: BUILTIN_PROVIDER_LABELS[driver],
      driver,
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.credential !== undefined
        ? { credential: input.credential }
        : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
  } else {
    const created = await createProvider(user, {
      slug,
      name: BUILTIN_PROVIDER_LABELS[driver],
      driver,
      baseUrl: input.baseUrl ?? serverBaseUrl(driver),
      ...(typeof input.credential === 'string' && input.credential
        ? { credential: input.credential }
        : {}),
    });
    if (input.enabled === false) {
      await updateProvider(user.id, created.id, { enabled: false });
    }
  }

  const all = await listBuiltinProviderSettings(user);
  return all.find((item) => item.driver === driver)!;
}

export async function resetBuiltinProviderSettings(
  user: User,
  driver: BuiltinProviderDriver,
): Promise<BuiltinProviderSettingsDto> {
  const existing = await overrideSummary(user, driver);
  if (existing) await deleteProvider(user.id, existing.id);
  const all = await listBuiltinProviderSettings(user);
  return all.find((item) => item.driver === driver)!;
}

/**
 * Load only user-authored overrides for the inference path. Missing fields are
 * intentionally omitted so the normal server environment remains the fallback.
 */
export async function loadBuiltinProviderRuntimeOverrides(
  userId: string,
): Promise<BuiltinProviderRuntimeOverrides> {
  const supabase = getServiceRoleSupabaseClient();
  const slugs = Object.values(BUILTIN_PROVIDER_OVERRIDE_SLUGS);
  const { data, error } = await supabase
    .from('ai_providers')
    .select(
      'slug, enabled, base_url, credential_ciphertext, credential_iv, credential_tag',
    )
    .eq('user_id', userId)
    .in('slug', slugs);

  if (error) {
    throw new Error(
      `Failed to load built-in provider overrides: ${error.message}`,
    );
  }

  const driverBySlug = new Map(
    BUILTIN_PROVIDER_DRIVERS.map((driver) => [
      BUILTIN_PROVIDER_OVERRIDE_SLUGS[driver],
      driver,
    ]),
  );
  const result: BuiltinProviderRuntimeOverrides = {};

  for (const row of data ?? []) {
    const driver = driverBySlug.get(row.slug);
    if (!driver) continue;
    result[driver] = {
      enabled: row.enabled,
      ...(row.base_url ? { baseUrl: row.base_url } : {}),
      ...(hasStoredCredential(row)
        ? { credential: decryptStoredCredential(row) }
        : {}),
    };
  }

  return result;
}
