import {
  CREATIVE_MESH_MODELS,
  getCreativeMeshModelDefinition,
  normalizeCreativeMeshModelId,
} from '@shared/creativeMeshModels';
import type { Model } from '@shared/types';

export const UNCONFIGURED_MODEL_ID: Model = '__unconfigured__';

type ModelLike = { id: string };

const OPTIONAL_CREATIVE_PROVIDER_IDS = new Set(
  (import.meta.env.VITE_BREPIA_CREATIVE_MESH_PROVIDERS ?? '')
    .split(',')
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean),
);

function creativeModelEnabled(modelId: string): boolean {
  const definition = getCreativeMeshModelDefinition(modelId);
  if (!definition || definition.provider === 'local')
    return Boolean(definition);
  return (
    OPTIONAL_CREATIVE_PROVIDER_IDS.has('*') ||
    OPTIONAL_CREATIVE_PROVIDER_IDS.has('all') ||
    OPTIONAL_CREATIVE_PROVIDER_IDS.has(definition.provider.toLowerCase())
  );
}

export function resolveParametricDefaultModel(
  preferredModelId: string | null | undefined,
  selectableModels: ModelLike[],
): Model {
  const selectableIds = new Set(selectableModels.map((model) => model.id));
  if (preferredModelId && selectableIds.has(preferredModelId)) {
    return preferredModelId;
  }
  return selectableModels[0]?.id ?? UNCONFIGURED_MODEL_ID;
}

export function resolveCreativeDefaultModel(
  preferredModelId: string | null | undefined,
  selectableModels?: ModelLike[],
): Model {
  const normalized = normalizeCreativeMeshModelId(preferredModelId);

  if (selectableModels) {
    const selectableIds = new Set(selectableModels.map((model) => model.id));
    if (normalized && selectableIds.has(normalized)) return normalized;
    return selectableModels[0]?.id ?? UNCONFIGURED_MODEL_ID;
  }

  if (normalized && creativeModelEnabled(normalized)) return normalized;

  return (
    CREATIVE_MESH_MODELS.find((definition) =>
      creativeModelEnabled(definition.id),
    )?.id ?? UNCONFIGURED_MODEL_ID
  );
}
