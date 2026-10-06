import { zodSchema } from 'ai';
import { z } from 'zod';
import type { AppUIMessage } from '@shared/chatAi';
import { getLocalModelMetadataById } from './localModels';
import {
  projectBrepProviderModelMessages,
  type BrepAiModelContextProjectionDiagnostics,
  type BrepProviderModelContextProjectionDiagnostics,
} from './brepAiModelContext';

const ORDINARY_UTF8_BYTES_PER_TOKEN = 4;
const BASE64_CHARS_PER_TOKEN = 2;
const MIN_SAFETY_MARGIN_TOKENS = 8192;
const MAX_SAFETY_MARGIN_TOKENS = 12288;
const SAFETY_MARGIN_CONTEXT_FRACTION = 1 / 16;
const LOCAL_MODEL_PREFIX = 'local/';
const LOCAL_OPENCODE_MODEL_PREFIXES = [
  'agent/opencode/llama-swap/',
  'opencode/llama-swap/',
] as const;

export type AiModelBudgetMetadata = {
  contextLimit: number | null;
  outputLimit: number | null;
  source: 'local-settings' | 'unknown';
};

type ToolSchemaBreakdown = {
  name: string;
  bytes: number;
  estimatedTokens: number;
  schemaAvailable: boolean;
};

type SizedEstimate = {
  bytes: number;
  estimatedTokens: number;
};

export type AiContextDiagnostics = {
  estimator: {
    ordinaryUtf8BytesPerToken: number;
    base64CharsPerToken: number;
  };
  systemInstructions: SizedEstimate & {
    bytesBeforeBrepContext: number;
    addedBrepContextBytes: number;
  };
  providerToolSchemas: SizedEstimate & {
    count: number;
    tools: ToolSchemaBreakdown[];
  };
  currentCanonicalBrep: SizedEstimate & {
    present: boolean;
  };
  ordinaryConversationHistory: SizedEstimate & {
    messageCount: number;
    textPartCount: number;
  };
  historicalBrepToolPayloads: SizedEstimate & {
    callCount: number;
    inputBytes: number;
    outputBytes: number;
  };
  historicalBrepSnapshots: {
    count: number;
    persistedBytes: number;
    providerEstimatedTokens: 0;
  };
  brepModelProjection: {
    branch: BrepAiModelContextProjectionDiagnostics;
    provider: BrepProviderModelContextProjectionDiagnostics;
  };
  images: {
    count: number;
    base64Chars: number;
    estimatedTokens: number;
  };
  effectiveModelMessages: SizedEstimate & {
    count: number;
  };
  total: {
    estimatedInputTokens: number;
    estimatedInputTokensExcludingProviderToolSchemas: number;
  };
  budget: {
    contextWindowTokens: number | null;
    modelOutputLimitTokens: number | null;
    reservedOutputTokens: number;
    safetyMarginTokens: number | null;
    usableInputBudgetTokens: number | null;
    estimatedHeadroomTokens: number | null;
    reservedOutputExceedsModelLimit: boolean;
  };
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function estimateOrdinaryTokens(bytes: number): number {
  return Math.ceil(bytes / ORDINARY_UTF8_BYTES_PER_TOKEN);
}

function sizeText(text: string): SizedEstimate {
  const bytes = utf8Bytes(text);
  return { bytes, estimatedTokens: estimateOrdinaryTokens(bytes) };
}

function sizeJson(value: unknown): SizedEstimate {
  return sizeText(jsonText(value));
}

async function materializeProviderJsonSchema(
  inputSchema: unknown,
): Promise<unknown | undefined> {
  const schemaRecord = asRecord(inputSchema);
  if (schemaRecord && 'jsonSchema' in schemaRecord) {
    return Promise.resolve(schemaRecord.jsonSchema);
  }
  if (inputSchema instanceof z.ZodType) {
    return Promise.resolve(zodSchema(inputSchema).jsonSchema);
  }
  return undefined;
}

async function estimateProviderToolSchemas(
  tools: Record<string, unknown>,
): Promise<AiContextDiagnostics['providerToolSchemas']> {
  const breakdown: ToolSchemaBreakdown[] = [];
  let bytes = 0;

  for (const [name, toolValue] of Object.entries(tools)) {
    const tool = asRecord(toolValue);
    const description = typeof tool?.description === 'string' ? tool.description : '';
    let schema: unknown | undefined;
    try {
      schema = await materializeProviderJsonSchema(tool?.inputSchema);
    } catch {
      schema = undefined;
    }
    const toolBytes = sizeJson({
      name,
      description,
      inputSchema: schema ?? null,
    }).bytes;
    bytes += toolBytes;
    breakdown.push({
      name,
      bytes: toolBytes,
      estimatedTokens: estimateOrdinaryTokens(toolBytes),
      schemaAvailable: schema !== undefined,
    });
  }

  return {
    count: breakdown.length,
    bytes,
    estimatedTokens: estimateOrdinaryTokens(bytes),
    tools: breakdown,
  };
}

function estimatePersistedHistory(messages: readonly AppUIMessage[]): {
  ordinary: AiContextDiagnostics['ordinaryConversationHistory'];
  brepToolPayloads: AiContextDiagnostics['historicalBrepToolPayloads'];
  brepSnapshots: AiContextDiagnostics['historicalBrepSnapshots'];
} {
  let ordinaryBytes = 0;
  let textPartCount = 0;
  let brepToolCallCount = 0;
  let brepToolInputBytes = 0;
  let brepToolOutputBytes = 0;
  let brepSnapshotCount = 0;
  let brepSnapshotBytes = 0;

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'text' || part.type === 'reasoning') {
        ordinaryBytes += utf8Bytes(part.text);
        textPartCount += 1;
        continue;
      }

      if (part.type === 'tool-build_brep_project') {
        brepToolCallCount += 1;
        if ('input' in part && part.input !== undefined) {
          brepToolInputBytes += sizeJson(part.input).bytes;
        }
        if ('output' in part && part.output !== undefined) {
          brepToolOutputBytes += sizeJson(part.output).bytes;
        }
        continue;
      }

      if (part.type === 'data-brep-project') {
        brepSnapshotCount += 1;
        brepSnapshotBytes += sizeJson(part.data).bytes;
      }
    }
  }

  const brepPayloadBytes = brepToolInputBytes + brepToolOutputBytes;
  return {
    ordinary: {
      messageCount: messages.length,
      textPartCount,
      bytes: ordinaryBytes,
      estimatedTokens: estimateOrdinaryTokens(ordinaryBytes),
    },
    brepToolPayloads: {
      callCount: brepToolCallCount,
      inputBytes: brepToolInputBytes,
      outputBytes: brepToolOutputBytes,
      bytes: brepPayloadBytes,
      estimatedTokens: estimateOrdinaryTokens(brepPayloadBytes),
    },
    brepSnapshots: {
      count: brepSnapshotCount,
      persistedBytes: brepSnapshotBytes,
      providerEstimatedTokens: 0,
    },
  };
}

type ImageAccumulator = {
  count: number;
  base64Chars: number;
};

function addDataUrl(value: string, accumulator: ImageAccumulator): boolean {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/is.exec(value);
  if (!match) return false;
  accumulator.count += 1;
  accumulator.base64Chars += match[1].length;
  return true;
}

function collectImageBase64(
  value: unknown,
  accumulator: ImageAccumulator,
  seen = new Set<object>(),
  parentType?: string,
  parentKey?: string,
): void {
  if (typeof value === 'string') {
    if (addDataUrl(value, accumulator)) return;
    if (
      parentType?.includes('image') &&
      (parentKey === 'data' || parentKey === 'image') &&
      value.length >= 64 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value)
    ) {
      accumulator.count += 1;
      accumulator.base64Chars += value.length;
    }
    return;
  }

  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageBase64(item, accumulator, seen, parentType, parentKey);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : parentType;
  for (const [key, child] of Object.entries(record)) {
    collectImageBase64(child, accumulator, seen, type, key);
  }
}

function estimateEffectiveModelMessages(
  modelMessages: readonly unknown[],
): {
  messages: AiContextDiagnostics['effectiveModelMessages'];
  images: AiContextDiagnostics['images'];
} {
  const serialized = jsonText(modelMessages);
  const bytes = utf8Bytes(serialized);
  const imageAccumulator: ImageAccumulator = { count: 0, base64Chars: 0 };
  collectImageBase64(modelMessages, imageAccumulator);
  const nonImageBytes = Math.max(0, bytes - imageAccumulator.base64Chars);
  const imageTokens = Math.ceil(
    imageAccumulator.base64Chars / BASE64_CHARS_PER_TOKEN,
  );
  const estimatedTokens = estimateOrdinaryTokens(nonImageBytes) + imageTokens;

  return {
    messages: {
      count: modelMessages.length,
      bytes,
      estimatedTokens,
    },
    images: {
      count: imageAccumulator.count,
      base64Chars: imageAccumulator.base64Chars,
      estimatedTokens: imageTokens,
    },
  };
}

export function deriveContextSafetyMargin(
  contextWindowTokens: number | null,
): number | null {
  if (!contextWindowTokens || contextWindowTokens <= 0) return null;
  return Math.min(
    MAX_SAFETY_MARGIN_TOKENS,
    Math.max(
      MIN_SAFETY_MARGIN_TOKENS,
      Math.ceil(contextWindowTokens * SAFETY_MARGIN_CONTEXT_FRACTION),
    ),
  );
}

/**
 * Map only Brepia model IDs that are known to address the configured local
 * llama-swap runtime onto the persisted local-model metadata key. Provider
 * aliases are explicit; context limits are never inferred from model names.
 */
export function localModelMetadataKeyForAiModelId(
  modelId: string,
): string | undefined {
  if (modelId.startsWith(LOCAL_MODEL_PREFIX)) {
    const metadataKey = modelId.slice(LOCAL_MODEL_PREFIX.length);
    return metadataKey || undefined;
  }

  for (const prefix of LOCAL_OPENCODE_MODEL_PREFIXES) {
    if (modelId.startsWith(prefix)) {
      const metadataKey = modelId.slice(prefix.length);
      return metadataKey || undefined;
    }
  }

  return undefined;
}

export async function resolveAiModelBudgetMetadata(
  userId: string,
  modelId: string,
): Promise<AiModelBudgetMetadata> {
  const metadataKey = localModelMetadataKeyForAiModelId(modelId);
  if (!metadataKey) {
    return { contextLimit: null, outputLimit: null, source: 'unknown' };
  }

  try {
    const metadata = await getLocalModelMetadataById(userId, metadataKey);
    return {
      contextLimit: metadata?.contextLimit ?? null,
      outputLimit: metadata?.outputLimit ?? null,
      source: metadata ? 'local-settings' : 'unknown',
    };
  } catch {
    return { contextLimit: null, outputLimit: null, source: 'unknown' };
  }
}

/**
 * Pre-dispatch context boundary. For persisted Native BRep follow-up turns the
 * C3 projection is applied to the mutable provider message array before any
 * diagnostics are calculated; the same array is subsequently passed to
 * streamText by aiChat. Durable branchMessages remain untouched.
 */
export async function buildAiContextDiagnostics({
  systemPrompt,
  systemPromptBeforeBrepContext,
  tools,
  branchMessages,
  modelMessages,
  currentBrepProject,
  modelContextLimit,
  modelOutputLimit,
  reservedOutputTokens,
}: {
  systemPrompt: string;
  systemPromptBeforeBrepContext: string;
  tools: Record<string, unknown>;
  branchMessages: readonly AppUIMessage[];
  modelMessages: unknown[];
  currentBrepProject?: unknown;
  modelContextLimit: number | null;
  modelOutputLimit: number | null;
  reservedOutputTokens: number;
}): Promise<AiContextDiagnostics> {
  const brepProjection = projectBrepProviderModelMessages({
    modelMessages,
    branchMessages,
    enabled: currentBrepProject !== undefined,
  });
  if (brepProjection.providerDiagnostics.applied) {
    modelMessages.splice(0, modelMessages.length, ...brepProjection.messages);
  }

  const systemSize = sizeText(systemPrompt);
  const baseSystemBytes = utf8Bytes(systemPromptBeforeBrepContext);
  const providerToolSchemas = await estimateProviderToolSchemas(tools);
  const currentCanonicalBrep = currentBrepProject
    ? sizeJson(currentBrepProject)
    : { bytes: 0, estimatedTokens: 0 };
  const persisted = estimatePersistedHistory(branchMessages);
  const effective = estimateEffectiveModelMessages(modelMessages);
  const estimatedInputTokensExcludingProviderToolSchemas =
    systemSize.estimatedTokens + effective.messages.estimatedTokens;
  const estimatedInputTokens =
    estimatedInputTokensExcludingProviderToolSchemas +
    providerToolSchemas.estimatedTokens;
  const safetyMarginTokens = deriveContextSafetyMargin(modelContextLimit);
  const usableInputBudgetTokens =
    modelContextLimit !== null && safetyMarginTokens !== null
      ? Math.max(0, modelContextLimit - reservedOutputTokens - safetyMarginTokens)
      : null;

  return {
    estimator: {
      ordinaryUtf8BytesPerToken: ORDINARY_UTF8_BYTES_PER_TOKEN,
      base64CharsPerToken: BASE64_CHARS_PER_TOKEN,
    },
    systemInstructions: {
      ...systemSize,
      bytesBeforeBrepContext: baseSystemBytes,
      addedBrepContextBytes: Math.max(0, systemSize.bytes - baseSystemBytes),
    },
    providerToolSchemas,
    currentCanonicalBrep: {
      present: currentBrepProject !== undefined,
      ...currentCanonicalBrep,
    },
    ordinaryConversationHistory: persisted.ordinary,
    historicalBrepToolPayloads: persisted.brepToolPayloads,
    historicalBrepSnapshots: persisted.brepSnapshots,
    brepModelProjection: {
      branch: brepProjection.branchDiagnostics,
      provider: brepProjection.providerDiagnostics,
    },
    images: effective.images,
    effectiveModelMessages: effective.messages,
    total: {
      estimatedInputTokens,
      estimatedInputTokensExcludingProviderToolSchemas,
    },
    budget: {
      contextWindowTokens: modelContextLimit,
      modelOutputLimitTokens: modelOutputLimit,
      reservedOutputTokens,
      safetyMarginTokens,
      usableInputBudgetTokens,
      estimatedHeadroomTokens:
        usableInputBudgetTokens === null
          ? null
          : usableInputBudgetTokens - estimatedInputTokens,
      reservedOutputExceedsModelLimit:
        modelOutputLimit !== null && reservedOutputTokens > modelOutputLimit,
    },
  };
}
