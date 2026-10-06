export const GENERATION_RUN_EVENT_KINDS = [
  'external_agent_invoked',
  'canonical_candidate_received',
  'canonical_candidate_rejected',
  'canonical_candidate_accepted',
  'build_attempt_started',
  'build_rejected',
  'build_accepted',
  'model_step',
  'transport_repair',
  'context_usage',
] as const;

export type GenerationRunEventKind =
  (typeof GENERATION_RUN_EVENT_KINDS)[number];

export const GENERATION_RUN_EVENT_MAX_COUNT = 128;
export const GENERATION_RUN_EVENT_ERROR_CODE_MAX_LENGTH = 80;
export const GENERATION_RUN_EVENT_ERROR_MESSAGE_MAX_LENGTH = 500;

export type GenerationRunEventInput = {
  kind: GenerationRunEventKind;
  invocationNumber?: number;
  candidateNumber?: number;
  buildAttemptNumber?: number;
  modelStepNumber?: number;
  repairCount?: number;
  errorCode?: string;
  errorMessage?: string;
  contextUsedTokens?: number;
  contextLimitTokens?: number;
};

export type GenerationRunEventSnapshot = GenerationRunEventInput & {
  id: string;
  generationRunId: string;
  userId: string;
  sequence: number;
  createdAt: string;
};

export class GenerationRunEventContractError extends Error {
  constructor(
    public readonly code:
      | 'invalid_kind'
      | 'invalid_counter'
      | 'missing_required_counter'
      | 'field_too_long',
    message: string,
  ) {
    super(message);
    this.name = 'GenerationRunEventContractError';
  }
}

function boundedText(
  value: string | undefined,
  maxLength: number,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new GenerationRunEventContractError(
      'field_too_long',
      `${field} must be at most ${maxLength} characters.`,
    );
  }
  return normalized;
}

function boundedInteger(
  value: number | undefined,
  field: string,
  minimum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new GenerationRunEventContractError(
      'invalid_counter',
      `${field} must be a safe integer >= ${minimum}.`,
    );
  }
  return value;
}

function requireCounter(
  value: number | undefined,
  field: string,
  kind: GenerationRunEventKind,
): void {
  if (value === undefined) {
    throw new GenerationRunEventContractError(
      'missing_required_counter',
      `${kind} requires ${field}.`,
    );
  }
}

/**
 * Normalize one server-owned telemetry event before persistence.
 *
 * The contract intentionally has no prompt, model-output, reasoning, canonical
 * project, or arbitrary JSON field. Persist only bounded diagnostics and the
 * narrow counters needed to explain a long-running generation.
 */
export function normalizeGenerationRunEventInput(
  input: GenerationRunEventInput,
): GenerationRunEventInput {
  if (!GENERATION_RUN_EVENT_KINDS.includes(input.kind)) {
    throw new GenerationRunEventContractError(
      'invalid_kind',
      `Unsupported generation run event kind: ${String(input.kind)}.`,
    );
  }

  const invocationNumber = boundedInteger(
    input.invocationNumber,
    'invocationNumber',
    1,
  );
  const candidateNumber = boundedInteger(
    input.candidateNumber,
    'candidateNumber',
    1,
  );
  const buildAttemptNumber = boundedInteger(
    input.buildAttemptNumber,
    'buildAttemptNumber',
    1,
  );
  const modelStepNumber = boundedInteger(
    input.modelStepNumber,
    'modelStepNumber',
    1,
  );
  const repairCount = boundedInteger(input.repairCount, 'repairCount', 1);
  const contextUsedTokens = boundedInteger(
    input.contextUsedTokens,
    'contextUsedTokens',
    0,
  );
  const contextLimitTokens = boundedInteger(
    input.contextLimitTokens,
    'contextLimitTokens',
    1,
  );
  const errorCode = boundedText(
    input.errorCode,
    GENERATION_RUN_EVENT_ERROR_CODE_MAX_LENGTH,
    'errorCode',
  );
  const errorMessage = boundedText(
    input.errorMessage,
    GENERATION_RUN_EVENT_ERROR_MESSAGE_MAX_LENGTH,
    'errorMessage',
  );

  switch (input.kind) {
    case 'external_agent_invoked':
      requireCounter(invocationNumber, 'invocationNumber', input.kind);
      break;
    case 'canonical_candidate_received':
    case 'canonical_candidate_rejected':
    case 'canonical_candidate_accepted':
      requireCounter(candidateNumber, 'candidateNumber', input.kind);
      break;
    case 'build_attempt_started':
    case 'build_rejected':
    case 'build_accepted':
      requireCounter(buildAttemptNumber, 'buildAttemptNumber', input.kind);
      break;
    case 'model_step':
      requireCounter(modelStepNumber, 'modelStepNumber', input.kind);
      break;
    case 'transport_repair':
      requireCounter(repairCount, 'repairCount', input.kind);
      break;
    case 'context_usage':
      requireCounter(contextUsedTokens, 'contextUsedTokens', input.kind);
      break;
  }

  return {
    kind: input.kind,
    ...(invocationNumber !== undefined ? { invocationNumber } : {}),
    ...(candidateNumber !== undefined ? { candidateNumber } : {}),
    ...(buildAttemptNumber !== undefined ? { buildAttemptNumber } : {}),
    ...(modelStepNumber !== undefined ? { modelStepNumber } : {}),
    ...(repairCount !== undefined ? { repairCount } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    ...(contextUsedTokens !== undefined ? { contextUsedTokens } : {}),
    ...(contextLimitTokens !== undefined ? { contextLimitTokens } : {}),
  };
}
