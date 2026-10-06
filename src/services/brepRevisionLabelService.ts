import { supabase } from '@/lib/supabase';
import { getBrepProjectArtifact } from '@shared/brepProjectArtifact';

export const BREP_REVISION_LABEL_MAX_LENGTH = 80;

function settingsRecord(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === 'object' && !Array.isArray(settings)
    ? (settings as Record<string, unknown>)
    : {};
}

export function brepRevisionLabels(settings: unknown): Record<string, string> {
  const value = settingsRecord(settings).brepRevisionLabels;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).flatMap(([id, label]) => {
      if (typeof label !== 'string') return [];
      const normalized = label.trim();
      return normalized ? [[id, normalized]] : [];
    }),
  );
}

async function requireBrepRevision(
  conversationId: string,
  messageId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, parts')
    .eq('id', messageId)
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant')
    .maybeSingle();
  if (error) throw error;
  if (!data || !getBrepProjectArtifact(data.parts)) {
    throw new Error('BRep source revision was not found in this conversation.');
  }
}

/**
 * Rename is presentation-only. The immutable revision message and canonical
 * BRep artifact are never updated; labels live in conversation settings keyed
 * by the revision message ID.
 */
export async function renameBrepProjectRevision({
  conversationId,
  messageId,
  label,
}: {
  conversationId: string;
  messageId: string;
  label: string;
}): Promise<void> {
  const normalized = label.trim();
  if (normalized.length > BREP_REVISION_LABEL_MAX_LENGTH) {
    throw new Error(
      `Revision names can be at most ${BREP_REVISION_LABEL_MAX_LENGTH} characters.`,
    );
  }

  await requireBrepRevision(conversationId, messageId);

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('settings')
    .eq('id', conversationId)
    .single();
  if (conversationError) throw conversationError;

  const currentSettings = settingsRecord(conversation.settings);
  const labels = brepRevisionLabels(currentSettings);
  if (normalized) labels[messageId] = normalized;
  else delete labels[messageId];

  const nextSettings: Record<string, unknown> = { ...currentSettings };
  if (Object.keys(labels).length > 0) nextSettings.brepRevisionLabels = labels;
  else delete nextSettings.brepRevisionLabels;

  const { error: updateError } = await supabase
    .from('conversations')
    .update({ settings: JSON.parse(JSON.stringify(nextSettings)) })
    .eq('id', conversationId);
  if (updateError) throw updateError;
}
