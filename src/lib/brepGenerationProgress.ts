import type { GenerationRunPhase, GenerationRunSnapshot } from '@shared/generationRun';
import type { Model } from '@shared/types';

export type BrepProgressStepState =
  | 'complete'
  | 'active'
  | 'pending'
  | 'failed';

export type BrepProgressStep = {
  label: string;
  state: BrepProgressStepState;
};

const PHASE_ORDER: Record<GenerationRunPhase, number> = {
  request_saved: 0,
  model_dispatched: 1,
  generating: 2,
  response_received: 3,
  validating_artifact: 4,
  saving_revision: 5,
  revision_saved: 6,
  evaluation_requested: 7,
  evaluating_native: 8,
  preparing_viewer: 9,
  preview_ready: 10,
};

export function selectedBrepModelLabel(
  model: Model,
  executionMode: 'cli' | 'streaming',
): string {
  if (model.startsWith('agent/opencode/')) {
    return `OpenCode ${executionMode} · ${model.slice('agent/opencode/'.length)}`;
  }
  if (model.startsWith('agent/codex/')) {
    return `Codex CLI · ${model.slice('agent/codex/'.length)}`;
  }
  if (model.startsWith('local/')) {
    return `Local · ${model.slice('local/'.length)}`;
  }
  return model;
}

export function generationRunModelLabel(
  run: GenerationRunSnapshot,
  fallbackModel: Model,
  fallbackExecutionMode: 'cli' | 'streaming',
): string {
  const model = run.actualModelId ?? run.requestedModelId;
  if (run.transportKind === 'opencode') {
    const mode = run.executionMode ?? fallbackExecutionMode;
    return `OpenCode ${mode} · ${model}`;
  }
  if (run.transportKind === 'codex') return `Codex CLI · ${model}`;
  if (run.transportKind === 'cli-agent') return `CLI agent · ${model}`;
  if (run.actualModelId) return model;
  return selectedBrepModelLabel(fallbackModel, fallbackExecutionMode);
}

function phaseAtLeast(
  phase: GenerationRunPhase,
  expected: GenerationRunPhase,
): boolean {
  return PHASE_ORDER[phase] >= PHASE_ORDER[expected];
}

function failedStepIndex(phase: GenerationRunPhase): number {
  if (phaseAtLeast(phase, 'revision_saved')) return 6;
  if (phaseAtLeast(phase, 'saving_revision')) return 5;
  if (phaseAtLeast(phase, 'response_received')) return 4;
  return 3;
}

export function durableBrepProgressSteps({
  run,
  conversationSynced,
}: {
  run: GenerationRunSnapshot;
  conversationSynced: boolean;
}): BrepProgressStep[] {
  const terminalFailure = run.status === 'failed' || run.status === 'cancelled';
  const failedIndex = terminalFailure ? failedStepIndex(run.phase) : -1;
  const state = (
    index: number,
    complete: boolean,
    active: boolean,
  ): BrepProgressStepState => {
    if (index === failedIndex) return 'failed';
    if (complete) return 'complete';
    return active ? 'active' : 'pending';
  };

  return [
    { label: 'Open BRep project', state: 'complete' },
    {
      label: 'Synchronize conversation state',
      state: conversationSynced ? 'complete' : 'active',
    },
    { label: 'Persist creation request', state: 'complete' },
    {
      label: 'Generate canonical BRep definition',
      state: state(
        3,
        phaseAtLeast(run.phase, 'response_received'),
        phaseAtLeast(run.phase, 'request_saved'),
      ),
    },
    {
      label: 'Validate canonical BRep source',
      state: state(
        4,
        phaseAtLeast(run.phase, 'saving_revision'),
        phaseAtLeast(run.phase, 'response_received'),
      ),
    },
    {
      label: 'Save immutable project revision',
      state: state(
        5,
        phaseAtLeast(run.phase, 'revision_saved'),
        phaseAtLeast(run.phase, 'saving_revision'),
      ),
    },
    {
      label: 'Evaluate native geometry and prepare 3D preview',
      state: state(
        6,
        phaseAtLeast(run.phase, 'preview_ready') || run.status === 'completed',
        phaseAtLeast(run.phase, 'revision_saved'),
      ),
    },
  ];
}
