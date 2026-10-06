const ORDINARY_UTF8_BYTES_PER_TOKEN = 4;
const BASE64_CHARS_PER_TOKEN = 2;

/**
 * C5 conservative calibration for the deterministic byte-based estimator.
 *
 * Real llama.cpp measurements on this branch observed provider/static ratios
 * of 1.4022 (C3 follow-up) and 1.5715 (original C1 overflow fixture). Keep a
 * deliberate margin above the largest measured ratio until an exact provider
 * tokenizer preflight is wired end-to-end.
 */
export const AI_CONTEXT_CONSERVATIVE_TOKEN_MULTIPLIER = 1.75;

const MIN_OUTPUT_RESERVE_TOKENS = 4096;
const MAX_OUTPUT_RESERVE_TOKENS = 16384;
const OUTPUT_RESERVE_CONTEXT_FRACTION = 1 / 8;

export type AiModelMessageBudgetEstimate = {
  bytes: number;
  estimatedTokens: number;
  imageCount: number;
  imageBase64Chars: number;
  imageEstimatedTokens: number;
};

export type AiHardContextBudget = {
  enforced: boolean;
  fits: boolean | null;
  contextWindowTokens: number | null;
  safetyMarginTokens: number | null;
  rawEstimatedInputTokens: number;
  conservativeMultiplier: number;
  conservativeInputTokens: number;
  configuredMaxOutputTokens: number;
  modelOutputLimitTokens: number | null;
  configuredOutputCapTokens: number;
  minimumOutputReserveTokens: number | null;
  hardInputLimitTokens: number | null;
  hardInputHeadroomTokens: number | null;
  maximumSafeOutputTokens: number | null;
  effectiveMaxOutputTokens: number;
};

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function addDataUrl(value: string, accumulator: { count: number; chars: number }): boolean {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/is.exec(value);
  if (!match) return false;
  accumulator.count += 1;
  accumulator.chars += match[1].length;
  return true;
}

function collectImageBase64(
  value: unknown,
  accumulator: { count: number; chars: number },
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
      accumulator.chars += value.length;
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

/**
 * Deterministic model-message estimate used by the per-step C5 gate. Images are
 * charged more conservatively than ordinary UTF-8 so historical/current image
 * payloads cannot exploit the ordinary bytes/4 heuristic.
 */
export function estimateModelMessagesForHardBudget(
  modelMessages: readonly unknown[],
): AiModelMessageBudgetEstimate {
  const serialized = jsonText(modelMessages);
  const bytes = utf8Bytes(serialized);
  const images = { count: 0, chars: 0 };
  collectImageBase64(modelMessages, images);
  const nonImageBytes = Math.max(0, bytes - images.chars);
  const imageEstimatedTokens = Math.ceil(images.chars / BASE64_CHARS_PER_TOKEN);
  const estimatedTokens =
    Math.ceil(nonImageBytes / ORDINARY_UTF8_BYTES_PER_TOKEN) +
    imageEstimatedTokens;

  return {
    bytes,
    estimatedTokens,
    imageCount: images.count,
    imageBase64Chars: images.chars,
    imageEstimatedTokens,
  };
}

function configuredOutputCap(
  configuredMaxOutputTokens: number,
  modelOutputLimitTokens: number | null,
): number {
  const configured = Math.max(1, Math.floor(configuredMaxOutputTokens));
  return modelOutputLimitTokens !== null && modelOutputLimitTokens > 0
    ? Math.min(configured, Math.floor(modelOutputLimitTokens))
    : configured;
}

export function deriveMinimumOutputReserveTokens(
  contextWindowTokens: number,
  configuredOutputCapTokens: number,
): number {
  const contextualReserve = Math.min(
    MAX_OUTPUT_RESERVE_TOKENS,
    Math.max(
      MIN_OUTPUT_RESERVE_TOKENS,
      Math.ceil(contextWindowTokens * OUTPUT_RESERVE_CONTEXT_FRACTION),
    ),
  );
  return Math.min(configuredOutputCapTokens, contextualReserve);
}

/**
 * Derive the C5 hard input gate and a safe per-step max-output cap.
 *
 * Unknown context metadata is never invented: in that case enforcement stays
 * disabled and the caller keeps the configured output cap. With known metadata
 * the gate reserves the existing safety margin plus a bounded non-trivial
 * output allowance, while the effective max output is reduced only as much as
 * required by the conservatively bounded input.
 */
export function deriveAiHardContextBudget({
  estimatedInputTokens,
  contextWindowTokens,
  configuredMaxOutputTokens,
  modelOutputLimitTokens,
  safetyMarginTokens,
}: {
  estimatedInputTokens: number;
  contextWindowTokens: number | null;
  configuredMaxOutputTokens: number;
  modelOutputLimitTokens: number | null;
  safetyMarginTokens: number | null;
}): AiHardContextBudget {
  const rawEstimatedInputTokens = Math.max(0, Math.ceil(estimatedInputTokens));
  const conservativeInputTokens = Math.ceil(
    rawEstimatedInputTokens * AI_CONTEXT_CONSERVATIVE_TOKEN_MULTIPLIER,
  );
  const configuredOutputCapTokens = configuredOutputCap(
    configuredMaxOutputTokens,
    modelOutputLimitTokens,
  );

  if (
    contextWindowTokens === null ||
    contextWindowTokens <= 0 ||
    safetyMarginTokens === null ||
    safetyMarginTokens < 0
  ) {
    return {
      enforced: false,
      fits: null,
      contextWindowTokens,
      safetyMarginTokens,
      rawEstimatedInputTokens,
      conservativeMultiplier: AI_CONTEXT_CONSERVATIVE_TOKEN_MULTIPLIER,
      conservativeInputTokens,
      configuredMaxOutputTokens,
      modelOutputLimitTokens,
      configuredOutputCapTokens,
      minimumOutputReserveTokens: null,
      hardInputLimitTokens: null,
      hardInputHeadroomTokens: null,
      maximumSafeOutputTokens: null,
      effectiveMaxOutputTokens: configuredOutputCapTokens,
    };
  }

  const context = Math.floor(contextWindowTokens);
  const safety = Math.floor(safetyMarginTokens);
  const minimumOutputReserveTokens = deriveMinimumOutputReserveTokens(
    context,
    configuredOutputCapTokens,
  );
  const hardInputLimitTokens = Math.max(
    0,
    context - safety - minimumOutputReserveTokens,
  );
  const hardInputHeadroomTokens =
    hardInputLimitTokens - conservativeInputTokens;
  const maximumSafeOutputTokens = Math.max(
    0,
    context - safety - conservativeInputTokens,
  );
  const effectiveMaxOutputTokens = Math.max(
    1,
    Math.min(configuredOutputCapTokens, maximumSafeOutputTokens),
  );
  const fits = conservativeInputTokens <= hardInputLimitTokens;

  return {
    enforced: true,
    fits,
    contextWindowTokens: context,
    safetyMarginTokens: safety,
    rawEstimatedInputTokens,
    conservativeMultiplier: AI_CONTEXT_CONSERVATIVE_TOKEN_MULTIPLIER,
    conservativeInputTokens,
    configuredMaxOutputTokens,
    modelOutputLimitTokens,
    configuredOutputCapTokens,
    minimumOutputReserveTokens,
    hardInputLimitTokens,
    hardInputHeadroomTokens,
    maximumSafeOutputTokens,
    effectiveMaxOutputTokens,
  };
}

export class AiContextBudgetError extends Error {
  readonly code = 'context_budget_exceeded';

  constructor(public readonly budget: AiHardContextBudget) {
    super(
      'AI context exceeds the configured model budget before provider dispatch.',
    );
    this.name = 'AiContextBudgetError';
  }
}

export function assertAiHardContextBudget(
  budget: AiHardContextBudget,
): void {
  if (budget.enforced && budget.fits === false) {
    throw new AiContextBudgetError(budget);
  }
}
