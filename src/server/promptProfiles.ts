// Server-side prompt_profiles management.
//
// Repository-backed instruction packages choose the shipped template version
// for every instruction key. User-owned prompt_profiles remain a second layer:
// they can overlay or fully replace the selected package template for one key.
// `builtin:*` IDs are technical compatibility/template identifiers, not mutable
// database rows and not a Reset-to-Original product mechanism.

import crypto from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { getServiceRoleSupabaseClient } from './supabaseClient';
import { getPreferencesByUserId } from './aiSettings';
import {
  getAiInstructionDefinition,
  getAiInstructionProfileDefinition,
  isAiInstructionKey,
  loadBundledInstruction,
  normalizeAiInstructionProfileId,
  type AiInstructionProfileId,
} from '@shared/aiInstructionCatalog';
import type {
  CreatePromptProfileInput,
  UpdatePromptProfileInput,
  PromptProfileSummaryDto,
  PromptProfileDetailDto,
  PromptProfileScope,
} from '@shared/aiSettings';

export const BUILTIN_PROFILE_ID = 'builtin:parametric';
export const BUILTIN_CREATIVE_PROFILE_ID = 'builtin:creative';

const DEFAULT_ORIGINAL_INSTRUCTION_PROFILE_ID: AiInstructionProfileId =
  'brepia-core';

type PromptProfileMode = PromptProfileDetailDto['mode'];

type PromptProfileRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  prompt_template: string;
  mode: string;
  scope?: string;
  base_revision: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export class ActivePromptProfileError extends Error {
  constructor() {
    super('Choose another active profile before archiving this profile.');
    this.name = 'ActivePromptProfileError';
  }
}

function parsePromptProfileMode(mode: string): PromptProfileMode {
  if (mode === 'overlay' || mode === 'fork') return mode;
  throw new Error(`Invalid prompt profile mode: ${mode}`);
}

function parsePromptProfileScope(
  scope: string | undefined,
): PromptProfileScope {
  if (scope == null) return 'parametric';
  if (isAiInstructionKey(scope)) return scope;
  throw new Error(`Unknown prompt profile scope: ${scope}`);
}

function bundledPrompt(
  scope: PromptProfileScope,
  instructionProfileId: AiInstructionProfileId,
): string {
  return loadBundledInstruction(scope, instructionProfileId);
}

function builtinProfileId(scope: PromptProfileScope): string {
  return `builtin:${scope}`;
}

function builtinProfileScope(profileId: string): PromptProfileScope | null {
  if (!profileId.startsWith('builtin:')) return null;
  const scope = profileId.slice('builtin:'.length);
  return isAiInstructionKey(scope) ? scope : null;
}

function builtinProfileName(
  scope: PromptProfileScope,
  instructionProfileId: AiInstructionProfileId,
  packageLabel: string,
  instructionLabel: string,
): string {
  if (instructionProfileId === DEFAULT_ORIGINAL_INSTRUCTION_PROFILE_ID) {
    if (scope === 'parametric') return 'Brepia Original';
    if (scope === 'creative') return 'Creative Original';
  }
  return `${packageLabel} · ${instructionLabel}`;
}

async function assertPromptProfileIsNotActive(
  userId: string,
  profileId: string,
): Promise<void> {
  const preferences = await getPreferencesByUserId(userId);
  if (
    preferences.defaultPromptProfileId === profileId ||
    preferences.defaultCreativePromptProfileId === profileId ||
    Object.values(preferences.instructionProfileDefaults).includes(profileId)
  ) {
    throw new ActivePromptProfileError();
  }
}

const builtinFingerprintCache = new Map<string, string>();

export function fingerprint(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export function loadBuiltinProfile(
  scope: PromptProfileScope = 'parametric',
  instructionProfileId: AiInstructionProfileId = DEFAULT_ORIGINAL_INSTRUCTION_PROFILE_ID,
): PromptProfileDetailDto {
  const normalizedInstructionProfileId =
    normalizeAiInstructionProfileId(instructionProfileId);
  const definition = getAiInstructionDefinition(scope);
  if (!definition) throw new Error(`Unknown AI instruction: ${scope}`);
  const packageDefinition = getAiInstructionProfileDefinition(
    normalizedInstructionProfileId,
  );
  if (!packageDefinition) {
    throw new Error(`Unknown AI instruction profile: ${instructionProfileId}`);
  }

  const prompt = bundledPrompt(scope, normalizedInstructionProfileId);
  const cacheKey = `${normalizedInstructionProfileId}:${scope}`;
  let currentFingerprint = builtinFingerprintCache.get(cacheKey);
  if (!currentFingerprint) {
    currentFingerprint = fingerprint(prompt);
    builtinFingerprintCache.set(cacheKey, currentFingerprint);
  }

  return {
    id: builtinProfileId(scope),
    userId: '',
    name: builtinProfileName(
      scope,
      normalizedInstructionProfileId,
      packageDefinition.label,
      definition.label,
    ),
    description: `${packageDefinition.label} package template. ${definition.description}`,
    promptTemplate: prompt,
    mode: 'overlay',
    scope,
    fingerprint: currentFingerprint,
    editable: false,
    deletable: false,
    baseRevision: null,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function rowToDetail(row: PromptProfileRow): PromptProfileDetailDto {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    promptTemplate: row.prompt_template,
    mode: parsePromptProfileMode(row.mode),
    scope: parsePromptProfileScope(row.scope),
    fingerprint: null,
    editable: true,
    deletable: true,
    baseRevision: row.base_revision,
    archived: row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getUserPromptProfiles(
  user: User,
  includeArchived = false,
  scope: PromptProfileScope = 'parametric',
): Promise<PromptProfileSummaryDto[]> {
  const supabase = getServiceRoleSupabaseClient();

  // Generalized instruction scopes are introduced by a post-merge migration.
  // Keep this cast local until generated Supabase types are refreshed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase.from('prompt_profiles') as any)
    .select(
      'id, user_id, name, description, mode, scope, base_revision, archived, created_at, updated_at',
    )
    .eq('user_id', user.id)
    .eq('scope', scope)
    .order('created_at', { ascending: false });

  if (!includeArchived) query = query.eq('archived', false);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load prompt profiles: ${error.message}`);
  }

  const customProfiles: PromptProfileSummaryDto[] = (
    (data ?? []) as PromptProfileRow[]
  ).map((row) => {
    const detail = rowToDetail({ ...row, prompt_template: '' });
    return {
      id: detail.id,
      userId: detail.userId,
      name: detail.name,
      description: detail.description,
      mode: detail.mode,
      scope: detail.scope,
      fingerprint: null,
      editable: true,
      deletable: true,
      baseRevision: detail.baseRevision,
      archived: detail.archived,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  });

  const preferences = await getPreferencesByUserId(user.id);
  const builtIn = loadBuiltinProfile(
    scope,
    preferences.defaultInstructionProfileId,
  );
  return [
    {
      id: builtIn.id,
      userId: builtIn.userId,
      name: builtIn.name,
      description: builtIn.description,
      mode: builtIn.mode,
      scope: builtIn.scope,
      fingerprint: builtIn.fingerprint,
      editable: false,
      deletable: false,
      baseRevision: null,
      archived: false,
      createdAt: builtIn.createdAt,
      updatedAt: builtIn.updatedAt,
    },
    ...customProfiles,
  ];
}

export async function getPromptProfile(
  userId: string,
  profileId: string,
): Promise<PromptProfileDetailDto | null> {
  const bundledScope = builtinProfileScope(profileId);
  if (bundledScope) {
    const preferences = await getPreferencesByUserId(userId);
    return loadBuiltinProfile(
      bundledScope,
      preferences.defaultInstructionProfileId,
    );
  }

  const supabase = getServiceRoleSupabaseClient();
  // Intentionally do not filter on `archived`. Existing conversations can be
  // pinned to an archived profile and must keep resolving that exact snapshot.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('prompt_profiles') as any)
    .select('*')
    .eq('id', profileId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load prompt profile: ${error.message}`);
  }
  if (!data) return null;
  return rowToDetail(data as PromptProfileRow);
}

export async function createPromptProfile(
  user: User,
  input: CreatePromptProfileInput,
): Promise<PromptProfileDetailDto> {
  const supabase = getServiceRoleSupabaseClient();
  const mode = input.mode ?? 'overlay';
  const scope = input.scope ?? 'parametric';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('prompt_profiles') as any)
    .insert({
      user_id: user.id,
      name: input.name,
      description: input.description ?? null,
      prompt_template: input.promptTemplate,
      mode,
      scope,
      base_revision: input.baseRevision ?? null,
      archived: false,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create prompt profile: ${error.message}`);
  }
  return rowToDetail(data as PromptProfileRow);
}

export async function updatePromptProfile(
  userId: string,
  profileId: string,
  input: UpdatePromptProfileInput,
): Promise<PromptProfileDetailDto> {
  const bundledScope = builtinProfileScope(profileId);
  if (bundledScope === 'parametric') {
    // Preserve the established B8 error contract.
    throw new Error('Cannot update the built-in prompt profile');
  }
  if (bundledScope) {
    throw new Error('Cannot update a bundled prompt template');
  }

  const supabase = getServiceRoleSupabaseClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase.from('prompt_profiles') as any)
    .select('id, mode')
    .eq('id', profileId)
    .eq('user_id', userId)
    .single();

  if (!existing) throw new Error('Prompt profile not found');
  const existingMode = parsePromptProfileMode(existing.mode);
  if (existingMode === 'fork' && input.mode) {
    throw new Error('Cannot change mode of a forked profile');
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) update.name = input.name;
  if (input.description !== undefined) update.description = input.description;
  if (input.promptTemplate !== undefined) {
    update.prompt_template = input.promptTemplate;
  }
  if (input.mode !== undefined) update.mode = input.mode;
  if (input.baseRevision !== undefined)
    update.base_revision = input.baseRevision;

  // Ownership was established by the lookup above. Keep the write chain in
  // the legacy shape so existing Supabase test doubles remain valid.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('prompt_profiles') as any)
    .update(update)
    .eq('id', profileId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update prompt profile: ${error.message}`);
  }
  return rowToDetail(data as PromptProfileRow);
}

export async function archivePromptProfile(
  userId: string,
  profileId: string,
): Promise<void> {
  if (builtinProfileScope(profileId)) {
    throw new Error('Cannot archive a bundled prompt template');
  }

  await assertPromptProfileIsNotActive(userId, profileId);

  const supabase = getServiceRoleSupabaseClient();
  const { error } = await supabase
    .from('prompt_profiles')
    .update({ archived: true, updated_at: new Date().toISOString() })
    .eq('id', profileId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to archive prompt profile: ${error.message}`);
  }
}

/**
 * Compatibility alias for older call sites. User-visible removal is archival,
 * not a hard delete, so historical conversations pinned to this profile keep
 * resolving the exact prompt they originally used.
 */
export async function deletePromptProfile(
  userId: string,
  profileId: string,
): Promise<void> {
  return archivePromptProfile(userId, profileId);
}

export async function resolveInstructionProfile({
  userId,
  profileId,
  scope,
  instructionProfileId,
}: {
  userId: string;
  profileId: string | null | undefined;
  scope: PromptProfileScope;
  instructionProfileId?: AiInstructionProfileId;
}): Promise<string> {
  const expectedBuiltinId = builtinProfileId(scope);

  if (profileId && profileId !== expectedBuiltinId) {
    const otherBundledScope = builtinProfileScope(profileId);
    if (otherBundledScope) {
      throw new Error(
        `Prompt template ${profileId} belongs to ${otherBundledScope}, not ${scope}.`,
      );
    }
  }

  // The active chat runtime always supplies the conversation-pinned package ID.
  // Direct callers that omit it keep the bundled Brepia Core package without
  // consulting user preferences. New conversations pass their pinned package.
  const selectedInstructionProfileId =
    instructionProfileId ?? DEFAULT_ORIGINAL_INSTRUCTION_PROFILE_ID;
  const basePrompt = bundledPrompt(scope, selectedInstructionProfileId);

  if (!profileId || profileId === expectedBuiltinId) return basePrompt;

  const profile = await getPromptProfile(userId, profileId);
  if (!profile) {
    throw new Error(
      `Prompt profile ${profileId} not found for user ${userId}. This configuration may be stale.`,
    );
  }
  if (profile.scope !== scope) {
    throw new Error(
      `Prompt profile ${profileId} is ${profile.scope}, not ${scope}.`,
    );
  }

  if (profile.mode === 'overlay') {
    return `${basePrompt}\n\n--- User Custom Instructions ---\n\n${profile.promptTemplate}`;
  }
  return profile.promptTemplate;
}

export async function resolveConversationSystemPrompt({
  userId,
  profileId,
  scope = 'parametric',
  instructionProfileId,
}: {
  userId: string;
  profileId: string | null | undefined;
  scope?: PromptProfileScope;
  instructionProfileId?: AiInstructionProfileId;
}): Promise<string> {
  return resolveInstructionProfile({
    userId,
    profileId,
    scope,
    instructionProfileId,
  });
}
