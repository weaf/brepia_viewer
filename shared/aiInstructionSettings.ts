import { z } from 'zod';
import {
  AI_RUNTIME_LIMIT_DEFINITIONS,
  DEFAULT_AI_INSTRUCTION_PROFILE_ID,
  isAiInstructionKey,
  isAiInstructionProfileId,
  type AiInstructionKey,
  type AiInstructionProfileId,
  type AiRuntimeLimitKey,
} from './aiInstructionCatalog.ts';

const nullableProfileIdSchema = z.union([z.string().uuid(), z.null()]);

export const AiInstructionKeySchema = z
  .string()
  .min(1)
  .max(128)
  .refine(isAiInstructionKey, 'Unknown AI instruction key');

export const AiInstructionProfileIdSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isAiInstructionProfileId, 'Unknown AI instruction profile');

export const DEFAULT_INSTRUCTION_PROFILE_ID: AiInstructionProfileId =
  DEFAULT_AI_INSTRUCTION_PROFILE_ID;

export const InstructionProfileDefaultsSchema = z
  .record(z.string(), nullableProfileIdSchema)
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (!isAiInstructionKey(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Unknown AI instruction key: ${key}`,
        });
      }
    }
  });

export type InstructionProfileDefaults = Partial<
  Record<AiInstructionKey, string | null>
>;

const runtimeDefinitionByKey = new Map(
  AI_RUNTIME_LIMIT_DEFINITIONS.map((definition) => [
    definition.key,
    definition,
  ]),
);

export const RuntimeOverridesSchema = z
  .record(z.string(), z.union([z.number(), z.string()]))
  .superRefine((value, ctx) => {
    for (const [key, raw] of Object.entries(value)) {
      const definition = runtimeDefinitionByKey.get(key);
      if (!definition) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Unknown AI runtime setting: ${key}`,
        });
        continue;
      }

      if (definition.kind === 'enum') {
        if (typeof raw !== 'string' || !definition.options?.includes(raw)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${definition.label} must be one of: ${definition.options?.join(', ')}`,
          });
        }
        continue;
      }

      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${definition.label} must be a finite number`,
        });
        continue;
      }

      if (definition.kind === 'integer' && !Number.isInteger(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${definition.label} must be an integer`,
        });
      }
      if (definition.min !== undefined && raw < definition.min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${definition.label} must be at least ${definition.min}`,
        });
      }
      if (definition.max !== undefined && raw > definition.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${definition.label} must be at most ${definition.max}`,
        });
      }
    }
  });

export type RuntimeOverrides = Partial<
  Record<AiRuntimeLimitKey, number | string>
>;

export function runtimeDefaultValue(key: AiRuntimeLimitKey): number | string {
  const definition = runtimeDefinitionByKey.get(key);
  if (!definition) throw new Error(`Unknown AI runtime setting: ${key}`);
  return definition.defaultValue;
}

export function resolveRuntimeValue(
  overrides: RuntimeOverrides | null | undefined,
  key: AiRuntimeLimitKey,
): number | string {
  const raw = overrides?.[key];
  return raw === undefined ? runtimeDefaultValue(key) : raw;
}
