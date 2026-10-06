export type PendingClientToolCall = {
  toolName: 'build_parametric_model' | 'answer_user';
  toolCallId: string;
  input: unknown;
};

type ToolPartLike = {
  type: string;
  state?: string;
  toolCallId?: unknown;
  input?: unknown;
};

type MessageLike = {
  role: string;
  parts: readonly ToolPartLike[];
};

/**
 * Return unresolved Brepia client tools only when the persisted branch leaf is
 * an assistant that is currently waiting for the browser to execute a tool.
 *
 * Historical dangling rows can remain in conversation history after the
 * server-side sanitizer made a later turn usable. Likewise, when a newer user
 * row is already the leaf, the preceding assistant is no longer the turn the
 * browser should resume. Requiring the actual leaf to be an assistant avoids
 * rebuilding either kind of stale artifact.
 */
export function pendingClientToolCalls(
  messages: readonly MessageLike[],
): PendingClientToolCall[] {
  const leaf = messages.at(-1);
  if (!leaf || leaf.role !== 'assistant') return [];

  const pending: PendingClientToolCall[] = [];
  for (const part of leaf.parts) {
    if (
      (part.type === 'tool-build_parametric_model' ||
        part.type === 'tool-answer_user') &&
      part.state === 'input-available' &&
      typeof part.toolCallId === 'string' &&
      'input' in part
    ) {
      pending.push({
        toolName:
          part.type === 'tool-build_parametric_model'
            ? 'build_parametric_model'
            : 'answer_user',
        toolCallId: part.toolCallId,
        input: part.input,
      });
    }
  }
  return pending;
}

/** Filter persisted pending tools that have not already run in this client. */
export function pendingClientToolsNeedingRecovery(
  messages: readonly MessageLike[],
  handledToolCallIds: ReadonlySet<string>,
): PendingClientToolCall[] {
  return pendingClientToolCalls(messages).filter(
    (toolCall) => !handledToolCallIds.has(toolCall.toolCallId),
  );
}
