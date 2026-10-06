import { supabase } from '@/lib/supabase';
import {
  buildBrepProjectBaselineMessages,
  createBrepProjectArtifact,
  getBrepProjectArtifact,
  withBrepProjectParameterValues,
} from '@shared/brepProjectArtifact';
import type { BrepProjectArtifactData } from '@shared/chatAi';
import type { BrepProject } from '@shared/brepProject';
import type { BrepProjectPackage } from '@shared/brepProjectPackage';
import {
  builtinProductTemplateCatalog,
  type BuiltinProductTemplateCatalog,
} from '@shared/productTemplateCatalog';
import { materializeBuiltinProductTemplate } from '@shared/productTemplateProjectCreation';
import type { ProjectOrigin } from '@shared/projectOrigin';

export async function createBrepProjectConversation({
  userId,
  title,
  project,
  projectOrigin,
}: {
  userId: string;
  title: string;
  project: BrepProject;
  projectOrigin?: ProjectOrigin;
}): Promise<string> {
  const conversationId = crypto.randomUUID();
  const artifact = createBrepProjectArtifact({
    title,
    version: 'v1',
    source: { kind: 'brep', source: project },
  });
  const { error: conversationError } = await supabase
    .from('conversations')
    .insert({
      id: conversationId,
      user_id: userId,
      title: artifact.title,
      type: 'parametric',
      settings: {
        parametricSourceKind: 'brep',
        ...(projectOrigin ? { projectOrigin } : {}),
      },
    });
  if (conversationError) throw conversationError;

  const assistantMessageId = crypto.randomUUID();
  const rows = buildBrepProjectBaselineMessages({
    conversationId,
    userMessageId: crypto.randomUUID(),
    assistantMessageId,
    artifact,
    projectCreation: projectOrigin,
  });
  const { error: messagesError } = await supabase.from('messages').insert(
    rows.map((row) => ({
      ...row,
      parts: JSON.parse(JSON.stringify(row.parts)),
      metadata: JSON.parse(JSON.stringify(row.metadata)),
    })),
  );
  if (messagesError) {
    await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', userId);
    throw messagesError;
  }

  const { error: leafError } = await supabase
    .from('conversations')
    .update({ current_message_leaf_id: assistantMessageId })
    .eq('id', conversationId)
    .eq('user_id', userId);
  if (leafError) {
    // Project creation is one logical operation. Messages already exist at
    // this point, so leaving the conversation behind while reporting failure
    // would make a retry create a duplicate project. Deleting the conversation
    // cascades to its baseline messages and keeps creation fail-closed.
    await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', userId);
    throw leafError;
  }
  return conversationId;
}

export async function createBrepProjectConversationFromTemplate({
  userId,
  templateId,
  templateVersion,
  catalog = builtinProductTemplateCatalog,
}: {
  userId: string;
  templateId: string;
  templateVersion: number;
  catalog?: BuiltinProductTemplateCatalog;
}): Promise<string> {
  const template = catalog.requireExact({
    id: templateId,
    version: templateVersion,
  });
  const materialized = await materializeBuiltinProductTemplate(template);
  return createBrepProjectConversation({
    userId,
    title: materialized.title,
    project: materialized.project,
    projectOrigin: materialized.projectOrigin,
  });
}

export async function importBrepProjectConversation({
  userId,
  projectPackage,
}: {
  userId: string;
  projectPackage: BrepProjectPackage;
}): Promise<string> {
  return createBrepProjectConversation({
    userId,
    title: projectPackage.title,
    project: projectPackage.source.source,
  });
}

async function persistNormalizedBrepProjectRevision({
  conversationId,
  parentMessageId,
  artifact,
  staleLabel,
}: {
  conversationId: string;
  parentMessageId: string;
  artifact: BrepProjectArtifactData;
  staleLabel: string;
}): Promise<{ messageId: string; artifact: BrepProjectArtifactData }> {
  const messageId = crypto.randomUUID();
  const { error: messageError } = await supabase.from('messages').insert({
    id: messageId,
    conversation_id: conversationId,
    role: 'assistant',
    parent_message_id: parentMessageId,
    parts: JSON.parse(
      JSON.stringify([{ type: 'data-brep-project', data: artifact }]),
    ),
    metadata: {},
  });
  if (messageError) throw messageError;

  // Do not let an older tab/async commit replace a newer active source. The
  // orphaned immutable message is valid branch evidence and can be selected.
  const { data, error: leafError } = await supabase
    .from('conversations')
    .update({ current_message_leaf_id: messageId })
    .eq('id', conversationId)
    .eq('current_message_leaf_id', parentMessageId)
    .select('id');
  if (leafError) throw leafError;
  if (data?.length) return { messageId, artifact };

  // Some local Supabase RLS configurations perform the update but do not
  // return its selected row. Confirm the exact active leaf before reporting a
  // lost CAS race; accepting an empty update response directly would make the
  // UI reject a revision that is already the persisted active source.
  const { data: confirmed, error: confirmationError } = await supabase
    .from('conversations')
    .select('current_message_leaf_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (confirmationError) throw confirmationError;
  if (confirmed?.current_message_leaf_id !== messageId) {
    throw new Error(
      `BRep project changed before this ${staleLabel} revision could be activated.`,
    );
  }
  return { messageId, artifact };
}

export async function persistBrepProjectSourceRevision({
  conversationId,
  parentMessageId,
  artifact,
  project,
}: {
  conversationId: string;
  parentMessageId: string;
  artifact: BrepProjectArtifactData;
  project: BrepProject;
}): Promise<{ messageId: string; artifact: BrepProjectArtifactData }> {
  const nextArtifact = createBrepProjectArtifact({
    ...artifact,
    source: { kind: 'brep', source: project },
  });
  return persistNormalizedBrepProjectRevision({
    conversationId,
    parentMessageId,
    artifact: nextArtifact,
    staleLabel: 'feature',
  });
}

export async function persistBrepProjectParameterRevision({
  conversationId,
  parentMessageId,
  artifact,
  parameterValues,
}: {
  conversationId: string;
  parentMessageId: string;
  artifact: BrepProjectArtifactData;
  parameterValues: Record<string, number>;
}): Promise<{ messageId: string; artifact: BrepProjectArtifactData }> {
  const nextArtifact = createBrepProjectArtifact({
    ...artifact,
    source: {
      kind: 'brep',
      source: withBrepProjectParameterValues(
        artifact.source.source,
        parameterValues,
      ),
    },
  });
  return persistNormalizedBrepProjectRevision({
    conversationId,
    parentMessageId,
    artifact: nextArtifact,
    staleLabel: 'parameter',
  });
}

export async function selectBrepProjectRevision({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string;
}): Promise<void> {
  const revision = await requireBrepProjectRevision(conversationId, messageId);
  if (!revision) {
    throw new Error('BRep source revision was not found in this conversation.');
  }
  const { error } = await supabase
    .from('conversations')
    .update({ current_message_leaf_id: messageId })
    .eq('id', conversationId);
  if (error) throw error;
}

async function requireBrepProjectRevision(
  conversationId: string,
  messageId: string,
) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, parent_message_id, role, parts')
    .eq('id', messageId)
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const artifact = getBrepProjectArtifact(data.parts);
  return artifact
    ? { id: data.id, parentMessageId: data.parent_message_id, artifact }
    : null;
}

export function hiddenBrepRevisionIds(settings: unknown): string[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return [];
  }
  const value = (settings as { brepHiddenRevisionIds?: unknown })
    .brepHiddenRevisionIds;
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is string => typeof item === 'string')),
  );
}

/**
 * Product-level revision deletion is intentionally a safe removal from the
 * revision picker, not a physical message DELETE. BRep source revisions are
 * immutable lineage nodes and parent_message_id has no database FK that could
 * protect descendants from being orphaned by arbitrary deletion. Keeping the
 * underlying node preserves branch/retry/source ancestry while letting users
 * clean experimental revisions out of the working UI.
 */
export async function removeBrepProjectRevisionFromHistory({
  conversationId,
  messageId,
  activeRevisionId,
}: {
  conversationId: string;
  messageId: string;
  activeRevisionId: string;
}): Promise<void> {
  if (messageId === activeRevisionId) {
    throw new Error('Switch to another BRep revision before deleting this one.');
  }
  const revision = await requireBrepProjectRevision(conversationId, messageId);
  if (!revision) {
    throw new Error('BRep source revision was not found in this conversation.');
  }

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('settings')
    .eq('id', conversationId)
    .single();
  if (conversationError) throw conversationError;

  const currentSettings =
    conversation.settings &&
    typeof conversation.settings === 'object' &&
    !Array.isArray(conversation.settings)
      ? conversation.settings
      : {};
  const hidden = hiddenBrepRevisionIds(currentSettings);
  if (hidden.includes(messageId)) return;

  const nextSettings = {
    ...currentSettings,
    brepHiddenRevisionIds: [...hidden, messageId],
  };
  const { error: updateError } = await supabase
    .from('conversations')
    .update({ settings: JSON.parse(JSON.stringify(nextSettings)) })
    .eq('id', conversationId);
  if (updateError) throw updateError;
}

export async function restoreBrepProjectRevision({
  conversationId,
  sourceMessageId,
}: {
  conversationId: string;
  sourceMessageId: string;
}): Promise<string> {
  const source = await requireBrepProjectRevision(
    conversationId,
    sourceMessageId,
  );
  if (!source) {
    throw new Error('BRep source revision was not found in this conversation.');
  }
  const restoredArtifact = createBrepProjectArtifact(source.artifact);
  const restoredMessageId = crypto.randomUUID();
  const { error: messageError } = await supabase.from('messages').insert({
    id: restoredMessageId,
    conversation_id: conversationId,
    role: 'assistant',
    parent_message_id: source.parentMessageId,
    parts: JSON.parse(
      JSON.stringify([{ type: 'data-brep-project', data: restoredArtifact }]),
    ),
    metadata: {},
  });
  if (messageError) throw messageError;
  await selectBrepProjectRevision({
    conversationId,
    messageId: restoredMessageId,
  });
  return restoredMessageId;
}
