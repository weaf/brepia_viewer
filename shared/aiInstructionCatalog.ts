import { z } from 'zod';
import manifestRaw from '../config/ai/instructions/manifest.json?raw';
import profilesRaw from '../config/ai/profiles/manifest.json?raw';
import runtimeRaw from '../config/ai/runtime.json?raw';

const instructionFiles = import.meta.glob<string>(
  '../config/ai/instructions/**/*.md',
  {
    eager: true,
    query: '?raw',
    import: 'default',
  },
);

const InstructionTemplatePathSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_./-]*\.md$/)
  .refine((value) => !value.split('/').includes('..'), 'invalid template path');

const InstructionDefinitionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9_.-]*$/),
  label: z.string().min(1),
  description: z.string(),
  category: z.enum([
    'agent',
    'tool',
    'vision',
    'conversation',
    'context',
    'transport',
    'provider',
  ]),
  template: InstructionTemplatePathSchema,
  supportsOverlay: z.boolean().default(true),
});

const ManifestSchema = z.object({
  version: z.number().int().positive(),
  instructions: z.array(InstructionDefinitionSchema).min(1),
});

const InstructionProfileLineageSchema = z.object({
  project: z.string().min(1),
  revision: z.string().min(1),
});

const InstructionProfileOriginSchema = z.object({
  profile: z.string().min(1),
  revision: z.string().min(1),
});

const InstructionRevisionSchema = z.record(
  z.string(),
  InstructionTemplatePathSchema,
);

const InstructionProfileDefinitionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().min(1),
  description: z.string(),
  managedBy: z.enum(['upstream', 'brepia']),
  extends: z.string().min(1).max(64).optional(),
  revision: z.string().min(1).max(128).optional(),
  lineage: InstructionProfileLineageSchema.optional(),
  origin: InstructionProfileOriginSchema.optional(),
  instructions: z.record(z.string(), InstructionTemplatePathSchema).default({}),
});

const InstructionProfilesManifestSchema = z.object({
  version: z.number().int().positive(),
  defaultProfile: z.string().min(1),
  revisions: z.record(z.string(), InstructionRevisionSchema).default({}),
  profiles: z.array(InstructionProfileDefinitionSchema).min(1),
});

const RuntimeSettingSchema = z
  .object({
    label: z.string().min(1),
    description: z.string(),
    type: z.enum(['integer', 'number', 'enum']),
    default: z.union([z.number(), z.string()]),
    min: z.number().optional(),
    max: z.number().optional(),
    options: z.array(z.string()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'enum') {
      if (
        typeof value.default !== 'string' ||
        !value.options?.includes(value.default)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'enum default must be present in options',
        });
      }
      return;
    }

    if (typeof value.default !== 'number' || !Number.isFinite(value.default)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'numeric runtime setting requires a finite numeric default',
      });
      return;
    }

    if (value.type === 'integer' && !Number.isInteger(value.default)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'integer runtime setting requires an integer default',
      });
    }
  });

const RuntimeConfigSchema = z.object({
  version: z.number().int().positive(),
  settings: z.record(z.string(), RuntimeSettingSchema),
});

const manifest = ManifestSchema.parse(JSON.parse(manifestRaw) as unknown);
const profilesManifest = InstructionProfilesManifestSchema.parse(
  JSON.parse(profilesRaw) as unknown,
);
const runtimeConfig = RuntimeConfigSchema.parse(
  JSON.parse(runtimeRaw) as unknown,
);

const instructionKeys = new Set(
  manifest.instructions.map((definition) => definition.key),
);
if (instructionKeys.size !== manifest.instructions.length) {
  throw new Error('AI instruction manifest contains duplicate keys');
}

const instructionProfileIds = new Set(
  profilesManifest.profiles.map((profile) => profile.id),
);
if (instructionProfileIds.size !== profilesManifest.profiles.length) {
  throw new Error('AI instruction profile manifest contains duplicate IDs');
}
if (!instructionProfileIds.has(profilesManifest.defaultProfile)) {
  throw new Error(
    `Unknown default AI instruction profile: ${profilesManifest.defaultProfile}`,
  );
}

// Conversations created before R1 may still carry the old persisted profile
// ID. Keep that storage alias at the resolver boundary without exposing it in
// the supported profile catalog or writing it to new conversations.
const legacyInstructionProfileAliases: Record<string, string> = {
  cadam: 'brepia-core',
};

function assertKnownInstructionMap(
  owner: string,
  instructions: Record<string, string>,
) {
  for (const [key, template] of Object.entries(instructions)) {
    if (!instructionKeys.has(key)) {
      throw new Error(`${owner} overrides unknown instruction key ${key}`);
    }
    const path = `../config/ai/instructions/${template}`;
    if (typeof instructionFiles[path] !== 'string') {
      throw new Error(`${owner} is missing template ${template}`);
    }
  }
}

for (const definition of manifest.instructions) {
  const path = `../config/ai/instructions/${definition.template}`;
  if (typeof instructionFiles[path] !== 'string') {
    throw new Error(
      `AI instruction template is missing for ${definition.key}: ${definition.template}`,
    );
  }
}

for (const [revisionId, revision] of Object.entries(
  profilesManifest.revisions,
)) {
  assertKnownInstructionMap(`AI instruction revision ${revisionId}`, revision);
}

for (const profile of profilesManifest.profiles) {
  if (profile.extends && !instructionProfileIds.has(profile.extends)) {
    throw new Error(
      `AI instruction profile ${profile.id} extends unknown profile ${profile.extends}`,
    );
  }
  if (profile.extends === profile.id) {
    throw new Error(
      `AI instruction profile ${profile.id} cannot extend itself`,
    );
  }
  if (profile.revision && !profilesManifest.revisions[profile.revision]) {
    throw new Error(
      `AI instruction profile ${profile.id} uses unknown revision ${profile.revision}`,
    );
  }
  assertKnownInstructionMap(
    `AI instruction profile ${profile.id}`,
    profile.instructions,
  );
}

export type AiInstructionKey = string;
export type AiInstructionProfileId = string;
export type AiInstructionCategory =
  | 'agent'
  | 'tool'
  | 'vision'
  | 'conversation'
  | 'context'
  | 'transport'
  | 'provider';

export type AiInstructionDefinition = z.infer<
  typeof InstructionDefinitionSchema
>;
export type AiInstructionProfileDefinition = z.infer<
  typeof InstructionProfileDefinitionSchema
>;

export const AI_INSTRUCTION_DEFINITIONS: readonly AiInstructionDefinition[] =
  manifest.instructions;
export const AI_INSTRUCTION_KEYS: readonly string[] = manifest.instructions.map(
  (definition) => definition.key,
);
export const AI_INSTRUCTION_PROFILE_DEFINITIONS: readonly AiInstructionProfileDefinition[] =
  profilesManifest.profiles;
export const DEFAULT_AI_INSTRUCTION_PROFILE_ID =
  profilesManifest.defaultProfile;

export function isAiInstructionKey(value: unknown): value is AiInstructionKey {
  return typeof value === 'string' && instructionKeys.has(value);
}

export function isAiInstructionProfileId(
  value: unknown,
): value is AiInstructionProfileId {
  return typeof value === 'string' && instructionProfileIds.has(value);
}

export function normalizeAiInstructionProfileId(
  value: string,
): AiInstructionProfileId {
  const normalized = legacyInstructionProfileAliases[value] ?? value;
  if (!instructionProfileIds.has(normalized)) {
    throw new Error(`Unknown AI instruction profile: ${value}`);
  }
  return normalized;
}

export function getAiInstructionDefinition(
  key: AiInstructionKey,
): AiInstructionDefinition | undefined {
  return manifest.instructions.find((definition) => definition.key === key);
}

export function getAiInstructionProfileDefinition(
  profileId: AiInstructionProfileId,
): AiInstructionProfileDefinition | undefined {
  const normalized = legacyInstructionProfileAliases[profileId] ?? profileId;
  return profilesManifest.profiles.find((profile) => profile.id === normalized);
}

function resolveProfileTemplate(
  profileId: AiInstructionProfileId,
  key: AiInstructionKey,
): string {
  const definition = getAiInstructionDefinition(key);
  if (!definition) throw new Error(`Unknown AI instruction key: ${key}`);

  const visited = new Set<string>();
  let current = getAiInstructionProfileDefinition(profileId);
  if (!current) throw new Error(`Unknown AI instruction profile: ${profileId}`);

  while (current) {
    if (visited.has(current.id)) {
      throw new Error(
        `AI instruction profile inheritance cycle at ${current.id}`,
      );
    }
    visited.add(current.id);

    const override = current.instructions[key];
    if (override) return override;

    if (current.revision) {
      const revisionTemplate =
        profilesManifest.revisions[current.revision]?.[key];
      if (revisionTemplate) return revisionTemplate;
    }

    if (!current.extends) break;
    current = getAiInstructionProfileDefinition(current.extends);
    if (!current) {
      throw new Error(`Unknown AI instruction profile: ${profileId}`);
    }
  }

  return definition.template;
}

export function loadBundledInstruction(
  key: AiInstructionKey,
  profileId: AiInstructionProfileId = DEFAULT_AI_INSTRUCTION_PROFILE_ID,
): string {
  const normalizedProfileId = normalizeAiInstructionProfileId(profileId);

  const template = resolveProfileTemplate(normalizedProfileId, key);
  const path = `../config/ai/instructions/${template}`;
  const content = instructionFiles[path];
  if (typeof content !== 'string') {
    throw new Error(`Missing bundled AI instruction template: ${template}`);
  }
  return content.trim();
}

export function renderInstructionTemplate(
  template: string,
  values: Record<string, string | number | boolean | null | undefined>,
): string {
  return template.replace(
    /\{\{([a-zA-Z0-9_.-]+)\}\}/g,
    (_match, key: string) => {
      const value = values[key];
      return value == null ? '' : String(value);
    },
  );
}

export function renderBundledInstruction(
  key: AiInstructionKey,
  values: Record<string, string | number | boolean | null | undefined> = {},
  profileId: AiInstructionProfileId = DEFAULT_AI_INSTRUCTION_PROFILE_ID,
): string {
  return renderInstructionTemplate(
    loadBundledInstruction(key, profileId),
    values,
  );
}

export type AiRuntimeLimitKey = string;
export type AiRuntimeLimitDefinition = {
  key: AiRuntimeLimitKey;
  label: string;
  description: string;
  kind: 'integer' | 'number' | 'enum';
  defaultValue: number | string;
  min?: number;
  max?: number;
  options?: readonly string[];
};

export const AI_RUNTIME_LIMIT_DEFINITIONS: readonly AiRuntimeLimitDefinition[] =
  Object.entries(runtimeConfig.settings).map(([key, definition]) => ({
    key,
    label: definition.label,
    description: definition.description,
    kind: definition.type,
    defaultValue: definition.default,
    min: definition.min,
    max: definition.max,
    options: definition.options,
  }));

const runtimeDefinitionByKey = new Map(
  AI_RUNTIME_LIMIT_DEFINITIONS.map((definition) => [
    definition.key,
    definition,
  ]),
);

export function isAiRuntimeLimitKey(
  value: unknown,
): value is AiRuntimeLimitKey {
  return typeof value === 'string' && runtimeDefinitionByKey.has(value);
}

export function getAiRuntimeLimitDefinition(
  key: AiRuntimeLimitKey,
): AiRuntimeLimitDefinition | undefined {
  return runtimeDefinitionByKey.get(key);
}
