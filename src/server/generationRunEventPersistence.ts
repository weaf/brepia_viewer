import {
  normalizeGenerationRunEventInput,
  type GenerationRunEventInput,
  type GenerationRunEventKind,
  type GenerationRunEventSnapshot,
} from '@shared/generationRunEvent';
import { getServiceRoleSupabaseClient } from './supabaseClient';

type ServiceRoleClient = ReturnType<typeof getServiceRoleSupabaseClient>;

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

export type AppendGenerationRunEventArgs = {
  p_generation_run_id: string;
  p_user_id: string;
  p_kind: GenerationRunEventKind;
  p_invocation_number: number | null;
  p_candidate_number: number | null;
  p_build_attempt_number: number | null;
  p_model_step_number: number | null;
  p_repair_count: number | null;
  p_error_code: string | null;
  p_error_message: string | null;
  p_context_used_tokens: number | null;
  p_context_limit_tokens: number | null;
};

function untypedServiceRoleClient(client: ServiceRoleClient) {
  // Generated Supabase types are refreshed from the local schema. Keep the
  // migration-boundary cast isolated here until shared/database.ts is regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any;
}

export function generationRunEventRowToSnapshot(
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

export function generationRunEventRpcArgsFor(
  runId: string,
  userId: string,
  input: GenerationRunEventInput,
): AppendGenerationRunEventArgs {
  const event = normalizeGenerationRunEventInput(input);
  return {
    p_generation_run_id: runId,
    p_user_id: userId,
    p_kind: event.kind,
    p_invocation_number: event.invocationNumber ?? null,
    p_candidate_number: event.candidateNumber ?? null,
    p_build_attempt_number: event.buildAttemptNumber ?? null,
    p_model_step_number: event.modelStepNumber ?? null,
    p_repair_count: event.repairCount ?? null,
    p_error_code: event.errorCode ?? null,
    p_error_message: event.errorMessage ?? null,
    p_context_used_tokens: event.contextUsedTokens ?? null,
    p_context_limit_tokens: event.contextLimitTokens ?? null,
  };
}

/**
 * Append one telemetry event through the database-owned sequence/retention
 * boundary. The RPC serializes against the parent generation run so concurrent
 * trusted server paths cannot assign duplicate per-run event sequences.
 */
export async function appendGenerationRunEvent(
  runId: string,
  userId: string,
  input: GenerationRunEventInput,
  options: { client?: ServiceRoleClient } = {},
): Promise<GenerationRunEventSnapshot> {
  const client = untypedServiceRoleClient(
    options.client ?? getServiceRoleSupabaseClient(),
  );
  const { data, error } = await client.rpc(
    'append_generation_run_event',
    generationRunEventRpcArgsFor(runId, userId, input),
  );

  if (error) {
    throw new Error(
      `Generation run ${runId} telemetry append failed: ${error.message}`,
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | GenerationRunEventRow
    | null
    | undefined;
  if (!row) {
    throw new Error(`Generation run ${runId} telemetry append returned no row.`);
  }
  return generationRunEventRowToSnapshot(row);
}

/**
 * Load the bounded durable ledger in deterministic per-run sequence order.
 * The explicit user filter is required because this trusted client bypasses RLS.
 */
export async function listGenerationRunEvents(
  runId: string,
  userId: string,
  options: { client?: ServiceRoleClient } = {},
): Promise<GenerationRunEventSnapshot[]> {
  const client = untypedServiceRoleClient(
    options.client ?? getServiceRoleSupabaseClient(),
  );
  const { data, error } = await client
    .from('generation_run_events')
    .select('*')
    .eq('generation_run_id', runId)
    .eq('user_id', userId)
    .order('sequence', { ascending: true });

  if (error) {
    throw new Error(
      `Generation run ${runId} telemetry load failed: ${error.message}`,
    );
  }
  return ((data ?? []) as GenerationRunEventRow[]).map(
    generationRunEventRowToSnapshot,
  );
}
