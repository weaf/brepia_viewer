import type { AiPreferencesDto } from '@shared/aiSettings';
import {
  loadBundledInstruction,
  renderInstructionTemplate,
  type AiInstructionKey,
  type AiInstructionProfileId,
  type AiRuntimeLimitKey,
} from '@shared/aiInstructionCatalog';
import {
  resolveRuntimeValue,
  type RuntimeOverrides,
} from '@shared/aiInstructionSettings';
import { getPreferencesByUserId } from './aiSettings';
import { resolveInstructionProfile } from './promptProfiles';
import { getServiceRoleSupabaseClient } from './supabaseClient';

type InstructionValues = Record<
  string,
  string | number | boolean | null | undefined
>;

type SnapshotProfileRow = {
  id: string;
  mode: string;
  prompt_template: string;
  scope: string;
};

type InstructionProfileSnapshot = Map<string, SnapshotProfileRow>;

export function parametricCadSpecializationKey(
  key: AiInstructionKey,
): AiInstructionKey | undefined {
  if (key === 'tool.build_parametric_model') return 'parametric.openscad';
  if (key === 'tool.build_brep_project') return 'parametric.brep';
  return undefined;
}

export function composeParametricCadToolInstruction(
  toolInstruction: string,
  cadSpecialization: string,
): string {
  const tool = toolInstruction.trim();
  const specialization = cadSpecialization.trim();
  if (!specialization) return tool;
  return `${specialization}\n\n## Tool contract\n\n${tool}`;
}

function configuredProfileId(
  preferences: AiPreferencesDto,
  key: AiInstructionKey,
): string | null {
  if (key === 'parametric') return preferences.defaultPromptProfileId;
  if (key === 'creative') return preferences.defaultCreativePromptProfileId;
  return preferences.instructionProfileDefaults[key] ?? null;
}

function configuredCustomProfileIds(preferences: AiPreferencesDto): string[] {
  return [
    preferences.defaultPromptProfileId,
    preferences.defaultCreativePromptProfileId,
    ...Object.values(preferences.instructionProfileDefaults),
  ].flatMap((profileId) =>
    profileId && !profileId.startsWith('builtin:') ? [profileId] : [],
  );
}

async function loadInstructionProfileSnapshot(
  userId: string,
  preferences: AiPreferencesDto,
): Promise<InstructionProfileSnapshot> {
  const profileIds = [...new Set(configuredCustomProfileIds(preferences))];
  if (profileIds.length === 0) return new Map();

  const supabase = getServiceRoleSupabaseClient();
  // Generalized instruction scopes are introduced by a post-merge migration.
  // Keep this cast local until generated Supabase types are refreshed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('prompt_profiles') as any)
    .select('id, mode, prompt_template, scope')
    .eq('user_id', userId)
    .eq('archived', false)
    .in('id', profileIds);

  if (error) {
    throw new Error(`Failed to load AI instruction profiles: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as SnapshotProfileRow[]).map((row) => [row.id, row]),
  );
}

function resolveInstructionTemplateFromSnapshot(
  userId: string,
  preferences: AiPreferencesDto,
  snapshot: InstructionProfileSnapshot,
  key: AiInstructionKey,
  instructionProfileId: AiInstructionProfileId,
): string {
  const bundled = loadBundledInstruction(key, instructionProfileId);
  const profileId = configuredProfileId(preferences, key);
  const expectedBundledId = `builtin:${key}`;

  if (!profileId || profileId === expectedBundledId) return bundled;
  if (profileId.startsWith('builtin:')) {
    throw new Error(
      `Prompt template ${profileId} does not belong to instruction ${key}.`,
    );
  }

  const profile = snapshot.get(profileId);
  if (!profile) {
    throw new Error(
      `Prompt profile ${profileId} not found for user ${userId}. This configuration may be stale.`,
    );
  }
  if (profile.scope !== key) {
    throw new Error(
      `Prompt profile ${profileId} is ${profile.scope}, not ${key}.`,
    );
  }
  if (profile.mode === 'overlay') {
    return `${bundled}\n\n--- User Custom Instructions ---\n\n${profile.prompt_template}`;
  }
  if (profile.mode === 'fork') return profile.prompt_template;

  throw new Error(`Invalid prompt profile mode: ${profile.mode}`);
}

export async function loadUserAiPreferences(
  userId: string,
): Promise<AiPreferencesDto> {
  return getPreferencesByUserId(userId);
}

export async function resolveInstructionTemplateFromPreferences(
  userId: string,
  preferences: AiPreferencesDto,
  key: AiInstructionKey,
  instructionProfileId: AiInstructionProfileId = preferences.defaultInstructionProfileId,
): Promise<string> {
  return resolveInstructionProfile({
    userId,
    scope: key,
    profileId: configuredProfileId(preferences, key),
    instructionProfileId,
  });
}

export async function resolveInstructionFromPreferences(
  userId: string,
  preferences: AiPreferencesDto,
  key: AiInstructionKey,
  values: InstructionValues = {},
  instructionProfileId: AiInstructionProfileId = preferences.defaultInstructionProfileId,
): Promise<string> {
  const template = await resolveInstructionTemplateFromPreferences(
    userId,
    preferences,
    key,
    instructionProfileId,
  );
  return renderInstructionTemplate(template, values);
}

export function resolveRuntimeFromPreferences(
  preferences: Pick<AiPreferencesDto, 'runtimeOverrides'>,
  key: AiRuntimeLimitKey,
): number | string {
  return resolveRuntimeValue(
    preferences.runtimeOverrides as RuntimeOverrides,
    key,
  );
}

export function resolveRuntimeNumberFromPreferences(
  preferences: Pick<AiPreferencesDto, 'runtimeOverrides'>,
  key: AiRuntimeLimitKey,
): number {
  const value = resolveRuntimeFromPreferences(preferences, key);
  if (typeof value !== 'number') {
    throw new Error(`AI runtime setting ${key} is not numeric`);
  }
  return value;
}

export function resolveRuntimeStringFromPreferences(
  preferences: Pick<AiPreferencesDto, 'runtimeOverrides'>,
  key: AiRuntimeLimitKey,
): string {
  const value = resolveRuntimeFromPreferences(preferences, key);
  if (typeof value !== 'string') {
    throw new Error(`AI runtime setting ${key} is not a string`);
  }
  return value;
}

export type UserAiRuntimeContext = {
  preferences: AiPreferencesDto;
  instructionProfileId: AiInstructionProfileId;
  template: (key: AiInstructionKey) => Promise<string>;
  instruction: (
    key: AiInstructionKey,
    values?: InstructionValues,
  ) => Promise<string>;
  number: (key: AiRuntimeLimitKey) => number;
  string: (key: AiRuntimeLimitKey) => string;
};

export async function createUserAiRuntimeContext(
  userId: string,
  instructionProfileId?: AiInstructionProfileId,
): Promise<UserAiRuntimeContext> {
  const preferences = await loadUserAiPreferences(userId);
  const selectedInstructionProfileId =
    instructionProfileId ?? preferences.defaultInstructionProfileId;
  const snapshot = await loadInstructionProfileSnapshot(userId, preferences);

  const template = async (key: AiInstructionKey): Promise<string> =>
    resolveInstructionTemplateFromSnapshot(
      userId,
      preferences,
      snapshot,
      key,
      selectedInstructionProfileId,
    );

  const instruction = async (
    key: AiInstructionKey,
    values: InstructionValues = {},
  ): Promise<string> => {
    const rendered = renderInstructionTemplate(await template(key), values);
    const specializationKey = parametricCadSpecializationKey(key);
    if (!specializationKey) return rendered;

    const specialization = renderInstructionTemplate(
      await template(specializationKey),
      values,
    );
    return composeParametricCadToolInstruction(rendered, specialization);
  };

  return {
    preferences,
    instructionProfileId: selectedInstructionProfileId,
    template,
    instruction,
    number: (key) => resolveRuntimeNumberFromPreferences(preferences, key),
    string: (key) => resolveRuntimeStringFromPreferences(preferences, key),
  };
}

export async function resolveUserInstruction(
  userId: string,
  key: AiInstructionKey,
  values: InstructionValues = {},
): Promise<string> {
  const runtime = await createUserAiRuntimeContext(userId);
  return runtime.instruction(key, values);
}

export async function resolveUserRuntimeValue(
  userId: string,
  key: AiRuntimeLimitKey,
): Promise<number | string> {
  const preferences = await loadUserAiPreferences(userId);
  return resolveRuntimeFromPreferences(preferences, key);
}

export async function resolveUserRuntimeNumber(
  userId: string,
  key: AiRuntimeLimitKey,
): Promise<number> {
  const preferences = await loadUserAiPreferences(userId);
  return resolveRuntimeNumberFromPreferences(preferences, key);
}

export async function resolveUserRuntimeString(
  userId: string,
  key: AiRuntimeLimitKey,
): Promise<string> {
  const preferences = await loadUserAiPreferences(userId);
  return resolveRuntimeStringFromPreferences(preferences, key);
}
