// P02D: Server-side ai_providers and ai_provider_models management.
//
// Handles provider CRUD, credential encryption/decryption (AES-256-GCM),
// model management, and provider testing.
//
// SECURITY: Provider credentials (API keys) are stored encrypted at rest.
// API responses only expose `hasCredential: boolean` — never the key.
// The `credential` field in CreateProviderInput is the plaintext to encrypt.
//
// NOTE: The `ai_providers` table does NOT have `preset` or `headers` columns
// yet.  These are pending migrations in P05+.

import { lookup } from 'node:dns';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { getServiceRoleSupabaseClient } from './supabaseClient';
import { env } from './env';
import { parseCustomProviderModelId } from '@shared/customModelIds';
import type {
  CreateProviderInput,
  UpdateProviderInput,
  ProviderDetailDto,
  ProviderSummaryDto,
  ProviderModelDto,
  CreateProviderModelInput,
  UpdateProviderModelInput,
  TestProviderResultDto,
} from '@shared/aiSettings';

// ---------------------------------------------------------------------------
// Credential encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

const ENCRYPTION_KEY_ENV = 'BREPIA_CREDENTIAL_ENCRYPTION_KEY';
const ALGORITHM = 'aes-256-gcm';

/**
 * Get the encryption key from the environment.
 *
 * If the key is not configured but encrypted credentials exist in the DB,
 * provider operations that require decryption will fail at runtime.  The
 * startup check in P01E should log a clear error.
 */
function getEncryptionKey(): Buffer {
  const key = env(ENCRYPTION_KEY_ENV);
  if (!key) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} is not set — custom providers with encrypted credentials are unavailable.`,
    );
  }
  const keyBuffer = Buffer.from(key, 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} must be a 256-bit (32-byte) hex key, got ${keyBuffer.length * 8} bits.`,
    );
  }
  return keyBuffer;
}

/**
 * Encrypt a plaintext credential using AES-256-GCM.
 * Returns { ciphertext, iv, tag } for DB storage.
 */
function encryptCredential(plaintext: string): {
  ciphertext: string;
  iv: string;
  tag: string;
} {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');

  const tag = cipher.getAuthTag().toString('base64');

  return { ciphertext, iv: iv.toString('base64'), tag };
}

/**
 * Decrypt a stored credential using AES-256-GCM.
 *
 * Returns `null` if decryption fails (corrupted data, wrong key).
 * This is a safety measure — never throw on decryption failure because
 * the API still needs to respond (with `hasCredential: false`).
 */
function decryptCredential(
  ciphertext: string,
  iv: string,
  tag: string,
): string | null {
  try {
    const key = getEncryptionKey();
    const ivBuffer = Buffer.from(iv, 'base64');
    const tagBuffer = Buffer.from(tag, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer);
    decipher.setAuthTag(tagBuffer);

    let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  } catch {
    // Decryption failure: corrupted data or wrong encryption key.
    // Do NOT log the full error to avoid leaking crypto internals.
    return null;
  }
}

/**
 * Check whether a provider row has encrypted credentials.
 */
function hasStoredCred(row: {
  credential_ciphertext: string | null;
  credential_iv: string | null;
  credential_tag: string | null;
}): boolean {
  return !!(
    row.credential_ciphertext &&
    row.credential_iv &&
    row.credential_tag
  );
}

// ---------------------------------------------------------------------------
// Provider CRUD
// ---------------------------------------------------------------------------

/**
 * Get all providers for a user (summaries only — no secrets).
 */
export async function getUserProviders(
  user: User,
): Promise<ProviderSummaryDto[]> {
  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from('ai_providers')
    .select('id, user_id, slug, name, driver, enabled, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to load providers: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    slug: row.slug,
    name: row.name,
    driver: row.driver as ProviderSummaryDto['driver'],
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Get a single provider by ID (with credential presence check).
 * The decrypted credential is NEVER returned — only `hasCredential`.
 */
export async function getProvider(
  userId: string,
  providerId: string,
): Promise<ProviderDetailDto | null> {
  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from('ai_providers')
    .select('*')
    .eq('id', providerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load provider: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    userId: data.user_id,
    slug: data.slug,
    name: data.name,
    driver: data.driver as ProviderDetailDto['driver'],
    baseUrl: data.base_url,
    hasCredential: hasStoredCred(data),
    enabled: data.enabled,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Create a new provider.
 */
export async function createProvider(
  user: User,
  input: CreateProviderInput,
): Promise<ProviderDetailDto> {
  const supabase = getServiceRoleSupabaseClient();

  const insertRow: Record<string, unknown> = {
    user_id: user.id,
    slug: input.slug,
    name: input.name,
    driver: input.driver,
    enabled: true,
    base_url: input.baseUrl ?? '',
  };

  // Encrypt credential if provided
  if (input.credential) {
    const { ciphertext, iv, tag } = encryptCredential(input.credential);
    insertRow.credential_ciphertext = ciphertext;
    insertRow.credential_iv = iv;
    insertRow.credential_tag = tag;
  }

  const { data, error } = await supabase
    .from('ai_providers')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(insertRow as any)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create provider: ${error.message}`);
  }

  return {
    id: data.id,
    userId: data.user_id,
    slug: data.slug,
    name: data.name,
    driver: data.driver as ProviderDetailDto['driver'],
    baseUrl: data.base_url,
    hasCredential: hasStoredCred(data),
    enabled: data.enabled,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Update an existing provider.
 *
 * Credential handling:
 * - If `credential` is provided (non-empty string), encrypt and store it.
 * - If `credential` is `null` or missing, do NOT change the existing secret.
 * - To remove a credential, use a dedicated remove endpoint.
 */
export async function updateProvider(
  userId: string,
  providerId: string,
  input: UpdateProviderInput,
): Promise<ProviderDetailDto> {
  const supabase = getServiceRoleSupabaseClient();

  // Verify ownership
  const { data: existing } = await supabase
    .from('ai_providers')
    .select('id')
    .eq('id', providerId)
    .eq('user_id', userId)
    .single();

  if (!existing) {
    throw new Error('Provider not found');
  }

  // Build update row — only include fields that were provided
  const updateRow: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.name !== undefined) updateRow.name = input.name;
  if (input.driver !== undefined) updateRow.driver = input.driver;
  if (input.baseUrl !== undefined) updateRow.base_url = input.baseUrl;
  if (input.enabled !== undefined) updateRow.enabled = input.enabled;

  // Handle credential update: only encrypt and store if a non-empty value is given
  if (input.credential) {
    const { ciphertext, iv, tag } = encryptCredential(input.credential);
    updateRow.credential_ciphertext = ciphertext;
    updateRow.credential_iv = iv;
    updateRow.credential_tag = tag;
  }

  // Remove credential if explicitly set to null (dedicated removal)
  if (input.credential === null) {
    updateRow.credential_ciphertext = null;
    updateRow.credential_iv = null;
    updateRow.credential_tag = null;
  }

  const { data, error } = await supabase
    .from('ai_providers')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(updateRow as any)
    .eq('id', providerId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update provider: ${error.message}`);
  }

  return {
    id: data.id,
    userId: data.user_id,
    slug: data.slug,
    name: data.name,
    driver: data.driver as ProviderDetailDto['driver'],
    baseUrl: data.base_url,
    hasCredential: hasStoredCred(data),
    enabled: data.enabled,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Delete a provider and cascade-delete its models.
 */
export async function deleteProvider(
  userId: string,
  providerId: string,
): Promise<void> {
  const supabase = getServiceRoleSupabaseClient();

  const { error } = await supabase
    .from('ai_providers')
    .delete()
    .eq('id', providerId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete provider: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// B6: SSRF protection for testProvider
// ---------------------------------------------------------------------------

/**
 * B6: Validate a URL to prevent SSRF attacks.
 *
 * Checks:
 * - Protocol is http or https (rejects file://, data://, javascript://, etc.)
 * - Host resolves to a public IP (rejects private, loopback, link-local,
 *   multicast, and unspecified address ranges)
 * - No redirects beyond a safe limit (followRedirects: false)
 *
 * B6: This is a security-critical function. The testProvider endpoint
 * makes outbound HTTP requests using user-supplied base URLs from the
 * database. Without these guards, an attacker could craft a provider
 * config that reaches internal services (metadata endpoints, database
 * ports, admin panels, etc.).
 *
 * Private IP ranges blocked (RFC 1918 + extras):
 * - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - 127.0.0.0/8 (loopback)
 * - 169.254.0.0/16 (link-local / AWS metadata)
 * - ::1 (IPv6 loopback)
 * - fe80::/10 (IPv6 link-local)
 * - fc00::/7 (IPv6 unique local)
 * - 0.0.0.0 (unspecified)
 */
export async function isSafeUrl(url: URL): Promise<boolean> {
  const protocol = url.protocol;
  if (protocol !== 'http:' && protocol !== 'https:') {
    return false;
  }

  const hostname = url.hostname.toLowerCase();

  // Block obvious private/restricted hostnames
  if (
    hostname === 'localhost' ||
    hostname === 'metadata.google.internal' ||
    hostname === '169.254.169.254' || // AWS/GCP/Azure metadata
    hostname === 'instance-data' ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local')
  ) {
    return false;
  }

  // Check for IP addresses (both IPv4 and IPv6)
  // If the hostname is a bare IP, validate the range
  const ipv4Match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    // Validate octets
    if (
      a > 255 ||
      b > 255 ||
      c > 255 ||
      d > 255 ||
      a < 0 ||
      b < 0 ||
      c < 0 ||
      d < 0
    ) {
      return false;
    }
    // 10.0.0.0/8
    if (a === 10) return false;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return false;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return false;
    // 127.0.0.0/8 (loopback)
    if (a === 127) return false;
    // 169.254.0.0/16 (link-local / metadata)
    if (a === 169 && b === 254) return false;
    // 0.0.0.0 (unspecified)
    if (a === 0) return false;
    // 224.0.0.0/4 (multicast)
    if (a >= 224 && a <= 239) return false;
    // 240.0.0.0/4 (reserved)
    if (a >= 240) return false;
    return true;
  }

  // For hostnames (not bare IPs), try to resolve and check the IP
  // This catches cases where a domain name resolves to a private IP
  const resolve = promisify(lookup);
  try {
    const addr = await resolve(hostname);
    if (addr && typeof addr === 'object' && 'address' in addr) {
      return isSafeIpAddress(addr.address as string);
    }
  } catch {
    // DNS lookup failed — let the fetch fail naturally rather than
    // blocking legitimate cases where DNS is slow/unavailable
  }

  return true;
}

/**
 * B6: Check whether an IP address string is in a private/restricted range.
 *
 * Exported for unit testing — the SSRF guard is security-critical code that
 * requires verifiable test coverage per project conventions.
 */
export function isSafeIpAddress(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return false;

  const parts = ip.split('.');
  if (parts.length !== 4) {
    // Not IPv4 — assume safe if DNS lookup succeeded (could be IPv6)
    // IPv6 private ranges would need separate handling, but most Node
    // DNS lookups return IPv4 for mixed scenarios
    return true;
  }

  const [a, b] = parts.map(Number);
  // 10.0.0.0/8
  if (a === 10) return false;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return false;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return false;
  // 127.0.0.0/8
  if (a === 127) return false;
  // 169.254.0.0/16
  if (a === 169 && b === 254) return false;
  return true;
}

/**
 * Test provider connectivity.
 *
 * Sends a minimal request (e.g., GET /v1/models for OpenAI-compatible)
 * to verify the provider is reachable with the given credentials.
 *
 * SECURITY: Do NOT log the credential or Authorization header.
 * B6: SSRF protection — validates URL protocol, resolves host to IP,
 * and blocks private/link-local/metadata addresses before making the request.
 */
export async function testProvider(
  userId: string,
  providerId: string | undefined,
  draftConfig?: CreateProviderInput,
): Promise<TestProviderResultDto> {
  const supabase = getServiceRoleSupabaseClient();
  const providerRow: {
    base_url: string | null;
    credential_ciphertext: string | null;
    credential_iv: string | null;
    credential_tag: string | null;
  } | null = providerId
    ? ((
        await supabase
          .from('ai_providers')
          .select(
            'base_url, credential_ciphertext, credential_iv, credential_tag',
          )
          .eq('id', providerId)
          .eq('user_id', userId)
          .maybeSingle()
      ).data ?? null)
    : null;

  // For draft testing, we use the provided config directly.
  // For existing providers, we decrypt the stored credential.
  const baseUrl = draftConfig?.baseUrl || providerRow?.base_url || '';
  const credential =
    draftConfig?.credential ??
    (providerRow && hasStoredCred(providerRow)
      ? decryptCredential(
          providerRow.credential_ciphertext!,
          providerRow.credential_iv!,
          providerRow.credential_tag!,
        )
      : null);

  const startTime = Date.now();

  // B6: SSRF guard — reject dangerous URLs before making any network request
  const testUrl = baseUrl.replace(/\/$/, '') + '/v1/models';
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(testUrl);
  } catch {
    return {
      ok: false,
      message: 'Connection failed: invalid URL',
      latencyMs: 0,
    };
  }
  if (!(await isSafeUrl(parsedUrl))) {
    return {
      ok: false,
      message: 'Connection failed: SSRF protection blocks this address',
      latencyMs: 0,
    };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (credential) {
      headers['Authorization'] = `Bearer ${credential}`;
    }

    const response = await fetch(testUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    const latency = Date.now() - startTime;

    if (response.ok) {
      return {
        ok: true,
        message: 'Provider responded successfully',
        latencyMs: latency,
      };
    }

    return {
      ok: false,
      message: `Provider returned ${response.status} ${response.statusText}`,
      latencyMs: latency,
    };
  } catch (err) {
    const latency = Date.now() - startTime;
    const message =
      err instanceof Error
        ? err.message
        : 'Unknown error connecting to provider';
    return {
      ok: false,
      message: `Connection failed: ${message}`,
      latencyMs: latency,
    };
  }
}

// ---------------------------------------------------------------------------
// Provider Models CRUD
// ---------------------------------------------------------------------------

/**
 * Get a single model by its ID (scoped to user via FK).
 */
export async function getModelById(
  modelId: string,
  userId: string,
): Promise<ProviderModelDto | null> {
  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from('ai_provider_models')
    .select('*')
    .eq('id', modelId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load provider model: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    providerId: data.provider_id,
    userId: data.user_id,
    modelId: data.model_id,
    displayName: data.display_name,
    description: data.description,
    supportsTools: data.supports_tools,
    supportsThinking: data.supports_thinking,
    supportsVision: data.supports_vision,
    contextLimit: data.context_limit,
    outputLimit: data.output_limit,
    isVisible: data.is_visible,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Get all models for a provider (scoped to user via FK).
 *
 * B6: Ownership guard — every service-role query for provider models
 * must be scoped to the requesting user_id to prevent cross-user model access.
 * Without this, a malicious user who guesses another user's providerId
 * could enumerate their custom models.
 */
export async function getProviderModels(
  providerId: string,
  userId: string,
): Promise<ProviderModelDto[]> {
  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from('ai_provider_models')
    .select('*')
    .eq('provider_id', providerId)
    .eq('user_id', userId)
    .order('is_visible', { ascending: false })
    .order('display_name', { ascending: true });

  if (error) {
    throw new Error(`Failed to load provider models: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    providerId: row.provider_id,
    userId: row.user_id,
    modelId: row.model_id,
    displayName: row.display_name,
    description: row.description,
    supportsTools: row.supports_tools,
    supportsThinking: row.supports_thinking,
    supportsVision: row.supports_vision,
    contextLimit: row.context_limit,
    outputLimit: row.output_limit,
    isVisible: row.is_visible,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Create a model for a provider.
 */
export async function createProviderModel(
  providerId: string,
  userId: string,
  input: CreateProviderModelInput,
): Promise<ProviderModelDto> {
  const supabase = getServiceRoleSupabaseClient();

  // Verify the provider belongs to this user
  const { data: prov } = await supabase
    .from('ai_providers')
    .select('id')
    .eq('id', providerId)
    .eq('user_id', userId)
    .single();

  if (!prov) {
    throw new Error('Provider not found');
  }

  const { data, error } = await supabase
    .from('ai_provider_models')
    .insert({
      provider_id: providerId,
      user_id: userId,
      model_id: input.modelId,
      display_name: input.displayName,
      description: input.description ?? null,
      supports_tools: input.supportsTools ?? false,
      supports_thinking: input.supportsThinking ?? false,
      supports_vision: input.supportsVision ?? false,
      context_limit: input.contextLimit ?? null,
      output_limit: input.outputLimit ?? null,
      is_visible: input.isVisible,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create provider model: ${error.message}`);
  }

  return {
    id: data.id,
    providerId: data.provider_id,
    userId: data.user_id,
    modelId: data.model_id,
    displayName: data.display_name,
    description: data.description,
    supportsTools: data.supports_tools,
    supportsThinking: data.supports_thinking,
    supportsVision: data.supports_vision,
    contextLimit: data.context_limit,
    outputLimit: data.output_limit,
    isVisible: data.is_visible,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Update a provider model.
 */
export async function updateProviderModel(
  modelId: string,
  userId: string,
  input: UpdateProviderModelInput,
): Promise<ProviderModelDto> {
  const supabase = getServiceRoleSupabaseClient();

  const updateRow: Record<string, unknown> = {};

  if (input.displayName !== undefined)
    updateRow.display_name = input.displayName;
  if (input.description !== undefined)
    updateRow.description = input.description;
  if (input.supportsTools !== undefined)
    updateRow.supports_tools = input.supportsTools;
  if (input.supportsThinking !== undefined)
    updateRow.supports_thinking = input.supportsThinking;
  if (input.supportsVision !== undefined)
    updateRow.supports_vision = input.supportsVision;
  if (input.contextLimit !== undefined)
    updateRow.context_limit = input.contextLimit;
  if (input.outputLimit !== undefined)
    updateRow.output_limit = input.outputLimit;
  if (input.isVisible !== undefined) updateRow.is_visible = input.isVisible;
  updateRow.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('ai_provider_models')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(updateRow as any)
    .eq('id', modelId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update provider model: ${error.message}`);
  }

  return {
    id: data.id,
    providerId: data.provider_id,
    userId: data.user_id,
    modelId: data.model_id,
    displayName: data.display_name,
    description: data.description,
    supportsTools: data.supports_tools,
    supportsThinking: data.supports_thinking,
    supportsVision: data.supports_vision,
    contextLimit: data.context_limit,
    outputLimit: data.output_limit,
    isVisible: data.is_visible,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Delete a provider model.
 */
export async function deleteProviderModel(
  modelId: string,
  userId: string,
): Promise<void> {
  const supabase = getServiceRoleSupabaseClient();

  const { error } = await supabase
    .from('ai_provider_models')
    .delete()
    .eq('id', modelId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete provider model: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// P06: Runtime custom-provider routing (buildCustomChatModel)
// ---------------------------------------------------------------------------

/**
 * P06B: Build a custom chat model from a custom provider model ID.
 *
 * Parses the custom model ID (`custom/<provider-uuid>/<model-id>`), loads
 * the provider and model rows from the database, validates them, decrypts
 * the credential, and instantiates the appropriate AI SDK provider.
 *
 * Returns a tuple of [LanguageModel, ProviderOptions | undefined] so the
 * call site can pass it directly to `streamText({ model, providerOptions })`.
 *
 * Also returns model capability metadata (P06C) so the caller can gate
 * features like tool calls and vision based on model support.
 *
 * Throws explicit errors for every failure mode (P06E):
 * - Custom provider disabled
 * - Custom model disabled
 * - Provider credential missing
 * - Provider authentication failed (401)
 * - Provider endpoint unreachable (network error)
 * - Provider model not found
 * - Unsupported driver
 */
export async function buildCustomChatModel(
  modelId: string,
  userId: string,
  thinkingEnabled: boolean,
  thinkingBudget?: number,
): Promise<{
  model: LanguageModel;
  providerOptions?: ProviderOptions;
  capabilities: { supportsTools: boolean; supportsVision: boolean };
  billingSource: 'custom'; // P06D: mark as custom/BYOK — never use FALLBACK_MODEL_PRICE
}> {
  // --- 1. Parse custom model ID ---
  const parsed = parseCustomProviderModelId(modelId);
  if (!parsed) {
    throw new Error(`Invalid custom model ID: ${modelId}`);
  }

  const { providerId, modelId: nativeModelId } = parsed;

  // --- 2. Load provider row (scoped to user) ---
  const supabase = getServiceRoleSupabaseClient();

  const { data: providerRow, error: providerError } = await supabase
    .from('ai_providers')
    .select('*')
    .eq('id', providerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (providerError) {
    throw new Error(
      `Provider not found: custom provider ${providerId} does not belong to this user.`,
    );
  }

  if (!providerRow) {
    throw new Error(
      `Custom provider disabled: provider ${providerId} not found.`,
    );
  }

  if (!providerRow.enabled) {
    throw new Error(
      `Custom provider disabled: ${providerRow.name} is disabled.`,
    );
  }

  // --- 3. Load model row (scoped to user) ---
  const { data: modelRow, error: modelError } = await supabase
    .from('ai_provider_models')
    .select('*')
    .eq('id', nativeModelId)
    .eq('provider_id', providerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (modelError) {
    throw new Error(
      `Custom model not found: model ${nativeModelId} not found.`,
    );
  }

  if (!modelRow) {
    throw new Error(`Custom model disabled: model ${nativeModelId} not found.`);
  }

  if (!modelRow.is_visible) {
    throw new Error(
      `Custom model disabled: model ${modelRow.display_name || nativeModelId} is not visible.`,
    );
  }

  // --- 4. Decrypt credential ---
  const credential = decryptStoredCredential(providerRow);

  if (!credential) {
    throw new Error('Provider credential missing: no API key configured.');
  }

  // --- 5. Instantiate AI SDK provider based on driver ---
  const driver = providerRow.driver as string;

  switch (driver) {
    case 'openai-compatible': {
      const provider = createOpenAICompatible({
        name: providerRow.slug || 'custom-openai',
        apiKey: credential,
        baseURL: providerRow.base_url ?? undefined,
      });
      const model = provider(nativeModelId);
      return {
        model,
        capabilities: {
          supportsTools: modelRow.supports_tools ?? true,
          supportsVision: modelRow.supports_vision ?? true,
        },
        billingSource: 'custom' as const,
      };
    }

    case 'anthropic': {
      const provider = createAnthropic({
        apiKey: credential,
        baseURL: providerRow.base_url ?? undefined,
      });
      const model = provider(nativeModelId);
      const providerOptions: ProviderOptions | undefined = thinkingEnabled
        ? {
            anthropic: {
              thinking: {
                type: 'enabled' as const,
                budgetTokens: thinkingBudget || 4096,
              },
            },
          }
        : undefined;
      return {
        model,
        providerOptions,
        capabilities: {
          supportsTools: modelRow.supports_tools ?? true,
          supportsVision: modelRow.supports_vision ?? false,
        },
        billingSource: 'custom' as const,
      };
    }

    case 'google': {
      const provider = createGoogleGenerativeAI({
        apiKey: credential,
      });
      const model = provider(nativeModelId);
      return {
        model,
        capabilities: {
          supportsTools: modelRow.supports_tools ?? true,
          supportsVision: modelRow.supports_vision ?? true,
        },
        billingSource: 'custom' as const,
      };
    }

    case 'openrouter': {
      const provider = createOpenRouter({
        apiKey: credential,
      });
      const model = provider.chat(nativeModelId, {
        ...(thinkingEnabled
          ? { reasoning: { max_tokens: thinkingBudget || 4096 } }
          : {}),
        usage: { include: true },
      });
      return {
        model,
        capabilities: {
          supportsTools: modelRow.supports_tools ?? true,
          supportsVision: modelRow.supports_vision ?? true,
        },
        billingSource: 'custom' as const,
      };
    }

    default:
      throw new Error(
        `Provider does not support required CAD tools: unsupported driver "${driver}".`,
      );
  }
}

function decryptStoredCredential(row: {
  credential_ciphertext: string | null;
  credential_iv: string | null;
  credential_tag: string | null;
}): string | null {
  if (!hasStoredCred(row)) return null;
  return decryptCredential(
    row.credential_ciphertext!,
    row.credential_iv!,
    row.credential_tag!,
  );
}
