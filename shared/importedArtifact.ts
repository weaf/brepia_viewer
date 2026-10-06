import type { AppUIMessage, ImportedArtifactOrigin } from './chatAi.ts';
import type { ParametricArtifact } from './types.ts';

export type ImportedArtifactBaseline =
  { status: 'success' } | { status: 'error'; errorText: string };

export type ImportedArtifactMessageRow = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  parts: AppUIMessage['parts'];
  metadata: AppUIMessage['metadata'];
  parent_message_id: string | null;
};

export function buildImportedArtifactMessages({
  conversationId,
  userMessageId,
  assistantMessageId,
  toolCallId,
  artifact,
  origin,
  baseline,
}: {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  toolCallId: string;
  artifact: ParametricArtifact;
  origin: ImportedArtifactOrigin;
  baseline: ImportedArtifactBaseline;
}): [ImportedArtifactMessageRow, ImportedArtifactMessageRow] {
  const user: ImportedArtifactMessageRow = {
    id: userMessageId,
    conversation_id: conversationId,
    role: 'user',
    parts: [
      {
        type: 'text',
        text: `Imported OpenSCAD model: ${origin.filename}`,
      },
    ],
    metadata: {},
    parent_message_id: null,
  };

  const importedPart: AppUIMessage['parts'][number] =
    baseline.status === 'success'
      ? {
          type: 'tool-build_parametric_model',
          toolCallId,
          state: 'output-available',
          input: artifact,
          output: {
            status: 'success',
            message: 'Imported OpenSCAD model.',
          },
        }
      : {
          type: 'tool-build_parametric_model',
          toolCallId,
          state: 'output-error',
          input: artifact,
          errorText: baseline.errorText,
        };

  const assistant: ImportedArtifactMessageRow = {
    id: assistantMessageId,
    conversation_id: conversationId,
    role: 'assistant',
    parts: [importedPart],
    metadata: { artifactOrigin: origin },
    parent_message_id: userMessageId,
  };

  return [user, assistant];
}
