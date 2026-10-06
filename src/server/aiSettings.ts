// P02B: Server-side user_ai_preferences helpers.
//
// The service layer treats a missing row as defaults rather than requiring
// a row-per-user, so `getPreferences` always returns a valid object.

import type { User } from '@supabase/supabase-js';
import { getServiceRoleSupabaseClient } from './supabaseClient';
import type { AiPreferencesDto } from '@shared/aiSettings';
import { CreativeRuntimeModelRoutingSchema } from '@shared/modelRouting';
import {
  AiInstructionProfileIdSchema,
  DEFAULT_INSTRUCTION_PROFILE_ID,
  InstructionProfileDefaultsSchema,
  RuntimeOverridesSchema,
} from '@shared/aiInstructionSettings';

const DEFAULT_PREFERENCES: Omit<AiPreferencesDto, 'userId'> = {
  hiddenModelIds: [],
  enabledOpenCodeModelIds: [],
  defaultInstructionProfileId: DEFAULT_INSTRUCTION_PROFILE_ID,
  defaultPromptProfileId: null,
  defaultCreativePromptProfileId: null,
  instructionProfileDefaults: {},
  runtimeOverrides: {},
  defaultParametricModelId: null,
  defaultCreativeModelId: null,
  visionFastModelId: null,
  visionDeepModelId: null,
  modelRouting: CreativeRuntimeModelRoutingSchema.parse({}),
};

type PreferenceRow = {
  user_id: string;
  hidden_model_ids: string[];
  enabled_opencode_model_ids?: string[] | null;
  default_instruction_profile_id?: string | null;
  default_prompt_profile_id: string | null;
  default_creative_prompt_profile_id?: string | null;
  instruction_profile_defaults?: unknown;
  runtime_overrides?: unknown;
  default_parametric_model_id?: string | null;
  default_creative_model_id?: string | null;
  vision_fast_model_id?: string | null;
  vision_deep_model_id?: string | null;
  model_routing?: unknown;
  created_at: string;
  updated_at: string;
};

function parseInstructionProfileId(value: unknown) {
  const parsed = AiInstructionProfileIdSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_INSTRUCTION_PROFILE_ID;
}

function parseInstructionProfileDefaults(value: unknown) {
  const parsed = InstructionProfileDefaultsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function parseRuntimeOverrides(value: unknown) {
  const parsed = RuntimeOverridesSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function parseModelRouting(value: unknown) {
  const parsed = CreativeRuntimeModelRoutingSchema.safeParse(value ?? {});
  return parsed.success
    ? parsed.data
    : CreativeRuntimeModelRoutingSchema.parse({});
}

function toDto(row: PreferenceRow): AiPreferencesDto {
  return {
    userId: row.user_id,
    hiddenModelIds: row.hidden_model_ids,
    enabledOpenCodeModelIds: row.enabled_opencode_model_ids ?? [],
    defaultInstructionProfileId: parseInstructionProfileId(
      row.default_instruction_profile_id,
    ),
    defaultPromptProfileId: row.default_prompt_profile_id,
    defaultCreativePromptProfileId:
      row.default_creative_prompt_profile_id ?? null,
    instructionProfileDefaults: parseInstructionProfileDefaults(
      row.instruction_profile_defaults,
    ),
    runtimeOverrides: parseRuntimeOverrides(row.runtime_overrides),
    defaultParametricModelId: row.default_parametric_model_id ?? null,
    defaultCreativeModelId: row.default_creative_model_id ?? null,
    visionFastModelId: row.vision_fast_model_id ?? null,
    visionDeepModelId: row.vision_deep_model_id ?? null,
    modelRouting: parseModelRouting(row.model_routing),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadPreferences(userId: string): Promise<AiPreferencesDto> {
  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from('user_ai_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load preferences: ${error.message}`);
  }

  if (data) return toDto(data as PreferenceRow);

  const { data: inserted, error: insertErr } = await supabase
    .from('user_ai_preferences')
    .insert({ user_id: userId })
    .select()
    .single();

  if (insertErr) {
    const { data: retry } = await supabase
      .from('user_ai_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (retry) return toDto(retry as PreferenceRow);
    return { userId, ...DEFAULT_PREFERENCES };
  }

  return toDto(inserted as PreferenceRow);
}

export async function getPreferences(user: User): Promise<AiPreferencesDto> {
  return loadPreferences(user.id);
}

export async function getPreferencesByUserId(
  userId: string,
): Promise<AiPreferencesDto> {
  return loadPreferences(userId);
}

export async function updateHiddenModelIds(
  user: User,
  hiddenModelIds: string[],
): Promise<AiPreferencesDto> {
  const supabase = getServiceRoleSupabaseClient();
  await ensureRowExists(supabase, user.id);

  const { data, error } = await supabase
    .from('user_ai_preferences')
    .update({
      hidden_model_ids: hiddenModelIds,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update hidden model IDs: ${error.message}`);
  }

  return toDto(data as PreferenceRow);
}

export async function setDefaultPromptProfileId(
  user: User,
  defaultPromptProfileId: string | null,
): Promise<AiPreferencesDto> {
  const supabase = getServiceRoleSupabaseClient();
  await ensureRowExists(supabase, user.id);

  const { data, error } = await supabase
    .from('user_ai_preferences')
    .update({
      default_prompt_profile_id: defaultPromptProfileId,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to set default prompt profile: ${error.message}`);
  }

  return toDto(data as PreferenceRow);
}

async function ensureRowExists(
  supabase: ReturnType<typeof getServiceRoleSupabaseClient>,
  userId: string,
): Promise<void> {
  await supabase
    .from('user_ai_preferences')
    .upsert(
      { user_id: userId },
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
}
