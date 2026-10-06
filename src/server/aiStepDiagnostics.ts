import { estimateModelMessagesForHardBudget } from './aiContextBudget';
import { recordActiveModelStep } from './generationRunTelemetry';

type SizedJson = {
  bytes: number;
  estimatedTokens: number;
};

export type AiStepContextMeasurement = {
  messageCount: number;
  modelMessageBytes: number;
  modelMessageEstimatedTokens: number;
  imageCount: number;
  imageBase64Chars: number;
  imageEstimatedTokens: number;
  toolResultCount: number;
  toolResultOutputBytes: number;
  toolResultOutputEstimatedTokens: number;
  brepToolCallCount: number;
  brepToolResultCount: number;
  brepToolInputBytes: number;
  brepToolInputEstimatedTokens: number;
  brepToolOutputBytes: number;
  brepToolOutputEstimatedTokens: number;
  brepToolPayloadBytes: number;
  brepToolPayloadEstimatedTokens: number;
};

export type AiToolErrorClassification = {
  errorClass: string;
  errorCode?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

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

function sizeJson(value: unknown): SizedJson {
  const estimate = estimateModelMessagesForHardBudget([value]);
  return {
    bytes: utf8Bytes(jsonText(value)),
    estimatedTokens: estimate.estimatedTokens,
  };
}

function visitToolPayloads(
  value: unknown,
  measurement: AiStepContextMeasurement,
  seen: Set<object>,
): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      visitToolPayloads(item, measurement, seen);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : undefined;
  const toolName =
    typeof record.toolName === 'string' ? record.toolName : undefined;

  if (type === 'tool-result') {
    measurement.toolResultCount += 1;
    if ('output' in record && record.output !== undefined) {
      const output = sizeJson(record.output);
      measurement.toolResultOutputBytes += output.bytes;
      measurement.toolResultOutputEstimatedTokens += output.estimatedTokens;

      if (toolName === 'build_brep_project') {
        measurement.brepToolResultCount += 1;
        measurement.brepToolOutputBytes += output.bytes;
        measurement.brepToolOutputEstimatedTokens += output.estimatedTokens;
      }
    } else if (toolName === 'build_brep_project') {
      measurement.brepToolResultCount += 1;
    }
  } else if (toolName === 'build_brep_project' && type === 'tool-call') {
    measurement.brepToolCallCount += 1;
    if ('input' in record && record.input !== undefined) {
      const input = sizeJson(record.input);
      measurement.brepToolInputBytes += input.bytes;
      measurement.brepToolInputEstimatedTokens += input.estimatedTokens;
    }
  }

  for (const child of Object.values(record)) {
    visitToolPayloads(child, measurement, seen);
  }
}

/**
 * Measure only bounded metadata for the exact provider-facing messages of one
 * model step. The payloads themselves are never returned or logged.
 */
export function measureAiStepContext(
  messages: readonly unknown[],
): AiStepContextMeasurement {
  const contextEstimate = estimateModelMessagesForHardBudget(messages);
  const measurement: AiStepContextMeasurement = {
    messageCount: messages.length,
    modelMessageBytes: contextEstimate.bytes,
    modelMessageEstimatedTokens: contextEstimate.estimatedTokens,
    imageCount: contextEstimate.imageCount,
    imageBase64Chars: contextEstimate.imageBase64Chars,
    imageEstimatedTokens: contextEstimate.imageEstimatedTokens,
    toolResultCount: 0,
    toolResultOutputBytes: 0,
    toolResultOutputEstimatedTokens: 0,
    brepToolCallCount: 0,
    brepToolResultCount: 0,
    brepToolInputBytes: 0,
    brepToolInputEstimatedTokens: 0,
    brepToolOutputBytes: 0,
    brepToolOutputEstimatedTokens: 0,
    brepToolPayloadBytes: 0,
    brepToolPayloadEstimatedTokens: 0,
  };

  visitToolPayloads(messages, measurement, new Set<object>());
  measurement.brepToolPayloadBytes =
    measurement.brepToolInputBytes + measurement.brepToolOutputBytes;
  measurement.brepToolPayloadEstimatedTokens =
    measurement.brepToolInputEstimatedTokens +
    measurement.brepToolOutputEstimatedTokens;

  // F/G telemetry persists only the deterministic step estimate, never the
  // provider-facing message payload. Provider-reported usage remains separate
  // evidence in aiChat and OpenCode step.ended events.
  recordActiveModelStep({
    contextUsedTokens: measurement.modelMessageEstimatedTokens,
  });

  return measurement;
}

function classifyOneError(error: unknown): AiToolErrorClassification {
  if (error instanceof Error) {
    const record = error as Error & {
      code?: unknown;
      cause?: unknown;
    };
    const errorCode =
      typeof record.code === 'string' || typeof record.code === 'number'
        ? String(record.code)
        : undefined;
    return {
      errorClass: error.name || error.constructor.name || 'Error',
      ...(errorCode ? { errorCode } : {}),
    };
  }

  const record = asRecord(error);
  const errorClass =
    typeof record?.name === 'string'
      ? record.name
      : typeof record?.type === 'string'
        ? record.type
        : error === null
          ? 'null'
          : typeof error;
  const errorCode =
    typeof record?.code === 'string' || typeof record?.code === 'number'
      ? String(record.code)
      : undefined;
  return {
    errorClass,
    ...(errorCode ? { errorCode } : {}),
  };
}

/**
 * Prefer a bounded underlying cause when an SDK wrapper exposes one. This keeps
 * validation classes such as BrepAiProjectError/ZodError visible without
 * logging error messages or candidate payloads.
 */
export function classifyAiToolError(
  error: unknown,
): AiToolErrorClassification {
  const outer = classifyOneError(error);
  const cause =
    error instanceof Error
      ? (error as Error & { cause?: unknown }).cause
      : asRecord(error)?.cause;
  if (cause === undefined || cause === error) return outer;

  const inner = classifyOneError(cause);
  if (inner.errorClass === 'object' || inner.errorClass === 'unknown') {
    return outer;
  }
  return inner;
}

export function summarizeAiToolChoice(toolChoice: unknown): string {
  if (typeof toolChoice === 'string') return toolChoice;
  const record = asRecord(toolChoice);
  if (!record) return 'unknown';
  const type = typeof record.type === 'string' ? record.type : 'unknown';
  return type === 'tool' && typeof record.toolName === 'string'
    ? `tool:${record.toolName}`
    : type;
}
