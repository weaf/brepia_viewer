import type { Database } from '@shared/database';
import {
  isGenerationRunTerminal,
  type GenerationRunExecutionMode,
  type GenerationRunKind,
  type GenerationRunSnapshot,
  type GenerationRunStatus,
  type GenerationRunTransportKind,
} from '@shared/generationRun';
import {
  GENERATION_RUN_EVENT_MAX_COUNT,
  type GenerationRunEventKind,
  type GenerationRunEventSnapshot,
} from '@shared/generationRunEvent';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type GenerationRunRow = Database['public']['Tables']['generation_runs']['Row'];

type GenerationRunEventRow = {
  id: string;
  generation_run_id: string;
  user_id: string;
  sequence: number;
  kind: string;
  invocation_number: number | null;
  candidate_number: number | null;
  build_attempt_number: number | null;
  model_step_number: number | null;
  repair_count: number | null;
  error_code: string | null;
  error_message: string | null;
  context_used_tokens: number | null;
  context_limit_tokens: number | null;
  created_at: string;
};

type GenerationRunEventQueryResult = {
  data: GenerationRunEventRow[] | null;
  error: { message: string } | null;
};

type GenerationRunEventQuery = {
  select: (columns: string) => GenerationRunEventQuery;
  eq: (column: string, value: string) => GenerationRunEventQuery;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => PromiseLike<GenerationRunEventQueryResult>;
};

type GenerationRunEventClient = {
  from: (table: 'generation_run_events') => GenerationRunEventQuery;
};

const GENERATION_RUN_POLL_MS = 1_000;
export const GENERATION_RUN_EVENT_TERMINAL_SETTLE_MS = 5_000;

function generationRunEventClient(): GenerationRunEventClient {
  // `shared/database.ts` is generated from the local Supabase schema and is not
  // hand-edited at a migration boundary. Isolate the temporary table cast here
  // until the next schema-driven type regeneration includes generation_run_events.
  return supabase as unknown as GenerationRunEventClient;
}

export function generationRunRowToClientSnapshot(
  row: GenerationRunRow,
): GenerationRunSnapshot {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    requestMessageId: row.request_message_id,
    ...(row.response_message_id
      ? { responseMessageId: row.response_message_id }
      : {}),
    kind: row.kind as GenerationRunKind,
    requestedModelId: row.requested_model_id,
    ...(row.actual_model_id ? { actualModelId: row.actual_model_id } : {}),
    ...(row.transport_kind
      ? { transportKind: row.transport_kind as GenerationRunTransportKind }
      : {}),
    ...(row.execution_mode
      ? { executionMode: row.execution_mode as GenerationRunExecutionMode }
      : {}),
    status: row.status as GenerationRunStatus,
    phase: row.phase as GenerationRunSnapshot['phase'],
    ...(row.detail ? { detail: row.detail } : {}),
    sequence: row.sequence,
    createdAt: row.created_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
  };
}

export function generationRunEventRowToClientSnapshot(
  row: GenerationRunEventRow,
): GenerationRunEventSnapshot {
  return {
    id: row.id,
    generationRunId: row.generation_run_id,
    userId: row.user_id,
    sequence: row.sequence,
    kind: row.kind as GenerationRunEventKind,
    ...(row.invocation_number !== null
      ? { invocationNumber: row.invocation_number }
      : {}),
    ...(row.candidate_number !== null
      ? { candidateNumber: row.candidate_number }
      : {}),
    ...(row.build_attempt_number !== null
      ? { buildAttemptNumber: row.build_attempt_number }
      : {}),
    ...(row.model_step_number !== null
      ? { modelStepNumber: row.model_step_number }
      : {}),
    ...(row.repair_count !== null ? { repairCount: row.repair_count } : {}),
    ...(row.error_code !== null ? { errorCode: row.error_code } : {}),
    ...(row.error_message !== null ? { errorMessage: row.error_message } : {}),
    ...(row.context_used_tokens !== null
      ? { contextUsedTokens: row.context_used_tokens }
      : {}),
    ...(row.context_limit_tokens !== null
      ? { contextLimitTokens: row.context_limit_tokens }
      : {}),
    createdAt: row.created_at,
  };
}

export function reconcileGenerationRunEvents(
  current: readonly GenerationRunEventSnapshot[],
  incoming: readonly GenerationRunEventSnapshot[],
  generationRunId: string,
): GenerationRunEventSnapshot[] {
  const bySequence = new Map<number, GenerationRunEventSnapshot>();
  for (const event of [...current, ...incoming]) {
    if (event.generationRunId !== generationRunId) continue;
    bySequence.set(event.sequence, event);
  }
  return [...bySequence.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-GENERATION_RUN_EVENT_MAX_COUNT);
}

export function shouldPollGenerationRun(
  run: GenerationRunSnapshot | undefined,
  pollWhenMissing: boolean,
): boolean {
  if (!run) return pollWhenMissing;
  return !isGenerationRunTerminal(run.status);
}

export function shouldPollGenerationRunEvents(
  run: GenerationRunSnapshot | undefined,
  nowMs = Date.now(),
): boolean {
  if (!run) return false;
  if (!isGenerationRunTerminal(run.status)) return true;

  const terminalUpdatedAt = Date.parse(run.updatedAt);
  if (!Number.isFinite(terminalUpdatedAt)) return false;
  const terminalAgeMs = Math.max(0, nowMs - terminalUpdatedAt);
  return terminalAgeMs < GENERATION_RUN_EVENT_TERMINAL_SETTLE_MS;
}

export function selectGenerationRunAfterBaseline(
  run: GenerationRunSnapshot | undefined,
  baselineRunId: string | null | undefined,
): GenerationRunSnapshot | undefined {
  if (!run || (baselineRunId && run.id === baselineRunId)) return undefined;
  return run;
}

export async function getLatestBrepGenerationRun({
  conversationId,
  requestMessageId,
}: {
  conversationId: string;
  requestMessageId?: string;
}): Promise<GenerationRunSnapshot | undefined> {
  let query = supabase
    .from('generation_runs')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('kind', 'brep');

  if (requestMessageId) {
    query = query.eq('request_message_id', requestMessageId);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data
    ? generationRunRowToClientSnapshot(data as GenerationRunRow)
    : undefined;
}

export async function getGenerationRunEvents(
  generationRunId: string,
): Promise<GenerationRunEventSnapshot[]> {
  const { data, error } = await generationRunEventClient()
    .from('generation_run_events')
    .select('*')
    .eq('generation_run_id', generationRunId)
    .order('sequence', { ascending: true });

  if (error) throw new Error(error.message);
  return reconcileGenerationRunEvents(
    [],
    (data ?? []).map(generationRunEventRowToClientSnapshot),
    generationRunId,
  );
}

export function useLatestBrepGenerationRun({
  conversationId,
  enabled = true,
  pollWhenMissing = false,
  requestMessageId,
  baselineRunId,
}: {
  conversationId: string;
  enabled?: boolean;
  pollWhenMissing?: boolean;
  requestMessageId?: string;
  baselineRunId?: string | null;
}) {
  return useQuery<GenerationRunSnapshot | undefined>({
    queryKey: [
      'generation-run',
      'brep',
      conversationId,
      requestMessageId ?? null,
      baselineRunId ?? null,
    ],
    enabled: enabled && Boolean(conversationId),
    refetchOnWindowFocus: 'always',
    refetchIntervalInBackground: true,
    refetchInterval: (query) =>
      shouldPollGenerationRun(query.state.data, pollWhenMissing)
        ? GENERATION_RUN_POLL_MS
        : false,
    queryFn: async () => {
      const run = await getLatestBrepGenerationRun({
        conversationId,
        ...(requestMessageId ? { requestMessageId } : {}),
      });
      return requestMessageId
        ? selectGenerationRunAfterBaseline(run, baselineRunId)
        : run;
    },
  });
}

export function useGenerationRunEvents({
  run,
  enabled = true,
}: {
  run: GenerationRunSnapshot | undefined;
  enabled?: boolean;
}) {
  return useQuery<GenerationRunEventSnapshot[]>({
    queryKey: ['generation-run-events', run?.id ?? null],
    enabled: enabled && Boolean(run?.id),
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
    refetchIntervalInBackground: true,
    refetchInterval: () =>
      shouldPollGenerationRunEvents(run) ? GENERATION_RUN_POLL_MS : false,
    queryFn: () => (run ? getGenerationRunEvents(run.id) : Promise.resolve([])),
  });
}
