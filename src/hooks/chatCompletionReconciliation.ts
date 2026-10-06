export type ChatCompletionPartLike = {
  type: string;
  state?: string;
  text?: unknown;
};

export type ChatCompletionMessageLike = {
  id: string;
  role: string;
  parts: readonly ChatCompletionPartLike[];
  metadata?: {
    artifactOrigin?: { type?: unknown };
  } | null;
};

function isUnresolvedPart(part: ChatCompletionPartLike): boolean {
  return (
    part.state === 'input-streaming' ||
    part.state === 'input-available' ||
    part.state === 'streaming'
  );
}

function hasNonEmptyText(part: ChatCompletionPartLike): boolean {
  return (
    part.type === 'text' &&
    typeof part.text === 'string' &&
    part.text.trim().length > 0 &&
    part.state !== 'streaming'
  );
}

function isResolvedAnswerUser(part: ChatCompletionPartLike): boolean {
  return (
    part.type === 'tool-answer_user' &&
    (part.state === 'output-available' || part.state === 'output-error')
  );
}

/**
 * Decide whether one assistant message is semantically terminal for the
 * client-side Brepia chat lifecycle.
 *
 * A resolved build_parametric_model by itself is deliberately NOT terminal:
 * it normally triggers the browser -> server auto-continuation that lets the
 * agent inspect the build result and either revise again or finish. Imported
 * synthetic baselines are the explicit exception: they intentionally start as
 * a completed build/error without an AI turn, so no continuation is expected.
 * Otherwise the turn is terminal only when answer_user is resolved, or when a
 * completed text reply appears after the final build (the OpenCode/Codex
 * adapters can finish this way). Messages without a parametric build use normal
 * resolved text/tool completion semantics.
 */
export function isTerminalAssistantMessage(
  message: ChatCompletionMessageLike | undefined,
): boolean {
  if (!message || message.role !== 'assistant' || message.parts.length === 0) {
    return false;
  }
  if (message.parts.some(isUnresolvedPart)) return false;

  if (message.metadata?.artifactOrigin?.type === 'import') return true;

  const lastBuildIndex = message.parts.reduce(
    (last, part, index) =>
      part.type === 'tool-build_parametric_model' ? index : last,
    -1,
  );

  if (lastBuildIndex >= 0) {
    const tail = message.parts.slice(lastBuildIndex + 1);
    return tail.some(isResolvedAnswerUser) || tail.some(hasNonEmptyText);
  }

  return (
    message.parts.some(isResolvedAnswerUser) ||
    message.parts.some(hasNonEmptyText) ||
    message.parts.some(
      (part) =>
        part.type.startsWith('tool-') &&
        (part.state === 'output-available' || part.state === 'output-error'),
    )
  );
}

/**
 * A persisted terminal assistant may repair a locally stuck submitted/
 * streaming Chat only when it demonstrably completes the SAME live turn.
 * This prevents an older completed assistant from cancelling a genuinely new
 * request that has not reached the DB yet.
 *
 * Parametric auto-continuation can append more than one assistant row for a
 * single user turn: the browser may still be streaming the build/tool assistant
 * while persistence already contains a later assistant with the final answer.
 * Prefer anchoring on the live assistant id when that row reached persistence.
 * A mobile connection can disappear before that exact local assistant snapshot
 * is persisted, however, while the server still saves a different assistant
 * chain for the same user turn. In that case fall back to the nearest preceding
 * live user id. Recovery is allowed only when that user exists in the persisted
 * branch and no newer user message appears after it.
 */
export function persistedCompletionCoversLiveTurn(
  liveMessages: readonly ChatCompletionMessageLike[],
  persistedMessages: readonly ChatCompletionMessageLike[],
): boolean {
  const liveLast = liveMessages.at(-1);
  const persistedLast = persistedMessages.at(-1);
  if (!liveLast || !isTerminalAssistantMessage(persistedLast)) return false;

  if (liveLast.role === 'assistant') {
    if (liveLast.id === persistedLast?.id) return true;

    const assistantIndex = persistedMessages.findIndex(
      (message) => message.id === liveLast.id,
    );
    if (assistantIndex >= 0) {
      if (assistantIndex >= persistedMessages.length - 1) return false;
      return !persistedMessages
        .slice(assistantIndex + 1)
        .some((message) => message.role === 'user');
    }

    const liveUser = [...liveMessages]
      .reverse()
      .find((message) => message.role === 'user');
    if (!liveUser) return false;

    const userIndex = persistedMessages.findIndex(
      (message) => message.id === liveUser.id,
    );
    if (userIndex < 0 || userIndex >= persistedMessages.length - 1) {
      return false;
    }

    return !persistedMessages
      .slice(userIndex + 1)
      .some((message) => message.role === 'user');
  }

  if (liveLast.role === 'user') {
    const userIndex = persistedMessages.findIndex(
      (message) => message.id === liveLast.id,
    );
    return userIndex >= 0 && userIndex < persistedMessages.length - 1;
  }

  return false;
}
