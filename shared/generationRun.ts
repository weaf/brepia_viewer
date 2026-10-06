export const GENERATION_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_preview',
  'completed',
  'failed',
  'cancelled',
] as const;

export type GenerationRunStatus = (typeof GENERATION_RUN_STATUSES)[number];

export const GENERATION_RUN_PHASES = [
  'request_saved',
  'model_dispatched',
  'generating',
  'response_received',
  'validating_artifact',
  'saving_revision',
  'revision_saved',
  'evaluation_requested',
  'evaluating_native',
  'preparing_viewer',
  'preview_ready',
] as const;

export type GenerationRunPhase = (typeof GENERATION_RUN_PHASES)[number];

export type GenerationRunKind = 'parametric' | 'brep' | 'creative';

export type GenerationRunTransportKind =
  | 'direct'
  | 'opencode'
  | 'codex'
  | 'cli-agent';

export type GenerationRunExecutionMode = 'cli' | 'streaming';

export const GENERATION_RUN_DETAIL_MAX_LENGTH = 240;
export const GENERATION_RUN_ERROR_CODE_MAX_LENGTH = 80;
export const GENERATION_RUN_ERROR_MESSAGE_MAX_LENGTH = 500;

export type GenerationRunSnapshot = {
  id: string;
  userId: string;
  conversationId: string;
  requestMessageId: string;
  responseMessageId?: string;
  kind: GenerationRunKind;
  requestedModelId: string;
  actualModelId?: string;
  transportKind?: GenerationRunTransportKind;
  executionMode?: GenerationRunExecutionMode;
  status: GenerationRunStatus;
  phase: GenerationRunPhase;
  detail?: string;
  sequence: number;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type GenerationRunTransition = {
  sequence: number;
  status?: GenerationRunStatus;
  phase?: GenerationRunPhase;
  responseMessageId?: string;
  actualModelId?: string;
  transportKind?: GenerationRunTransportKind;
  executionMode?: GenerationRunExecutionMode;
  detail?: string | null;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export class GenerationRunTransitionError extends Error {
  constructor(
    public readonly code:
      | 'invalid_sequence'
      | 'terminal_run'
      | 'invalid_status_transition'
      | 'phase_regression'
      | 'invalid_terminal_fields'
      | 'field_too_long',
    message: string,
  ) {
    super(message);
    this.name = 'GenerationRunTransitionError';
  }
}

const phaseOrder = new Map<GenerationRunPhase, number>(
  GENERATION_RUN_PHASES.map((phase, index) => [phase, index]),
);

const terminalStatuses = new Set<GenerationRunStatus>([
  'completed',
  'failed',
  'cancelled',
]);

const aiEditingPhases = new Set<GenerationRunPhase>([
  'request_saved',
  'model_dispatched',
  'generating',
  'response_received',
  'validating_artifact',
  'saving_revision',
]);

const allowedStatusTransitions: Record<
  GenerationRunStatus,
  ReadonlySet<GenerationRunStatus>
> = {
  queued: new Set(['queued', 'running', 'failed', 'cancelled']),
  running: new Set([
    'running',
    'waiting_for_preview',
    'completed',
    'failed',
    'cancelled',
  ]),
  waiting_for_preview: new Set([
    'waiting_for_preview',
    'running',
    'completed',
    'failed',
    'cancelled',
  ]),
  completed: new Set(['completed']),
  failed: new Set(['failed']),
  cancelled: new Set(['cancelled']),
};

function boundedOptional(
  value: string | undefined | null,
  maxLength: number,
  field: string,
): string | undefined {
  if (value == null) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new GenerationRunTransitionError(
      'field_too_long',
      `${field} must be at most ${maxLength} characters.`,
    );
  }
  return normalized;
}

function assertIsoTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new GenerationRunTransitionError(
      'invalid_terminal_fields',
      `${field} must be an ISO-compatible timestamp.`,
    );
  }
}

/**
 * Apply a server-owned durable progress transition.
 *
 * `sequence` is a monotonic state version, never a progress percentage. The
 * phase may stay unchanged while transport/reconnect detail changes, but it
 * may never move backwards. Separate run IDs isolate concurrent/retried turns;
 * this helper only permits newer writes to the same run.
 */
export function applyGenerationRunTransition(
  current: GenerationRunSnapshot,
  transition: GenerationRunTransition,
): GenerationRunSnapshot {
  if (!Number.isSafeInteger(transition.sequence) || transition.sequence <= 0) {
    throw new GenerationRunTransitionError(
      'invalid_sequence',
      'Generation run sequence must be a positive safe integer.',
    );
  }
  if (transition.sequence <= current.sequence) {
    throw new GenerationRunTransitionError(
      'invalid_sequence',
      `Generation run sequence ${transition.sequence} is not newer than ${current.sequence}.`,
    );
  }

  const nextStatus = transition.status ?? current.status;
  if (terminalStatuses.has(current.status)) {
    throw new GenerationRunTransitionError(
      'terminal_run',
      `Generation run is already terminal (${current.status}).`,
    );
  }
  if (!allowedStatusTransitions[current.status].has(nextStatus)) {
    throw new GenerationRunTransitionError(
      'invalid_status_transition',
      `Generation run cannot transition from ${current.status} to ${nextStatus}.`,
    );
  }

  const nextPhase = transition.phase ?? current.phase;
  const currentPhaseOrder = phaseOrder.get(current.phase) ?? -1;
  const nextPhaseOrder = phaseOrder.get(nextPhase) ?? -1;
  if (nextPhaseOrder < currentPhaseOrder) {
    throw new GenerationRunTransitionError(
      'phase_regression',
      `Generation run phase cannot regress from ${current.phase} to ${nextPhase}.`,
    );
  }

  assertIsoTimestamp(transition.updatedAt, 'updatedAt');
  if (transition.startedAt) assertIsoTimestamp(transition.startedAt, 'startedAt');
  if (transition.completedAt)
    assertIsoTimestamp(transition.completedAt, 'completedAt');

  const detail = boundedOptional(
    transition.detail === undefined ? current.detail : transition.detail,
    GENERATION_RUN_DETAIL_MAX_LENGTH,
    'detail',
  );
  const errorCode = boundedOptional(
    transition.errorCode === undefined
      ? current.errorCode
      : transition.errorCode,
    GENERATION_RUN_ERROR_CODE_MAX_LENGTH,
    'errorCode',
  );
  const errorMessage = boundedOptional(
    transition.errorMessage === undefined
      ? current.errorMessage
      : transition.errorMessage,
    GENERATION_RUN_ERROR_MESSAGE_MAX_LENGTH,
    'errorMessage',
  );

  if (nextStatus === 'failed' && !errorCode) {
    throw new GenerationRunTransitionError(
      'invalid_terminal_fields',
      'Failed generation runs require a bounded errorCode.',
    );
  }
  if (
    terminalStatuses.has(nextStatus) &&
    !transition.completedAt &&
    !current.completedAt
  ) {
    throw new GenerationRunTransitionError(
      'invalid_terminal_fields',
      `Terminal generation status ${nextStatus} requires completedAt.`,
    );
  }
  if (!terminalStatuses.has(nextStatus) && transition.completedAt) {
    throw new GenerationRunTransitionError(
      'invalid_terminal_fields',
      'Non-terminal generation runs must not set completedAt.',
    );
  }

  return {
    ...current,
    ...(transition.responseMessageId
      ? { responseMessageId: transition.responseMessageId }
      : {}),
    ...(transition.actualModelId
      ? { actualModelId: transition.actualModelId }
      : {}),
    ...(transition.transportKind
      ? { transportKind: transition.transportKind }
      : {}),
    ...(transition.executionMode
      ? { executionMode: transition.executionMode }
      : {}),
    status: nextStatus,
    phase: nextPhase,
    sequence: transition.sequence,
    updatedAt: transition.updatedAt,
    ...(transition.startedAt
      ? { startedAt: transition.startedAt }
      : current.startedAt
        ? { startedAt: current.startedAt }
        : {}),
    ...(detail ? { detail } : { detail: undefined }),
    ...(errorCode ? { errorCode } : { errorCode: undefined }),
    ...(errorMessage ? { errorMessage } : { errorMessage: undefined }),
    ...(transition.completedAt
      ? { completedAt: transition.completedAt }
      : current.completedAt
        ? { completedAt: current.completedAt }
        : {}),
  };
}

export function isGenerationRunTerminal(
  status: GenerationRunStatus,
): boolean {
  return terminalStatuses.has(status);
}

/**
 * Whether a durable BRep run still owns source-write exclusion.
 *
 * Once the immutable revision has been saved, native evaluation/viewer work is
 * preview lifecycle rather than AI source generation and must not keep the
 * Parameters/source editors locked. Terminal runs never own the edit lock.
 */
export function isGenerationRunAiEditing(
  run: Pick<GenerationRunSnapshot, 'status' | 'phase'>,
): boolean {
  return !isGenerationRunTerminal(run.status) && aiEditingPhases.has(run.phase);
}
