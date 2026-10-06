import {
  normalizeOpenScadProject,
  type OpenScadProject,
} from '@shared/openScadProject';
import { isUnauthorizedError, json, requireUser } from './api';
import {
  initializeConversationWorkspace,
  type ConversationExportFormat,
} from './conversationWorkspace';
import { persistConversationExportArtifact } from './conversationWorkspaceExports';
import {
  conversationModelProjectSha256,
  findConversationModelRevisionByProjectSha,
  syncConversationModelSources,
} from './conversationWorkspaceModels';
import { syncConversationRenderArtifacts } from './conversationWorkspaceRenders';
import { getAnonSupabaseClient } from './supabaseClient';

export const CONVERSATION_WORKSPACE_ACTION_HEADER =
  'x-brepia-workspace-action' as const;
export const PERSIST_EXPORT_ACTION = 'persist-export' as const;

const MAX_EXPORT_BYTES = 100 * 1024 * 1024;
const MAX_PROJECT_JSON_CHARS = 2_000_000;

function exportFormat(
  value: FormDataEntryValue | null,
): ConversationExportFormat | null {
  return value === 'stl' || value === '3mf' || value === 'dxf' ? value : null;
}

function isBlobLike(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.arrayBuffer === 'function' &&
    typeof value.size === 'number'
  );
}

function parseProject(
  value: FormDataEntryValue | null,
): OpenScadProject | null {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > MAX_PROJECT_JSON_CHARS
  ) {
    return null;
  }
  try {
    return normalizeOpenScadProject(JSON.parse(value) as OpenScadProject);
  } catch {
    return null;
  }
}

export function isConversationWorkspaceExportRequest(
  request: Request,
): boolean {
  return (
    request.method === 'POST' &&
    request.headers.get(CONVERSATION_WORKSPACE_ACTION_HEADER) ===
      PERSIST_EXPORT_ACTION
  );
}

/**
 * Persist a browser-generated parametric export into the local conversation
 * workspace. This handler deliberately lives behind the already-registered
 * `/api/parametric-chat` route so adding workspace persistence never requires
 * hand-editing TanStack Router's generated route tree.
 */
export async function handleConversationWorkspaceExportRequest(
  request: Request,
): Promise<Response> {
  let user;
  try {
    user = await requireUser(request);
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return json({ error: 'Unauthorized' }, 401);
    }
    throw error;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Invalid multipart form data' }, 400);
  }

  const conversationId = form.get('conversationId');
  const format = exportFormat(form.get('format'));
  const project = parseProject(form.get('project'));
  const file = form.get('file');
  if (
    typeof conversationId !== 'string' ||
    !conversationId ||
    !format ||
    !project ||
    !isBlobLike(file)
  ) {
    return json({ error: 'Missing or invalid export fields' }, 400);
  }
  if (file.size <= 0 || file.size > MAX_EXPORT_BYTES) {
    return json({ error: 'Export file size is invalid' }, 413);
  }

  const supabase = getAnonSupabaseClient({
    global: {
      headers: { Authorization: request.headers.get('Authorization') ?? '' },
    },
  });
  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('id, title, type, created_at, updated_at, current_message_leaf_id')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!conversation) return json({ error: 'Conversation not found' }, 404);
  if (conversation.type !== 'parametric') {
    return json(
      { error: 'Revision exports require a parametric conversation' },
      409,
    );
  }

  await initializeConversationWorkspace({
    conversationId: conversation.id,
    title: conversation.title,
    type: conversation.type,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
  });
  await syncConversationModelSources(
    request,
    conversation.id,
    conversation.current_message_leaf_id,
  );
  await syncConversationRenderArtifacts(request, conversation.id);

  const projectSha256 = conversationModelProjectSha256(project);
  const revision = await findConversationModelRevisionByProjectSha(
    conversation.id,
    projectSha256,
  );
  if (!revision) {
    // Parameter writes are asynchronous on the client. The browser retries
    // this exact race once; never attach bytes to a guessed revision because
    // that would corrupt the conversation's revision history.
    return json({ error: 'source_revision_not_found' }, 409);
  }

  const result = await persistConversationExportArtifact({
    conversationId: conversation.id,
    format,
    revision: revision.revision,
    projectSha256,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  return json(result);
}
