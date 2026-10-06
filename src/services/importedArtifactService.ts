import { supabase } from '@/lib/supabase';
import type { ParametricArtifact } from '@shared/types';
import type { ImportedArtifactOrigin } from '@shared/chatAi';
import {
  buildImportedArtifactMessages,
  type ImportedArtifactBaseline,
} from '@shared/importedArtifact';

export type PersistImportedArtifactResult = {
  userMessageId: string;
  assistantMessageId: string;
  toolCallId: string;
};

export async function persistImportedArtifact({
  conversationId,
  artifact,
  origin,
  baseline,
}: {
  conversationId: string;
  artifact: ParametricArtifact;
  origin: ImportedArtifactOrigin;
  baseline: ImportedArtifactBaseline;
}): Promise<PersistImportedArtifactResult> {
  const userMessageId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  const toolCallId = `tool_import_${crypto.randomUUID()}`;

  const rows = buildImportedArtifactMessages({
    conversationId,
    userMessageId,
    assistantMessageId,
    toolCallId,
    artifact,
    origin,
    baseline,
  });

  const { error } = await supabase.from('messages').insert(
    rows.map((row) => ({
      ...row,
      parts: JSON.parse(JSON.stringify(row.parts)),
      metadata: JSON.parse(JSON.stringify(row.metadata ?? {})),
    })),
  );
  if (error) throw error;

  // The normal INSERT trigger advances the leaf for each inserted message.
  // A multi-row INSERT should therefore end at the assistant row, but make
  // that invariant explicit instead of depending on backend row-processing
  // order. This also makes the imported two-row baseline deterministic for
  // the server's parent-chain walk immediately after navigation.
  const { error: leafError } = await supabase
    .from('conversations')
    .update({ current_message_leaf_id: assistantMessageId })
    .eq('id', conversationId);
  if (leafError) throw leafError;

  return { userMessageId, assistantMessageId, toolCallId };
}
