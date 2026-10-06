export const NATIVE_CREATIVE_MESH_MODEL_ID = 'local/native' as const;

/**
 * Old local backend IDs are intentionally no longer selectable. They are kept
 * only as read-compatibility aliases for conversations created before the
 * native Creative backend was decoupled from a concrete upstream model.
 */
export const LEGACY_LOCAL_CREATIVE_MESH_MODEL_IDS = [
  'local/trellis2',
  'local/trellis-v1',
  'local/hunyuan3d-2',
  'local/hunyuan3d-2.1',
] as const;

export const FAL_CREATIVE_MESH_MODEL_IDS = [
  'ultra',
  'quality',
  'fast',
] as const;

/**
 * Compile-time Creative product modes. Concrete upstream model IDs are not
 * stored here; they are selected in AI Settings > Model routing.
 */
export const CREATIVE_MESH_MODEL_IDS = [
  NATIVE_CREATIVE_MESH_MODEL_ID,
  ...FAL_CREATIVE_MESH_MODEL_IDS,
] as const;

export type CreativeMeshModelId = (typeof CREATIVE_MESH_MODEL_IDS)[number];
export type LegacyLocalCreativeMeshModelId =
  (typeof LEGACY_LOCAL_CREATIVE_MESH_MODEL_IDS)[number];
export type CreativeMeshProvider = 'local' | 'fal';
export type CreativeMeshInputCapability =
  | 'Text + image'
  | 'Image required'
  | 'Text only'
  | 'Image only'
  | 'Unsupported';

export type CreativeMeshModelDefinition = {
  id: CreativeMeshModelId;
  name: string;
  description: string;
  provider: CreativeMeshProvider;
  providerLabel: string;
  supportsText: boolean;
  supportsImage: boolean;
  supportsMeshEdit: boolean;
  outputFormats: readonly ('glb' | 'fbx')[];
  timeEstimate?: string;
  requiresReferenceImage?: boolean;
  maxReferenceImages?: number;
};

export type CreativeMeshProviderDefinition = {
  id: CreativeMeshProvider;
  label: string;
  optional: boolean;
  modelIds: readonly CreativeMeshModelId[];
};

/** Built-in local Creative product mode; upstream models come from Settings. */
export const CORE_CREATIVE_MESH_MODELS: readonly CreativeMeshModelDefinition[] =
  [
    {
      id: NATIVE_CREATIVE_MESH_MODEL_ID,
      name: 'Local Creative',
      description:
        'Local configurable image-to-mesh runtime; concrete image and mesh models are selected in AI Settings',
      provider: 'local',
      providerLabel: 'Local',
      supportsText: true,
      supportsImage: true,
      supportsMeshEdit: false,
      outputFormats: ['glb'],
      maxReferenceImages: 1,
    },
  ] as const;

/**
 * Product modes supplied by the optional hosted Creative adapter. The product
 * mode IDs are stable contracts; the concrete provider model for each mode is
 * selected in AI Settings > Model routing.
 */
export const OPTIONAL_CREATIVE_MESH_MODELS: readonly CreativeMeshModelDefinition[] =
  [
    {
      id: 'ultra',
      name: 'Max Quality',
      description: 'Hosted high-quality textured generation',
      provider: 'fal',
      providerLabel: 'fal.ai',
      supportsText: true,
      supportsImage: true,
      supportsMeshEdit: true,
      outputFormats: ['glb', 'fbx'],
      timeEstimate: '5-6 minutes',
      maxReferenceImages: 1,
    },
    {
      id: 'quality',
      name: 'Draft',
      description: 'Hosted draft generation',
      provider: 'fal',
      providerLabel: 'fal.ai',
      supportsText: true,
      supportsImage: true,
      supportsMeshEdit: true,
      outputFormats: ['glb'],
      timeEstimate: '~45 seconds',
      maxReferenceImages: 1,
    },
    {
      id: 'fast',
      name: 'Textureless',
      description: 'Hosted fast textureless generation',
      provider: 'fal',
      providerLabel: 'fal.ai',
      supportsText: true,
      supportsImage: true,
      supportsMeshEdit: true,
      outputFormats: ['glb'],
      timeEstimate: '60-90 seconds',
      maxReferenceImages: 1,
    },
  ] as const;

/** All known Creative product-mode definitions. */
export const CREATIVE_MESH_MODELS: readonly CreativeMeshModelDefinition[] = [
  ...CORE_CREATIVE_MESH_MODELS,
  ...OPTIONAL_CREATIVE_MESH_MODELS,
] as const;

export const CREATIVE_MESH_PROVIDERS: readonly CreativeMeshProviderDefinition[] =
  [
    {
      id: 'local',
      label: 'Local',
      optional: false,
      modelIds: [NATIVE_CREATIVE_MESH_MODEL_ID],
    },
    {
      id: 'fal',
      label: 'fal.ai',
      optional: true,
      modelIds: FAL_CREATIVE_MESH_MODEL_IDS,
    },
  ] as const;

const CREATIVE_MESH_MODEL_BY_ID = new Map(
  CREATIVE_MESH_MODELS.map((definition) => [definition.id, definition]),
);

const LEGACY_LOCAL_MODEL_IDS = new Set<string>(
  LEGACY_LOCAL_CREATIVE_MESH_MODEL_IDS,
);

export function isCreativeMeshModelId(
  value: unknown,
): value is CreativeMeshModelId {
  return (
    typeof value === 'string' &&
    CREATIVE_MESH_MODEL_BY_ID.has(value as CreativeMeshModelId)
  );
}

export function isLegacyLocalCreativeMeshModelId(
  value: unknown,
): value is LegacyLocalCreativeMeshModelId {
  return typeof value === 'string' && LEGACY_LOCAL_MODEL_IDS.has(value);
}

/**
 * Resolve persisted Creative product-mode IDs into the current catalog.
 * Retired local model-specific backend IDs migrate to the neutral native mode.
 */
export function normalizeCreativeMeshModelId(
  value: unknown,
): CreativeMeshModelId | undefined {
  if (isCreativeMeshModelId(value)) return value;
  if (isLegacyLocalCreativeMeshModelId(value)) {
    return NATIVE_CREATIVE_MESH_MODEL_ID;
  }
  return undefined;
}

export function getCreativeMeshModelDefinition(
  id: string,
): CreativeMeshModelDefinition | undefined {
  return CREATIVE_MESH_MODEL_BY_ID.get(id as CreativeMeshModelId);
}

export function getCreativeMeshInputCapability(
  id: string,
): CreativeMeshInputCapability | undefined {
  const definition = getCreativeMeshModelDefinition(id);
  if (!definition) return undefined;
  if (definition.requiresReferenceImage) return 'Image required';
  if (definition.supportsText && definition.supportsImage)
    return 'Text + image';
  if (definition.supportsText) return 'Text only';
  if (definition.supportsImage) return 'Image only';
  return 'Unsupported';
}

export function isLocalCreativeMeshModel(
  id: string,
): id is typeof NATIVE_CREATIVE_MESH_MODEL_ID {
  return id === NATIVE_CREATIVE_MESH_MODEL_ID;
}

export function isNativeCreativeMeshModel(
  id: string,
): id is typeof NATIVE_CREATIVE_MESH_MODEL_ID {
  return id === NATIVE_CREATIVE_MESH_MODEL_ID;
}

export function isFalCreativeMeshModel(
  id: string,
): id is (typeof FAL_CREATIVE_MESH_MODEL_IDS)[number] {
  return FAL_CREATIVE_MESH_MODEL_IDS.includes(
    id as (typeof FAL_CREATIVE_MESH_MODEL_IDS)[number],
  );
}
