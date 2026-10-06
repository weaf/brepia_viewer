import { AsyncLocalStorage } from 'node:async_hooks';
import type { GenerationRunEventInput } from '@shared/generationRunEvent';
import { appendGenerationRunEvent } from './generationRunEventPersistence';
import { logError } from './serverLog';

const EVENT_ERROR_MESSAGE_MAX_LENGTH = 500;

type TelemetryEventSink = (event: GenerationRunEventInput) => void;

type ActiveGenerationTelemetryState = {
  active: boolean;
  telemetry: GenerationRunTelemetry;
  flush: () => Promise<void>;
};

type CandidateOutcome = {
  accepted: boolean;
  errorCode?: string;
  errorMessage?: string;
};

type BuildOutcome = {
  accepted: boolean;
  errorCode?: string;
  errorMessage?: string;
};

export type GenerationRunTelemetry = {
  externalAgentInvoked: () => number;
  canonicalCandidate: (outcome: CandidateOutcome) => number;
  transportRepair: () => number;
  buildAttemptStarted: () => number;
  buildAttemptFinished: (attemptNumber: number, outcome: BuildOutcome) => void;
  modelStep: (context: {
    contextUsedTokens: number;
    contextLimitTokens?: number;
  }) => number;
};

const activeTelemetry = new AsyncLocalStorage<ActiveGenerationTelemetryState>();

function boundedMessage(message: string | undefined): string | undefined {
  const normalized = message?.trim();
  if (!normalized) return undefined;
  if (normalized.length <= EVENT_ERROR_MESSAGE_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, EVENT_ERROR_MESSAGE_MAX_LENGTH - 1)}…`;
}

export function createGenerationRunTelemetry(
  record: TelemetryEventSink,
): GenerationRunTelemetry {
  let externalInvocationNumber = 0;
  let candidateNumber = 0;
  let repairCount = 0;
  let buildAttemptNumber = 0;
  let modelStepNumber = 0;

  return {
    externalAgentInvoked() {
      externalInvocationNumber += 1;
      record({
        kind: 'external_agent_invoked',
        invocationNumber: externalInvocationNumber,
      });
      return externalInvocationNumber;
    },
    canonicalCandidate(outcome) {
      candidateNumber += 1;
      record({
        kind: 'canonical_candidate_received',
        candidateNumber,
      });
      record({
        kind: outcome.accepted
          ? 'canonical_candidate_accepted'
          : 'canonical_candidate_rejected',
        candidateNumber,
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
        ...(boundedMessage(outcome.errorMessage)
          ? { errorMessage: boundedMessage(outcome.errorMessage) }
          : {}),
      });
      return candidateNumber;
    },
    transportRepair() {
      repairCount += 1;
      record({ kind: 'transport_repair', repairCount });
      return repairCount;
    },
    buildAttemptStarted() {
      buildAttemptNumber += 1;
      record({ kind: 'build_attempt_started', buildAttemptNumber });
      return buildAttemptNumber;
    },
    buildAttemptFinished(attemptNumber, outcome) {
      record({
        kind: outcome.accepted ? 'build_accepted' : 'build_rejected',
        buildAttemptNumber: attemptNumber,
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
        ...(boundedMessage(outcome.errorMessage)
          ? { errorMessage: boundedMessage(outcome.errorMessage) }
          : {}),
      });
    },
    modelStep(context) {
      modelStepNumber += 1;
      record({ kind: 'model_step', modelStepNumber });
      record({
        kind: 'context_usage',
        modelStepNumber,
        contextUsedTokens: Math.max(0, Math.ceil(context.contextUsedTokens)),
        ...(context.contextLimitTokens !== undefined &&
        context.contextLimitTokens > 0
          ? { contextLimitTokens: Math.floor(context.contextLimitTokens) }
          : {}),
      });
      return modelStepNumber;
    },
  };
}

/**
 * Enter request-local telemetry after the durable generation run has become the
 * active owner of the conversation. Writes are serialized and fail open: a
 * telemetry persistence failure is logged but never changes model/build flow.
 */
export function enterActiveGenerationTelemetry(args: {
  userId: string;
  conversationId: string;
  runId: string;
}): () => void {
  let tail = Promise.resolve();
  const record: TelemetryEventSink = (event) => {
    tail = tail
      .then(async () => {
        await appendGenerationRunEvent(args.runId, args.userId, event);
      })
      .catch((error) => {
        logError(error, {
          functionName: 'generation-run-telemetry',
          statusCode: 500,
          userId: args.userId,
          conversationId: args.conversationId,
          additionalContext: {
            operation: 'append_generation_run_event',
            generationRunId: args.runId,
            eventKind: event.kind,
          },
        });
      });
  };

  const state: ActiveGenerationTelemetryState = {
    active: true,
    telemetry: createGenerationRunTelemetry(record),
    flush: () => tail,
  };
  activeTelemetry.enterWith(state);

  return () => {
    if (!state.active) return;
    state.active = false;
    void state.flush();
  };
}

function currentTelemetry(): GenerationRunTelemetry | undefined {
  const state = activeTelemetry.getStore();
  return state?.active ? state.telemetry : undefined;
}

export function recordActiveExternalAgentInvocation(): number | undefined {
  return currentTelemetry()?.externalAgentInvoked();
}

export function recordActiveCanonicalCandidate(
  outcome: CandidateOutcome,
): number | undefined {
  return currentTelemetry()?.canonicalCandidate(outcome);
}

export function recordActiveTransportRepair(): number | undefined {
  return currentTelemetry()?.transportRepair();
}

export function recordActiveBrepBuildAttemptStarted(): number | undefined {
  return currentTelemetry()?.buildAttemptStarted();
}

export function recordActiveBrepBuildAttemptFinished(
  attemptNumber: number | undefined,
  outcome: BuildOutcome,
): void {
  if (attemptNumber === undefined) return;
  currentTelemetry()?.buildAttemptFinished(attemptNumber, outcome);
}

export function recordActiveModelStep(context: {
  contextUsedTokens: number;
  contextLimitTokens?: number;
}): number | undefined {
  return currentTelemetry()?.modelStep(context);
}
