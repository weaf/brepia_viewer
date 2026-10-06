import type { Database } from '@shared/database';
import {
  GENERATION_RUN_PHASES,
  applyGenerationRunTransition,
  isGenerationRunTerminal,
  type GenerationRunPhase,
  type GenerationRunSnapshot,
} from '@shared/generationRun';
import { getBrepProjectArtifact } from '@shared/brepProjectArtifact';
import { normalizeBrepProject, type BrepProject } from '@shared/brepProject';
import { getServiceRoleSupabaseClient } from './supabaseClient';
import {
  generationRunRowToSnapshot,
  generationRunUpdateFor,
  transitionGenerationRun,
} from './generationRunPersistence';

type GenerationRunRow = Database['public']['Tables']['generation_runs']['Row'];
type ServiceRoleClient = ReturnType<typeof getServiceRoleSupabaseClient>;

export type BrepGenerationPreviewContext = {
  conversationId: string;
  revisionMessageId: string;
};

export class BrepGenerationPreviewError extends Error {
  constructor(
    public readonly code:
      | 'invalid_generation_context'
      | 'generation_preview_not_ready'
      | 'generation_preview_conflict'
      | 'generation_revision_mismatch',
    public readonly httpStatus: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'BrepGenerationPreviewError';
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const phaseIndex = new Map<GenerationRunPhase, number>(
  GENERATION_RUN_PHASES.map((phase, index) => [phase, index]),
);
const PREVIEW_LINK_WAIT_ATTEMPTS = 20;
const PREVIEW_LINK_WAIT_MS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeBrepGenerationPreviewContext(
  value: unknown,
): BrepGenerationPreviewContext | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    throw new BrepGenerationPreviewError(
      'invalid_generation_context',
      400,
      'BRep generation context must be an object.',
    );
  }

  const conversationId = value.conversationId;
  const revisionMessageId = value.revisionMessageId;
  if (
    typeof conversationId !== 'string' ||
    !UUID_PATTERN.test(conversationId) ||
    typeof revisionMessageId !== 'string' ||
    !UUID_PATTERN.test(revisionMessageId)
  ) {
    throw new BrepGenerationPreviewError(
      'invalid_generation_context',
      400,
      'BRep generation context requires valid conversation and revision IDs.',
    );
  }

  return { conversationId, revisionMessageId };
}

export function nextBrepPreviewClaimPhase(
  current: GenerationRunPhase,
): GenerationRunPhase {
  return (phaseIndex.get(current) ?? -1) >
    (phaseIndex.get('evaluation_requested') ?? -1)
    ? current
    : 'evaluation_requested';
}

export function isRetryableBrepPreviewErrorCode(code: string): boolean {
  return (
    code === 'provider_unavailable' ||
    code === 'capacity_exceeded' ||
    code === 'evaluation_timeout' ||
    code === 'evaluation_cancelled'
  );
}

async function loadLinkedGenerationRun(
  client: ServiceRoleClient,
  userId: string,
  context: BrepGenerationPreviewContext,
): Promise<GenerationRunSnapshot | undefined> {
  const { data, error } = await client
    .from('generation_runs')
    .select('*')
    .eq('user_id', userId)
    .eq('conversation_id', context.conversationId)
    .eq('response_message_id', context.revisionMessageId)
    .eq('kind', 'brep')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`BRep generation run lookup failed: ${error.message}`);
  }
  return data ? generationRunRowToSnapshot(data as GenerationRunRow) : undefined;
}

async function waitForPreviewReadyRun(
  client: ServiceRoleClient,
  userId: string,
  context: BrepGenerationPreviewContext,
): Promise<GenerationRunSnapshot | undefined> {
  let run = await loadLinkedGenerationRun(client, userId, context);
  if (!run) return undefined;

  for (let attempt = 0; attempt < PREVIEW_LINK_WAIT_ATTEMPTS; attempt += 1) {
    if (isGenerationRunTerminal(run.status)) return undefined;
    if (run.status === 'waiting_for_preview') return run;

    const runPhase = phaseIndex.get(run.phase) ?? -1;
    const evaluationPhase = phaseIndex.get('evaluation_requested') ?? -1;
    if (run.status === 'running' && runPhase >= evaluationPhase) {
      throw new BrepGenerationPreviewError(
        'generation_preview_conflict',
        409,
        'Native BRep preview is already being evaluated.',
      );
    }

    if (attempt === PREVIEW_LINK_WAIT_ATTEMPTS - 1) break;
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_LINK_WAIT_MS));
    run =
      (await loadLinkedGenerationRun(client, userId, context)) ?? run;
  }

  throw new BrepGenerationPreviewError(
    'generation_preview_not_ready',
    409,
    'Generated BRep revision is not ready for native preview yet.',
  );
}

async function assertAuthoritativeRevisionProject(
  client: ServiceRoleClient,
  context: BrepGenerationPreviewContext,
  project: BrepProject,
): Promise<void> {
  const { data, error } = await client
    .from('messages')
    .select('id, conversation_id, role, parts')
    .eq('id', context.revisionMessageId)
    .eq('conversation_id', context.conversationId)
    .single();

  if (error || !data || data.role !== 'assistant') {
    throw new BrepGenerationPreviewError(
      'generation_revision_mismatch',
      409,
      'The generated BRep revision could not be verified.',
    );
  }

  const artifact = getBrepProjectArtifact(data.parts);
  const authoritativeProject = artifact?.source.source;
  if (!authoritativeProject) {
    throw new BrepGenerationPreviewError(
      'generation_revision_mismatch',
      409,
      'The generated BRep revision has no authoritative project source.',
    );
  }

  const authoritative = JSON.stringify(normalizeBrepProject(authoritativeProject));
  const requested = JSON.stringify(normalizeBrepProject(project));
  if (authoritative !== requested) {
    throw new BrepGenerationPreviewError(
      'generation_revision_mismatch',
      409,
      'Native preview project does not match the generated BRep revision.',
    );
  }
}

async function claimPreviewRun(
  client: ServiceRoleClient,
  run: GenerationRunSnapshot,
): Promise<GenerationRunSnapshot> {
  const now = new Date().toISOString();
  const next = applyGenerationRunTransition(run, {
    sequence: run.sequence + 1,
    status: 'running',
    phase: nextBrepPreviewClaimPhase(run.phase),
    detail: 'Native BRep preview requested.',
    updatedAt: now,
  });

  const { data, error } = await client
    .from('generation_runs')
    .update(generationRunUpdateFor(next))
    .eq('id', run.id)
    .eq('user_id', run.userId)
    .eq('sequence', run.sequence)
    .eq('status', 'waiting_for_preview')
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`BRep preview run claim failed: ${error.message}`);
  }
  if (!data) {
    throw new BrepGenerationPreviewError(
      'generation_preview_conflict',
      409,
      'Native BRep preview was claimed by another request.',
    );
  }
  return generationRunRowToSnapshot(data as GenerationRunRow);
}

export class BrepGenerationPreviewLifecycle {
  private constructor(
    readonly id: string,
    readonly userId: string,
    readonly conversationId: string,
  ) {}

  static async begin({
    userId,
    context,
    project,
    client = getServiceRoleSupabaseClient(),
  }: {
    userId: string;
    context?: BrepGenerationPreviewContext;
    project: BrepProject;
    client?: ServiceRoleClient;
  }): Promise<BrepGenerationPreviewLifecycle | undefined> {
    if (!context) return undefined;

    const linkedRun = await waitForPreviewReadyRun(client, userId, context);
    if (!linkedRun) return undefined;

    await assertAuthoritativeRevisionProject(client, context, project);
    const claimed = await claimPreviewRun(client, linkedRun);
    const evaluating = await transitionGenerationRun(
      claimed.id,
      userId,
      {
        status: 'running',
        phase: 'evaluating_native',
        detail: 'Evaluating native BRep geometry.',
      },
      { client },
    );

    return new BrepGenerationPreviewLifecycle(
      evaluating.id,
      userId,
      evaluating.conversationId,
    );
  }

  preparingViewer(): Promise<GenerationRunSnapshot> {
    return transitionGenerationRun(this.id, this.userId, {
      status: 'running',
      phase: 'preparing_viewer',
      detail: 'Preparing native BRep viewer payload.',
    });
  }

  completed(): Promise<GenerationRunSnapshot> {
    const now = new Date().toISOString();
    return transitionGenerationRun(this.id, this.userId, {
      status: 'completed',
      phase: 'preview_ready',
      completedAt: now,
      detail: 'Native BRep preview payload is ready.',
    });
  }

  retryable(code: string): Promise<GenerationRunSnapshot> {
    return transitionGenerationRun(this.id, this.userId, {
      status: 'waiting_for_preview',
      detail: `Native BRep preview unavailable (${code}); retry available.`,
    });
  }

  failed(code: string): Promise<GenerationRunSnapshot> {
    const now = new Date().toISOString();
    return transitionGenerationRun(this.id, this.userId, {
      status: 'failed',
      completedAt: now,
      errorCode: code,
      detail: 'Native BRep preview failed.',
    });
  }
}
