import type { Database } from '@shared/database';
import {
  applyGenerationRunTransition,
  isGenerationRunTerminal,
  type GenerationRunExecutionMode,
  type GenerationRunKind,
  type GenerationRunSnapshot,
  type GenerationRunStatus,
  type GenerationRunTransition,
  type GenerationRunTransportKind,
} from '@shared/generationRun';
import { getServiceRoleSupabaseClient } from './supabaseClient';

type GenerationRunRow = Database['public']['Tables']['generation_runs']['Row'];
type GenerationRunInsert =
  Database['public']['Tables']['generation_runs']['Insert'];
type GenerationRunUpdate =
  Database['public']['Tables']['generation_runs']['Update'];
type ServiceRoleClient = ReturnType<typeof getServiceRoleSupabaseClient>;

export type CreateGenerationRunInput = {
  userId: string;
  conversationId: string;
  requestMessageId: string;
  kind: GenerationRunKind;
  requestedModelId: string;
};

export type DurableGenerationRunTransition = Omit<
  GenerationRunTransition,
  'sequence' | 'updatedAt'
> & {
  updatedAt?: string;
};

export function generationRunRowToSnapshot(
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

export function generationRunInsertFor(
  input: CreateGenerationRunInput,
  now: string,
): GenerationRunInsert {
  return {
    user_id: input.userId,
    conversation_id: input.conversationId,
    request_message_id: input.requestMessageId,
    kind: input.kind,
    requested_model_id: input.requestedModelId,
    status: 'queued',
    phase: 'request_saved',
    sequence: 1,
    created_at: now,
    updated_at: now,
  };
}

export function generationRunUpdateFor(
  snapshot: GenerationRunSnapshot,
): GenerationRunUpdate {
  return {
    response_message_id: snapshot.responseMessageId ?? null,
    actual_model_id: snapshot.actualModelId ?? null,
    transport_kind: snapshot.transportKind ?? null,
    execution_mode: snapshot.executionMode ?? null,
    status: snapshot.status,
    phase: snapshot.phase,
    detail: snapshot.detail ?? null,
    sequence: snapshot.sequence,
    started_at: snapshot.startedAt ?? null,
    updated_at: snapshot.updatedAt,
    completed_at: snapshot.completedAt ?? null,
    error_code: snapshot.errorCode ?? null,
    error_message: snapshot.errorMessage ?? null,
  };
}

async function loadGenerationRun(
  client: ServiceRoleClient,
  runId: string,
  userId: string,
): Promise<GenerationRunSnapshot> {
  const { data, error } = await client
    .from('generation_runs')
    .select('*')
    .eq('id', runId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new Error(
      `Generation run ${runId} could not be loaded: ${error?.message ?? 'not found'}`,
    );
  }
  return generationRunRowToSnapshot(data);
}

export async function createGenerationRun(
  input: CreateGenerationRunInput,
  options: { client?: ServiceRoleClient; now?: string } = {},
): Promise<GenerationRunSnapshot> {
  const client = options.client ?? getServiceRoleSupabaseClient();
  const now = options.now ?? new Date().toISOString();
  const { data, error } = await client
    .from('generation_runs')
    .insert(generationRunInsertFor(input, now))
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(
      `Generation run could not be created: ${error?.message ?? 'missing row'}`,
    );
  }
  return generationRunRowToSnapshot(data);
}

export async function transitionGenerationRun(
  runId: string,
  userId: string,
  transition: DurableGenerationRunTransition,
  options: { client?: ServiceRoleClient; now?: string } = {},
): Promise<GenerationRunSnapshot> {
  const client = options.client ?? getServiceRoleSupabaseClient();
  const current = await loadGenerationRun(client, runId, userId);
  if (isGenerationRunTerminal(current.status)) return current;

  const next = applyGenerationRunTransition(current, {
    ...transition,
    sequence: current.sequence + 1,
    updatedAt: transition.updatedAt ?? options.now ?? new Date().toISOString(),
  });

  const { data, error } = await client
    .from('generation_runs')
    .update(generationRunUpdateFor(next))
    .eq('id', runId)
    .eq('user_id', userId)
    .eq('sequence', current.sequence)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Generation run ${runId} update failed: ${error.message}`);
  }
  if (data) return generationRunRowToSnapshot(data);

  // Another trusted server path (for example the explicit cancel endpoint) may
  // have won the optimistic race. Return the durable winner when it is already
  // terminal instead of trying to overwrite it with stale in-memory progress.
  const winner = await loadGenerationRun(client, runId, userId);
  if (isGenerationRunTerminal(winner.status)) return winner;
  throw new Error(
    `Generation run ${runId} changed concurrently at sequence ${current.sequence}.`,
  );
}

export async function cancelGenerationRun(
  runId: string,
  userId: string,
  options: { client?: ServiceRoleClient; now?: string; detail?: string } = {},
): Promise<GenerationRunSnapshot> {
  const now = options.now ?? new Date().toISOString();
  return transitionGenerationRun(
    runId,
    userId,
    {
      status: 'cancelled',
      completedAt: now,
      detail: options.detail ?? 'Generation cancelled.',
    },
    { client: options.client, now },
  );
}

export async function cancelLatestInFlightGenerationRun(
  userId: string,
  conversationId: string,
  options: { client?: ServiceRoleClient; now?: string } = {},
): Promise<GenerationRunSnapshot | undefined> {
  const client = options.client ?? getServiceRoleSupabaseClient();
  const { data, error } = await client
    .from('generation_runs')
    .select('*')
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Active generation run lookup failed: ${error.message}`);
  }
  if (!data) return undefined;

  return cancelGenerationRun(data.id, userId, {
    client,
    now: options.now,
  });
}

export function generationRunKindForConversation(
  conversationType: 'parametric' | 'creative',
  hasBrepRoute: boolean,
): GenerationRunKind {
  if (conversationType === 'creative') return 'creative';
  return hasBrepRoute ? 'brep' : 'parametric';
}

export function generationRunFailureFields(
  code: string,
  now = new Date().toISOString(),
): Pick<DurableGenerationRunTransition, 'status' | 'completedAt' | 'errorCode'> {
  return {
    status: 'failed',
    completedAt: now,
    errorCode: code,
  };
}
