import { ActivityIndicator } from '@/components/brand';
import {
  durableBrepProgressSteps,
  generationRunModelLabel,
  selectedBrepModelLabel,
  type BrepProgressStep,
  type BrepProgressStepState,
} from '@/lib/brepGenerationProgress';
import { generationRunEventLabel } from '@/lib/generationRunEventPresentation';
import { useGenerationRunEvents } from '@/services/generationRunService';
import type { GenerationRunSnapshot } from '@shared/generationRun';
import type { Message, Model } from '@shared/types';
import { Check, ChevronDown, Circle, X } from 'lucide-react';

function StepIcon({ state }: { state: BrepProgressStepState }) {
  if (state === 'complete') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-adam-blue/15 text-adam-blue">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }

  if (state === 'failed') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }

  if (state === 'active') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <ActivityIndicator label="Current step" size="sm" />
      </span>
    );
  }

  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-adam-neutral-500">
      <Circle className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}

function durableCurrentLabel(run: GenerationRunSnapshot): string {
  if (run.status === 'failed') {
    return run.errorMessage ?? run.detail ?? 'BRep generation failed.';
  }
  if (run.status === 'cancelled') {
    return run.detail ?? 'BRep generation was stopped.';
  }
  if (run.status === 'completed') {
    return 'Native BRep is ready. Synchronizing project state…';
  }

  switch (run.phase) {
    case 'request_saved':
      return 'Creation request saved. Preparing the selected AI model…';
    case 'model_dispatched':
      return 'The selected AI transport is starting…';
    case 'generating':
      return 'AI is generating the canonical BRep definition…';
    case 'response_received':
    case 'validating_artifact':
      return 'Validating the generated canonical BRep source…';
    case 'saving_revision':
      return 'Saving the immutable BRep project revision…';
    case 'revision_saved':
      return 'Project revision saved. Preparing native preview…';
    case 'evaluation_requested':
    case 'evaluating_native':
      return 'Evaluating native BRep geometry…';
    case 'preparing_viewer':
      return 'Preparing the native 3D viewer payload…';
    case 'preview_ready':
      return 'Native BRep preview is ready.';
  }
}

function humanizeToken(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ');
}

function compactTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

function compactId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function statusTitle(
  run: GenerationRunSnapshot | undefined,
  mode: 'create' | 'edit',
): string {
  const noun = mode === 'create' ? 'creation' : 'update';
  if (run?.status === 'failed') return `Native BRep ${noun} failed`;
  if (run?.status === 'cancelled') return `Native BRep ${noun} stopped`;
  if (run?.status === 'completed') return 'Native BRep ready';
  return mode === 'create' ? 'Creating native BRep' : 'Updating native BRep';
}

function detailRows(
  run: GenerationRunSnapshot,
  modelLabel: string,
): Array<{ label: string; value: string; mono?: boolean }> {
  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'Model', value: modelLabel },
    { label: 'Status', value: humanizeToken(run.status) },
    { label: 'Phase', value: humanizeToken(run.phase) },
  ];

  if (run.transportKind) {
    rows.push({
      label: 'Transport',
      value: `${humanizeToken(run.transportKind)}${run.executionMode ? ` · ${humanizeToken(run.executionMode)}` : ''}`,
    });
  }
  if (run.detail) rows.push({ label: 'Server detail', value: run.detail });

  const startedAt = compactTimestamp(run.startedAt ?? run.createdAt);
  const updatedAt = compactTimestamp(run.updatedAt);
  const completedAt = compactTimestamp(run.completedAt);
  if (startedAt) rows.push({ label: 'Started', value: startedAt, mono: true });
  if (updatedAt) rows.push({ label: 'Last update', value: updatedAt, mono: true });
  if (completedAt) rows.push({ label: 'Completed', value: completedAt, mono: true });

  rows.push({
    label: 'Progress event',
    value: `#${run.sequence}`,
    mono: true,
  });
  rows.push({ label: 'Run', value: compactId(run.id) ?? run.id, mono: true });
  rows.push({
    label: 'Request message',
    value: compactId(run.requestMessageId) ?? run.requestMessageId,
    mono: true,
  });
  if (run.responseMessageId) {
    rows.push({
      label: 'Response message',
      value: compactId(run.responseMessageId) ?? run.responseMessageId,
      mono: true,
    });
  }
  if (run.errorCode) {
    rows.push({ label: 'Error code', value: run.errorCode, mono: true });
  }

  return rows;
}

export function BrepCreationProgress({
  messages,
  messagesFetched,
  leafPresent,
  model,
  executionMode,
  requestSavedOverride,
  generationRun,
  variant = 'page',
  mode = 'create',
}: {
  messages: Message[];
  messagesFetched: boolean;
  leafPresent: boolean;
  model: Model;
  executionMode: 'cli' | 'streaming';
  requestSavedOverride?: boolean;
  generationRun?: GenerationRunSnapshot;
  variant?: 'page' | 'inline';
  mode?: 'create' | 'edit';
}) {
  const conversationSynced = messagesFetched && leafPresent;
  const requestSaved =
    requestSavedOverride ?? messages.some((message) => message.role === 'user');
  const terminalFailure =
    generationRun?.status === 'failed' || generationRun?.status === 'cancelled';
  const { data: generationEvents = [] } = useGenerationRunEvents({
    run: generationRun,
    enabled: Boolean(generationRun),
  });
  const latestGenerationEvent = generationEvents.at(-1);
  const latestActivityLabel = latestGenerationEvent
    ? generationRunEventLabel(latestGenerationEvent)
    : undefined;

  const steps: BrepProgressStep[] = generationRun
    ? durableBrepProgressSteps({ run: generationRun, conversationSynced })
    : [
        { label: 'Open BRep project', state: 'complete' },
        {
          label: 'Synchronize conversation state',
          state: conversationSynced ? 'complete' : 'active',
        },
        {
          label: 'Persist creation request',
          state: requestSaved
            ? 'complete'
            : conversationSynced
              ? 'active'
              : 'pending',
        },
        {
          label: 'Generate canonical BRep definition',
          state: requestSaved && conversationSynced ? 'active' : 'pending',
        },
        { label: 'Validate canonical BRep source', state: 'pending' },
        { label: 'Save immutable project revision', state: 'pending' },
        {
          label: 'Evaluate native geometry and prepare 3D preview',
          state: 'pending',
        },
      ];

  const currentLabel = generationRun
    ? durableCurrentLabel(generationRun)
    : !messagesFetched
      ? 'Loading conversation state…'
      : !leafPresent
        ? 'Synchronizing the active branch…'
        : !requestSaved
          ? 'Saving the BRep creation request…'
          : 'AI is generating the canonical BRep definition…';
  const modelLabel = generationRun
    ? generationRunModelLabel(generationRun, model, executionMode)
    : selectedBrepModelLabel(model, executionMode);

  const card = (
    <section
      className={
        variant === 'inline'
          ? 'mx-3 mt-3 rounded-xl border border-adam-neutral-700 bg-adam-bg-secondary-dark/95 p-4 shadow-sm sm:mx-4'
          : 'w-full max-w-md rounded-2xl border border-adam-neutral-700 bg-adam-bg-secondary-dark/95 p-5 shadow-lg sm:p-6'
      }
      aria-label="Native BRep generation status"
    >
      <div className="flex items-start gap-3">
        {terminalFailure ? (
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <X className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : (
          <ActivityIndicator
            label={currentLabel}
            size={variant === 'inline' ? 'sm' : 'lg'}
            className="mt-1 shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h1 className="text-sm font-semibold text-adam-text-primary sm:text-base">
              {statusTitle(generationRun, mode)}
            </h1>
            {generationRun ? (
              <span className="rounded-full border border-adam-neutral-700 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-adam-neutral-400">
                {humanizeToken(generationRun.phase)}
              </span>
            ) : null}
          </div>
          <p
            className={`mt-1 text-sm leading-5 ${terminalFailure ? 'text-destructive' : 'text-adam-text-secondary'}`}
            aria-live="polite"
          >
            {currentLabel}
          </p>
          {latestActivityLabel ? (
            <p className="mt-1 break-words text-xs leading-4 text-adam-neutral-300">
              Latest activity: {latestActivityLabel}
            </p>
          ) : null}
          <p className="mt-1 break-words text-[11px] text-adam-neutral-400">
            {generationRun ? 'Generation model' : 'Selected model'}: {modelLabel}
          </p>
        </div>
      </div>

      <details className="group mt-3 border-t border-adam-neutral-700 pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-adam-text-secondary marker:hidden hover:text-adam-text-primary">
          <span>Generation details</span>
          <ChevronDown
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>

        <ol className="mt-4 space-y-2.5" aria-label="Native BRep generation progress">
          {steps.map((step) => (
            <li
              key={step.label}
              className={`flex items-center gap-3 text-xs ${
                step.state === 'pending'
                  ? 'text-adam-neutral-500'
                  : step.state === 'failed'
                    ? 'text-destructive'
                    : 'text-adam-text-primary'
              }`}
              aria-current={step.state === 'active' ? 'step' : undefined}
            >
              <StepIcon state={step.state} />
              <span>{step.label}</span>
            </li>
          ))}
        </ol>

        {generationRun ? (
          <section className="mt-4 border-t border-adam-neutral-700 pt-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-medium text-adam-text-secondary">
                Agent activity
              </h2>
              <span className="text-[10px] text-adam-neutral-500">
                {generationEvents.length === 0
                  ? 'No detailed events'
                  : `${generationEvents.length} durable ${generationEvents.length === 1 ? 'event' : 'events'}`}
              </span>
            </div>
            {generationEvents.length > 0 ? (
              <ol
                className="mt-3 max-h-64 space-y-2 overflow-y-auto overscroll-contain pr-2"
                aria-label="Durable generation activity"
                tabIndex={0}
              >
                {generationEvents.map((event) => (
                  <li
                    key={event.id}
                    className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2 text-[11px] leading-4"
                  >
                    <span className="font-mono text-[10px] text-adam-neutral-500">
                      #{event.sequence}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-adam-neutral-300">
                        {generationRunEventLabel(event)}
                      </p>
                      {event.errorCode && event.errorMessage ? (
                        <p className="mt-0.5 break-words text-[10px] text-adam-neutral-500">
                          {event.errorMessage}
                        </p>
                      ) : null}
                      <time
                        className="mt-0.5 block font-mono text-[9px] text-adam-neutral-600"
                        dateTime={event.createdAt}
                      >
                        {compactTimestamp(event.createdAt)}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-[11px] leading-4 text-adam-neutral-500">
                This run has durable lifecycle state but no detailed agent telemetry.
                Older runs remain fully supported.
              </p>
            )}
          </section>
        ) : null}

        {generationRun ? (
          <dl className="mt-4 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-adam-neutral-700 pt-3 text-[11px] leading-4">
            {detailRows(generationRun, modelLabel).map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-adam-neutral-500">{row.label}</dt>
                <dd
                  className={`min-w-0 break-words text-adam-neutral-300 ${row.mono ? 'font-mono text-[10px]' : ''}`}
                  title={row.value}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-4 border-t border-adam-neutral-700 pt-3 text-[11px] leading-4 text-adam-neutral-400">
            Waiting for the server to publish the durable generation run. The
            selected model and conversation request are already preserved.
          </p>
        )}

        <p className="mt-3 text-[11px] leading-4 text-adam-neutral-500">
          {generationRun
            ? 'This status and agent activity are persisted by the server. You can leave the page and return without losing durable generation progress.'
            : 'Brepia is synchronizing generation state. Persisted project state will be reconciled when you return.'}
        </p>
      </details>
    </section>
  );

  if (variant === 'inline') return card;

  return (
    <main className="flex h-full min-h-0 w-full items-center justify-center overflow-auto bg-adam-background-1 px-4 py-8 sm:px-6">
      {card}
    </main>
  );
}