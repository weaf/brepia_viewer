// P02A: Shared DTOs and validation schemas for AI settings.
//
// All schemas are Zod-compatible so they can be reused for server-side
// request validation and client-side (React Query) response parsing.
// Provider DTOs NEVER contain decrypted secrets — only a `hasCredential`
// boolean.

import { z } from 'zod';
import {
  CreativeRuntimeModelRoutingSchema,
  UpdateCreativeRuntimeModelRoutingSchema,
} from './modelRouting.ts';
import {
  AiInstructionKeySchema,
  AiInstructionProfileIdSchema,
  DEFAULT_INSTRUCTION_PROFILE_ID,
  InstructionProfileDefaultsSchema,
  RuntimeOverridesSchema,
} from './aiInstructionSettings.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_NAME_LENGTH = 100;
const MAX_CONTENT_LENGTH = 128 * 1024; // 128 KiB
const MAX_DESCRIPTION_LENGTH = 500;

const modelIdSchema = z
  .string()
  .min(1, 'model_id is required')
  .max(256)
  .refine((s) => /^[a-zA-Z0-9._\-/:@^${}|+]+$/.test(s), {
    message: 'model_id may only contain safe characters',
  });

const nullableModelIdSchema = z.union([modelIdSchema, z.null()]);

const nonReservedSlugSchema = z
  .string()
  .min(1, 'slug is required')
  .max(64)
  .refine((slug) => {
    const reserved = [
      'anthropic',
      'google',
      'openai',
      'openrouter',
      'local',
      'opencode',
      'agent',
    ];
    const lower = slug.toLowerCase();
    return !reserved.some((r) => lower === r || lower.startsWith(`${r}-`));
  }, 'slug cannot impersonate a reserved built-in prefix');

// ---------------------------------------------------------------------------
// user_ai_preferences
// ---------------------------------------------------------------------------

export const AiPreferencesSchema = z.object({
  userId: z.string().uuid(),
  hiddenModelIds: z.array(z.string().min(1).max(256)).default([]),
  enabledOpenCodeModelIds: z.array(z.string().min(1).max(256)).default([]),
  defaultInstructionProfileId: AiInstructionProfileIdSchema.default(
    DEFAULT_INSTRUCTION_PROFILE_ID,
  ),
  defaultPromptProfileId: z.union([z.string().uuid(), z.null()]).default(null),
  defaultCreativePromptProfileId: z
    .union([z.string().uuid(), z.null()])
    .default(null),
  instructionProfileDefaults: InstructionProfileDefaultsSchema.default({}),
  runtimeOverrides: RuntimeOverridesSchema.default({}),
  defaultParametricModelId: nullableModelIdSchema.default(null),
  defaultCreativeModelId: nullableModelIdSchema.default(null),
  visionFastModelId: nullableModelIdSchema.default(null),
  visionDeepModelId: nullableModelIdSchema.default(null),
  modelRouting: CreativeRuntimeModelRoutingSchema.default({}),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type AiPreferencesDto = z.infer<typeof AiPreferencesSchema>;

// ---------------------------------------------------------------------------
// prompt_profiles
// ---------------------------------------------------------------------------

export const PromptProfileScopeSchema = AiInstructionKeySchema;
export type PromptProfileScope = z.infer<typeof PromptProfileScopeSchema>;

export const CreatePromptProfileSchema = z.object({
  name: z.string().min(1, 'name is required').max(MAX_NAME_LENGTH),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
  promptTemplate: z
    .string()
    .min(1, 'promptTemplate is required')
    .max(MAX_CONTENT_LENGTH),
  mode: z.enum(['overlay', 'fork']).optional(),
  scope: PromptProfileScopeSchema.optional(),
  baseRevision: z.string().max(64).nullable().optional(),
});

export const UpdatePromptProfileSchema = z.object({
  name: z.string().min(1, 'name is required').max(MAX_NAME_LENGTH).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
  promptTemplate: z
    .string()
    .min(1, 'promptTemplate is required')
    .max(MAX_CONTENT_LENGTH)
    .optional(),
  mode: z.enum(['overlay', 'fork']).optional(),
  baseRevision: z.string().max(64).nullable().optional(),
});

export const PromptProfileSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  promptTemplate: z.string(),
  mode: z.enum(['overlay', 'fork']),
  scope: PromptProfileScopeSchema,
  fingerprint: z.string().nullable(),
  editable: z.boolean(),
  deletable: z.boolean(),
  baseRevision: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PromptProfileDetailDto = z.infer<typeof PromptProfileSchema>;

export const PromptProfileSummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  mode: z.enum(['overlay', 'fork']),
  scope: PromptProfileScopeSchema,
  fingerprint: z.string().nullable(),
  editable: z.boolean(),
  deletable: z.boolean(),
  baseRevision: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PromptProfileSummaryDto = z.infer<
  typeof PromptProfileSummarySchema
>;

// ---------------------------------------------------------------------------
// ai_providers
// ---------------------------------------------------------------------------

export const ProviderDriverSchema = z.enum([
  'openai-compatible',
  'anthropic',
  'google',
  'openrouter',
]);

export const CreateProviderSchema = z.object({
  slug: nonReservedSlugSchema,
  name: z.string().min(1, 'name is required').max(128),
  driver: ProviderDriverSchema,
  baseUrl: z.string().url().nullable().optional(),
  credential: z.string().max(4096).nullable().optional(),
});

export const UpdateProviderSchema = z.object({
  name: z.string().min(1, 'name is required').max(128).optional(),
  driver: ProviderDriverSchema.optional(),
  baseUrl: z.string().url().nullable().optional(),
  credential: z.string().max(4096).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const ProviderSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  driver: ProviderDriverSchema,
  baseUrl: z.string().nullable(),
  hasCredential: z.boolean(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ProviderDetailDto = z.infer<typeof ProviderSchema>;

export const ProviderSummarySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  driver: ProviderDriverSchema,
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ProviderSummaryDto = z.infer<typeof ProviderSummarySchema>;

// ---------------------------------------------------------------------------
// ai_provider_models
// ---------------------------------------------------------------------------

export const ProviderModelSchema = z.object({
  id: z.string().uuid(),
  providerId: z.string().uuid(),
  userId: z.string().uuid(),
  modelId: modelIdSchema,
  displayName: z.string(),
  description: z.string().nullable().optional(),
  supportsTools: z.boolean(),
  supportsThinking: z.boolean(),
  supportsVision: z.boolean(),
  contextLimit: z.number().nullable().optional(),
  outputLimit: z.number().nullable().optional(),
  isVisible: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CreateProviderModelSchema = z.object({
  modelId: modelIdSchema,
  displayName: z.string().min(1, 'displayName is required').max(256),
  description: z.string().nullable().optional(),
  supportsTools: z.boolean().default(false),
  supportsThinking: z.boolean().default(false),
  supportsVision: z.boolean().default(false),
  contextLimit: z.number().nullable().optional(),
  outputLimit: z.number().nullable().optional(),
  isVisible: z.boolean().default(true),
});

export const UpdateProviderModelSchema = z.object({
  displayName: z.string().min(1, 'displayName is required').max(256).optional(),
  description: z.string().nullable().optional(),
  supportsTools: z.boolean().optional(),
  supportsThinking: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  contextLimit: z.number().nullable().optional(),
  outputLimit: z.number().nullable().optional(),
  isVisible: z.boolean().optional(),
});

export type ProviderModelDto = z.infer<typeof ProviderModelSchema>;

// ---------------------------------------------------------------------------
// model catalog (server-side read-only)
// ---------------------------------------------------------------------------

export const ModelCatalogEntrySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  provider: z.string(),
  isBuiltIn: z.boolean().default(false),
  supportsTools: z.boolean().default(false),
  supportsThinking: z.boolean().default(false),
  supportsVision: z.boolean().default(false),
  contextLimit: z.number().nullable().default(null),
  outputLimit: z.number().nullable().default(null),
});

export type ModelCatalogEntryDto = z.infer<typeof ModelCatalogEntrySchema>;

// ---------------------------------------------------------------------------
// Test provider response
// ---------------------------------------------------------------------------

export const TestProviderResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number(),
});

export type TestProviderResultDto = z.infer<typeof TestProviderResultSchema>;

// ---------------------------------------------------------------------------
// API request/response wrappers
// ---------------------------------------------------------------------------

export const UpdateHiddenModelsSchema = z.object({
  hiddenModelIds: z.array(z.string().min(1).max(256)).min(0).max(1024),
});

export const SetDefaultPromptSchema = z.object({
  defaultInstructionProfileId: AiInstructionProfileIdSchema.optional(),
  defaultPromptProfileId: z.union([z.string().uuid(), z.null()]).optional(),
  defaultCreativePromptProfileId: z
    .union([z.string().uuid(), z.null()])
    .optional(),
  instructionProfileDefaults: InstructionProfileDefaultsSchema.optional(),
  runtimeOverrides: RuntimeOverridesSchema.optional(),
});

export const UpdateDefaultModelsSchema = z.object({
  defaultParametricModelId: nullableModelIdSchema.optional(),
  defaultCreativeModelId: nullableModelIdSchema.optional(),
});

export const UpdateVisionModelsSchema = z.object({
  visionFastModelId: nullableModelIdSchema,
  visionDeepModelId: nullableModelIdSchema,
});

export const UpdateModelRoutingSchema = UpdateCreativeRuntimeModelRoutingSchema;

export const TestProviderRequestSchema = z.object({
  id: z.string().uuid().optional(),
  draftConfig: CreateProviderSchema.partial().optional(),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type CreateProviderInput = z.infer<typeof CreateProviderSchema>;
export type UpdateProviderInput = z.infer<typeof UpdateProviderSchema>;
export type CreatePromptProfileInput = z.infer<
  typeof CreatePromptProfileSchema
>;
export type UpdatePromptProfileInput = z.infer<
  typeof UpdatePromptProfileSchema
>;
export type CreateProviderModelInput = z.infer<
  typeof CreateProviderModelSchema
>;
export type UpdateProviderModelInput = z.infer<
  typeof UpdateProviderModelSchema
>;
export type UpdateHiddenModelsInput = z.infer<typeof UpdateHiddenModelsSchema>;
export type SetDefaultPromptInput = z.infer<typeof SetDefaultPromptSchema>;
export type UpdateDefaultModelsInput = z.infer<
  typeof UpdateDefaultModelsSchema
>;
export type UpdateVisionModelsInput = z.infer<typeof UpdateVisionModelsSchema>;
export type UpdateModelRoutingInput = z.infer<typeof UpdateModelRoutingSchema>;
