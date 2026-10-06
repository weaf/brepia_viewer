import { initializeConversationWorkspace } from './conversationWorkspace';
import { syncConversationAgentHistory } from './conversationWorkspaceAgentHistory';
import { syncConversationGeneratedMeshes } from './conversationWorkspaceGeneratedMeshes';
import { syncConversationInputArtifacts } from './conversationWorkspaceInputs';
import { syncConversationModelSources } from './conversationWorkspaceModels';
import { syncConversationRenderArtifacts } from './conversationWorkspaceRenders';
import { getAnonSupabaseClient } from './supabaseClient';
import { logError } from './serverLog';

type ConversationWorkspaceRow = {
  id: string;
  title: string | null;
  type: string | null;
  created_at: string | null;
  updated_at: string | null;
  current_message_leaf_id: string | null;
  verified_owner_user_id?: string;
};

type WorkspaceInitializer = typeof initializeConversationWorkspace;
type ConversationInputSync = typeof syncConversationInputArtifacts;
type ConversationGeneratedMeshSync = typeof syncConversationGeneratedMeshes;
type ConversationModelSync = typeof syncConversationModelSources;
type ConversationRenderSync = typeof syncConversationRenderArtifacts;
type ConversationAgentHistorySync = typeof syncConversationAgentHistory;

type ConversationLoader = (
  request: Request,
  conversationId: string,
) => Promise<ConversationWorkspaceRow | null>;

type WorkspaceLifecycleDependencies = {
  loadConversation?: ConversationLoader;
  initializeWorkspace?: WorkspaceInitializer;
  syncInputs?: ConversationInputSync;
  syncGeneratedMeshes?: ConversationGeneratedMeshSync;
  syncModels?: ConversationModelSync;
  syncRenders?: ConversationRenderSync;
  syncAgents?: ConversationAgentHistorySync;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Only generation requests create/update workspaces. Cancellation and malformed
 * requests are deliberately ignored and left to the normal chat handler.
 */
export function conversationIdFromChatWorkspaceRequest(
  body: unknown,
): string | null {
  if (!isRecord(body) || body.action === 'cancel') return null;
  return typeof body.conversationId === 'string' && body.conversationId
    ? body.conversationId
    : null;
}

async function loadOwnedConversation(
  request: Request,
  conversationId: string,
): Promise<ConversationWorkspaceRow | null> {
  const supabase = getAnonSupabaseClient({
    global: {
      headers: { Authorization: request.headers.get('Authorization') ?? '' },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;

  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, type, created_at, updated_at, current_message_leaf_id')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    title: data.title,
    type: data.type,
    created_at: data.created_at,
    updated_at: data.updated_at,
    current_message_leaf_id: data.current_message_leaf_id,
    verified_owner_user_id: user.id,
  };
}

/**
 * Synchronize the persistent local workspace with the authoritative
 * conversation row before a chat generation starts. The request is cloned so
 * the downstream AI handler can still consume its original body.
 *
 * After initialization, user-uploaded inputs are mirrored. Creative
 * conversations mirror successful generated meshes into `models/generated/`.
 * Parametric conversations revision successful OpenSCAD sources from the
 * active branch and mirror the build-time preview/inspection images already
 * stored in Supabase. Finally, persisted OpenCode/Codex tool calls from the
 * active branch are backfilled into conversation-scoped agent session/turn
 * diagnostics. All operations are idempotent.
 */
export async function syncConversationWorkspaceForChatRequest(
  request: Request,
  dependencies: WorkspaceLifecycleDependencies = {},
): Promise<boolean> {
  if (request.method !== 'POST') return false;

  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  const conversationId = conversationIdFromChatWorkspaceRequest(body);
  if (!conversationId) return false;

  const loadConversation =
    dependencies.loadConversation ?? loadOwnedConversation;
  const initializeWorkspace =
    dependencies.initializeWorkspace ?? initializeConversationWorkspace;
  const syncInputs = dependencies.syncInputs ?? syncConversationInputArtifacts;
  const syncGeneratedMeshes =
    dependencies.syncGeneratedMeshes ?? syncConversationGeneratedMeshes;
  const syncModels = dependencies.syncModels ?? syncConversationModelSources;
  const syncRenders =
    dependencies.syncRenders ?? syncConversationRenderArtifacts;
  const syncAgents = dependencies.syncAgents ?? syncConversationAgentHistory;

  const conversation = await loadConversation(request, conversationId);
  if (!conversation) return false;

  await initializeWorkspace({
    conversationId: conversation.id,
    title: conversation.title,
    type: conversation.type,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
  });
  await syncInputs(request, conversation.id);
  if (conversation.type === 'creative') {
    await syncGeneratedMeshes(request, conversation.id);
  }
  if (conversation.type === 'parametric') {
    await syncModels(
      request,
      conversation.id,
      conversation.current_message_leaf_id,
    );
    await syncRenders(
      request,
      conversation.id,
      undefined,
      conversation.verified_owner_user_id,
    );
  }
  await syncAgents(
    request,
    conversation.id,
    conversation.current_message_leaf_id,
  );
  return true;
}

/**
 * Route-level guard: workspace persistence is valuable but must never make the
 * stable chat path unavailable. Filesystem/configuration/storage failures are
 * logged and the original request continues unchanged.
 */
export async function withConversationWorkspaceLifecycle(
  request: Request,
  next: (request: Request) => Promise<Response>,
  dependencies: WorkspaceLifecycleDependencies = {},
): Promise<Response> {
  try {
    await syncConversationWorkspaceForChatRequest(request, dependencies);
  } catch (error) {
    logError(error, {
      functionName: 'conversation-workspace',
      statusCode: 500,
      additionalContext: { operation: 'sync_chat_workspace' },
    });
  }

  return next(request);
}
