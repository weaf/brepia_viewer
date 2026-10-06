import { z } from 'zod';

const runtimeModelIdSchema = z.string().trim().min(1).max(512);
const nullableRuntimeModelIdSchema = z.union([runtimeModelIdSchema, z.null()]);
const localCreativeProfileIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9._:-]+$/);
const nullableLocalCreativeProfileIdSchema = z.union([
  localCreativeProfileIdSchema,
  z.null(),
]);

export const LOCAL_CREATIVE_PROFILE_DEFAULTS = {
  resolution: '1024' as const,
  imageGenerationTimeoutMs: 600_000,
  meshGenerationTimeoutMs: 1_800_000,
};

const localCreativeTimeoutMsSchema = z
  .number()
  .int()
  .min(60_000)
  .max(14_400_000);

export const LocalCreativeResolutionSchema = z.enum(['512', '1024', '1536']);
export type LocalCreativeResolution = z.infer<
  typeof LocalCreativeResolutionSchema
>;

export const LocalCreativeAdapterSchema = z.enum(['native-image-mesh-v1']);
export type LocalCreativeAdapter = z.infer<typeof LocalCreativeAdapterSchema>;

export const LocalCreativeProfileSchema = z.object({
  id: localCreativeProfileIdSchema,
  name: z.string().trim().min(1).max(100),
  adapter: LocalCreativeAdapterSchema.default('native-image-mesh-v1'),
  imageModelId: nullableRuntimeModelIdSchema.default(null),
  meshModelId: nullableRuntimeModelIdSchema.default(null),
  resolution: LocalCreativeResolutionSchema.default(
    LOCAL_CREATIVE_PROFILE_DEFAULTS.resolution,
  ),
  imageGenerationTimeoutMs: localCreativeTimeoutMsSchema.default(
    LOCAL_CREATIVE_PROFILE_DEFAULTS.imageGenerationTimeoutMs,
  ),
  meshGenerationTimeoutMs: localCreativeTimeoutMsSchema.default(
    LOCAL_CREATIVE_PROFILE_DEFAULTS.meshGenerationTimeoutMs,
  ),
  enabled: z.boolean().default(true),
});
export type LocalCreativeProfile = z.infer<typeof LocalCreativeProfileSchema>;

const LocalCreativeProfilesSchema = z
  .array(LocalCreativeProfileSchema)
  .max(32)
  .refine(
    (profiles) =>
      new Set(profiles.map((profile) => profile.id)).size === profiles.length,
    'Local Creative profile IDs must be unique',
  );

export const CreativeImageProviderSchema = z.enum(['openai', 'fal']);
export type CreativeImageProvider = z.infer<typeof CreativeImageProviderSchema>;
const nullableCreativeImageProviderSchema = z.union([
  CreativeImageProviderSchema,
  z.null(),
]);

export const CreativeRuntimeModelRoutingSchema = z.object({
  localCreativeProfiles: LocalCreativeProfilesSchema.default([]),
  defaultLocalCreativeProfileId:
    nullableLocalCreativeProfileIdSchema.default(null),
  creativeImagePrimaryProvider:
    nullableCreativeImageProviderSchema.default(null),
  creativeImageFallbackProvider:
    nullableCreativeImageProviderSchema.default(null),
  openAiOrchestratorModelId: nullableRuntimeModelIdSchema.default(null),
  openAiImageModelId: nullableRuntimeModelIdSchema.default(null),
  falImageTextModelId: nullableRuntimeModelIdSchema.default(null),
  falImageReferenceModelId: nullableRuntimeModelIdSchema.default(null),
  /**
   * Compatibility materialization for the currently active local profile.
   * Runtime code still reads these fields while profile-aware conversation
   * pinning is introduced. They remain explicit user settings, never hidden
   * concrete defaults.
   */
  nativeImageModelId: nullableRuntimeModelIdSchema.default(null),
  nativeMeshModelId: nullableRuntimeModelIdSchema.default(null),
  falUltraMeshModelId: nullableRuntimeModelIdSchema.default(null),
  falCaptionModelId: nullableRuntimeModelIdSchema.default(null),
  falSegmentationModelId: nullableRuntimeModelIdSchema.default(null),
  falQualityMeshModelId: nullableRuntimeModelIdSchema.default(null),
  falFastMeshModelId: nullableRuntimeModelIdSchema.default(null),
  falPreviewMeshModelId: nullableRuntimeModelIdSchema.default(null),
});

export type CreativeRuntimeModelRouting = z.infer<
  typeof CreativeRuntimeModelRoutingSchema
>;

export const UpdateCreativeRuntimeModelRoutingSchema =
  CreativeRuntimeModelRoutingSchema.partial();

export const EMPTY_CREATIVE_RUNTIME_MODEL_ROUTING: CreativeRuntimeModelRouting =
  CreativeRuntimeModelRoutingSchema.parse({});

export type CreativeRuntimeModelKey = Exclude<
  keyof CreativeRuntimeModelRouting,
  | 'localCreativeProfiles'
  | 'defaultLocalCreativeProfileId'
  | 'creativeImagePrimaryProvider'
  | 'creativeImageFallbackProvider'
>;

export function getUsableLocalCreativeProfiles(
  routing: CreativeRuntimeModelRouting,
): LocalCreativeProfile[] {
  return routing.localCreativeProfiles.filter(
    (profile) =>
      profile.enabled &&
      typeof profile.meshModelId === 'string' &&
      profile.meshModelId.trim().length > 0,
  );
}

export function getDefaultLocalCreativeProfile(
  routing: CreativeRuntimeModelRouting,
): LocalCreativeProfile | null {
  if (!routing.defaultLocalCreativeProfileId) return null;
  return (
    getUsableLocalCreativeProfiles(routing).find(
      (profile) => profile.id === routing.defaultLocalCreativeProfileId,
    ) ?? null
  );
}

export function requireCreativeRuntimeModel(
  routing: CreativeRuntimeModelRouting,
  key: CreativeRuntimeModelKey,
): string {
  const value = routing[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(
      `Creative runtime model ${key} is not configured. Select it in AI Settings > Creative models.`,
    );
  }
  return value.trim();
}
