import { supabase } from '@/lib/supabase';
import {
  createBrepProjectArtifact,
  withBrepProjectParameterValues,
} from '@shared/brepProjectArtifact';
import type { BrepProjectArtifactData } from '@shared/chatAi';
import type { BrepParameterValues } from '@shared/brepProvider';

export function buildBrepGrasshopperImportedArtifact(
  artifact: BrepProjectArtifactData,
  parameterValues: BrepParameterValues,
): BrepProjectArtifactData {
  return createBrepProjectArtifact({
    ...artifact,
    source: {
      kind: 'brep',
      source: withBrepProjectParameterValues(
        artifact.source.source,
        parameterValues,
      ),
    },
  });
}

/**
 * Persist a deterministically validated GHX parameter edit as an immutable
 * BRep revision without changing the active conversation leaf. The generic
 * messages AFTER INSERT trigger advances the leaf to every newly inserted
 * message, so restore the previously effective leaf with a compare-and-swap.
 * A genuinely newer concurrent leaf wins and is never overwritten.
 */
export async function persistBrepGrasshopperImportedRevision({
  conversationId,
  parentMessageId,
  activeLeafId,
  artifact,
  parameterValues,
}: {
  conversationId: string;
  parentMessageId: string;
  activeLeafId: string;
  artifact: BrepProjectArtifactData;
  parameterValues: BrepParameterValues;
}): Promise<{ messageId: string; artifact: BrepProjectArtifactData }> {
  const nextArtifact = buildBrepGrasshopperImportedArtifact(
    artifact,
    parameterValues,
  );
  const messageId = crypto.randomUUID();
  const { error } = await supabase.from('messages').insert({
    id: messageId,
    conversation_id: conversationId,
    role: 'assistant',
    parent_message_id: parentMessageId,
    parts: JSON.parse(
      JSON.stringify([{ type: 'data-brep-project', data: nextArtifact }]),
    ),
    metadata: {},
  });
  if (error) throw error;

  const { data: restored, error: leafError } = await supabase
    .from('conversations')
    .update({ current_message_leaf_id: activeLeafId })
    .eq('id', conversationId)
    .eq('current_message_leaf_id', messageId)
    .select('id');
  if (leafError) throw leafError;
  if (restored?.length) return { messageId, artifact: nextArtifact };

  // Some local Supabase RLS configurations perform an UPDATE but do not return
  // its selected row. Confirm the final leaf. A different leaf is also valid:
  // it means a genuinely newer concurrent message won the race after import.
  const { data: confirmed, error: confirmationError } = await supabase
    .from('conversations')
    .select('current_message_leaf_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (confirmationError) throw confirmationError;
  if (confirmed?.current_message_leaf_id === messageId) {
    throw new Error(
      'GHX import created a revision but could not preserve the active conversation leaf.',
    );
  }

  return { messageId, artifact: nextArtifact };
}
