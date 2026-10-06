import type { AiTurnProvenance } from './aiTurnProvenance';
import { logError } from './serverLog';
import {
  cancelGenerationRun,
  cancelLatestInFlightGenerationRun,
  createGenerationRun,
  generationRunFailureFields,
  transitionGenerationRun,
  type CreateGenerationRunInput,
  type DurableGenerationRunTransition,
} from './generationRunPersistence';

export class AiGenerationRunLifecycle {
  readonly id: string;
  readonly userId: string;
  readonly conversationId: string;
  private queue: Promise<void> = Promise.resolve();

  private constructor(input: {
    id: string;
    userId: string;
    conversationId: string;
  }) {
    this.id = input.id;
    this.userId = input.userId;
    this.conversationId = input.conversationId;
  }

  static async create(
    input: CreateGenerationRunInput,
  ): Promise<AiGenerationRunLifecycle> {
    const run = await createGenerationRun(input);
    return new AiGenerationRunLifecycle({
      id: run.id,
      userId: run.userId,
      conversationId: run.conversationId,
    });
  }

  private enqueue(
    operation: string,
    transition: DurableGenerationRunTransition,
  ): Promise<void> {
    const next = this.queue.then(async () => {
      try {
        await transitionGenerationRun(this.id, this.userId, transition);
      } catch (error) {
        logError(error, {
          functionName: 'ai-generation-run',
          statusCode: 500,
          userId: this.userId,
          conversationId: this.conversationId,
          additionalContext: {
            operation,
            generationRunId: this.id,
          },
        });
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  dispatched(provenance: AiTurnProvenance): Promise<void> {
    const now = new Date().toISOString();
    return this.enqueue('model_dispatched', {
      status: 'running',
      phase: 'model_dispatched',
      actualModelId: provenance.actualModel,
      transportKind: provenance.transportKind,
      ...(provenance.openCodeExecutionMode
        ? { executionMode: provenance.openCodeExecutionMode }
        : {}),
      startedAt: now,
      detail:
        provenance.transportKind === 'opencode'
          ? provenance.openCodeExecutionMode === 'streaming'
            ? 'OpenCode streaming transport selected.'
            : 'OpenCode CLI transport selected.'
          : provenance.transportKind === 'codex'
            ? 'Codex CLI transport selected.'
            : provenance.transportKind === 'cli-agent'
              ? 'CLI agent transport selected.'
              : 'Direct model transport selected.',
    });
  }

  generating(): Promise<void> {
    return this.enqueue('generating', {
      status: 'running',
      phase: 'generating',
      detail: 'Model generation in progress.',
    });
  }

  responseReceived(): Promise<void> {
    return this.enqueue('response_received', {
      status: 'running',
      phase: 'response_received',
      detail: 'Model response received.',
    });
  }

  validatingArtifact(responseMessageId: string): Promise<void> {
    return this.enqueue('validating_artifact', {
      status: 'running',
      phase: 'validating_artifact',
      responseMessageId,
      detail: 'Validating generated artifact.',
    });
  }

  savingRevision(responseMessageId: string): Promise<void> {
    return this.enqueue('saving_revision', {
      status: 'running',
      phase: 'saving_revision',
      responseMessageId,
      detail: 'Saving generated revision.',
    });
  }

  persisted(
    responseMessageId: string,
    waitsForNativePreview: boolean,
  ): Promise<void> {
    if (waitsForNativePreview) {
      return this.enqueue('revision_saved_waiting_for_preview', {
        status: 'waiting_for_preview',
        phase: 'revision_saved',
        responseMessageId,
        detail: 'Revision saved; waiting for native preview request.',
      });
    }

    const now = new Date().toISOString();
    return this.enqueue('revision_saved_completed', {
      status: 'completed',
      phase: 'revision_saved',
      responseMessageId,
      completedAt: now,
      detail: 'Generation completed and response saved.',
    });
  }

  failed(code: string): Promise<void> {
    return this.enqueue('failed', {
      ...generationRunFailureFields(code),
      detail: 'Generation failed.',
    });
  }

  cancelled(detail = 'Generation cancelled.'): Promise<void> {
    const now = new Date().toISOString();
    return this.enqueue('cancelled', {
      status: 'cancelled',
      completedAt: now,
      detail,
    });
  }
}

export async function cancelDurableGenerationRun(
  runId: string,
  userId: string,
  conversationId: string,
  detail = 'Generation cancelled.',
): Promise<void> {
  try {
    await cancelGenerationRun(runId, userId, { detail });
  } catch (error) {
    logError(error, {
      functionName: 'ai-generation-run',
      statusCode: 500,
      userId,
      conversationId,
      additionalContext: {
        operation: 'cancel_durable_run',
        generationRunId: runId,
      },
    });
  }
}

export async function cancelLatestDurableGenerationRun(
  userId: string,
  conversationId: string,
): Promise<boolean> {
  try {
    return Boolean(
      await cancelLatestInFlightGenerationRun(userId, conversationId),
    );
  } catch (error) {
    logError(error, {
      functionName: 'ai-generation-run',
      statusCode: 500,
      userId,
      conversationId,
      additionalContext: { operation: 'cancel_latest_durable_run' },
    });
    return false;
  }
}
