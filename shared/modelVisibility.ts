import { z } from 'zod';

export const MAX_MODEL_VISIBILITY_IDS = 16_384;

const modelIdListSchema = z
  .array(z.string().min(1).max(256))
  .min(0)
  .max(MAX_MODEL_VISIBILITY_IDS);

export interface ModelVisibilityEntry {
  id: string;
}

export interface ModelVisibilityPreferences {
  hiddenModelIds: Iterable<string>;
  enabledOpenCodeModelIds: Iterable<string>;
}

export const UpdateModelVisibilitySchema = z.object({
  hiddenModelIds: modelIdListSchema.optional(),
  enabledOpenCodeModelIds: modelIdListSchema.optional(),
});

export type UpdateModelVisibilityInput = z.infer<
  typeof UpdateModelVisibilitySchema
>;

export function isDiscoveredOpenCodeModelId(modelId: string): boolean {
  return modelId.startsWith('agent/opencode/');
}

export function isModelVisibleByPreference(
  entry: ModelVisibilityEntry,
  preferences: ModelVisibilityPreferences,
): boolean {
  const hidden = new Set(preferences.hiddenModelIds);
  const enabledOpenCode = new Set(preferences.enabledOpenCodeModelIds);

  if (isDiscoveredOpenCodeModelId(entry.id)) {
    return enabledOpenCode.has(entry.id);
  }

  return !hidden.has(entry.id);
}
