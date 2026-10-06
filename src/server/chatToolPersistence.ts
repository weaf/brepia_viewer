/**
 * Pure logic for the chat persistence boundary, kept free of `@shared` and SDK
 * imports so it's unit-testable in isolation (`deno test
 * src/server/chatToolPersistence.test.ts`). The two concerns here are the only
 * things standing between a normal multi-step parametric turn and a
 * permanently-bricked conversation, so they're worth isolating and testing
 * directly. See `aiChat.ts` for the call sites.
 *
 * Background: the parametric tools (`build_parametric_model`, `answer_user`)
 * have no server `execute` — the browser is the sole authority for their
 * result. The server only ever sees them `input-available` (pending). If a
 * pending tool call ends up persisted in the branch, `convertToLanguageModelPrompt`
 * (inside `streamText` / the title+suggestion `generateText` calls) throws
 * `MissingToolResultsError` on the NEXT send and 500s it.
 */

/** Minimal structural shape of a message part — all we need to reason about. */
export type ToolPartLike = { type: string; state?: string };

export const DANGLING_TOOL_ERROR_TEXT =
  'Tool execution did not complete (the previous request was interrupted).';

export const EMPTY_ASSISTANT_RESPONSE = 'empty-assistant-response' as const;
export type PendingClientToolState = boolean | typeof EMPTY_ASSISTANT_RESPONSE;

/**
 * The messages table intentionally rejects rows whose `parts` array is empty
 * (unless the legacy `content` column is populated). AI-SDK can still invoke
 * the UI-message `onFinish` callback with an empty response after a provider
 * fails before emitting any assistant payload. Treat that as a transport/model
 * failure only — there is no assistant message to persist.
 */
export function hasPersistableMessageParts(parts: readonly unknown[]): boolean {
  return parts.length > 0;
}

/**
 * A message part that carries a tool call — either a statically-typed `tool-*`
 * part or the SDK's `dynamic-tool` part. Shared by the dangling check and the
 * pending check so the two can never drift out of sync (an asymmetry would let
 * a pending `dynamic-tool` take the clobbering write path).
 */
function isToolPart(part: ToolPartLike): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

/**
 * A tool-call part persisted without a result (stuck at `input-streaming` /
 * `input-available`).
 */
export function isDanglingToolPart(part: ToolPartLike): boolean {
  return (
    isToolPart(part) &&
    (part.state === 'input-streaming' || part.state === 'input-available')
  );
}

/**
 * Rewrite dangling tool calls to `output-error` so the history is valid — the
 * model receives a "tool did not complete" result and can recover. SAFETY NET
 * for genuine interruptions (tab close / crash / failed persist); the common
 * cause (the `onFinish` clobber) is prevented at the write side.
 */
export function resolveDanglingToolParts<T extends ToolPartLike>(
  parts: readonly T[],
): T[] {
  return parts.map((part) =>
    isDanglingToolPart(part)
      ? ({
          ...part,
          state: 'output-error',
          errorText: DANGLING_TOOL_ERROR_TEXT,
        } as unknown as T)
      : part,
  );
}

/**
 * Does this turn end awaiting a CLIENT-side tool result?
 *
 * `true` means the model emitted a client-owned tool call whose output has not
 * been attached yet. `false` means there is no such pending tool. The explicit
 * `EMPTY_ASSISTANT_RESPONSE` sentinel means the provider failed/finished before
 * emitting any assistant payload at all. It is intentionally truthy so the
 * existing aiChat call site also skips post-response suggestion generation,
 * while `decidePersistAction` can distinguish it from a genuine pending tool.
 */
export function hasPendingClientToolCall(
  parts: readonly ToolPartLike[],
): PendingClientToolState {
  if (!hasPersistableMessageParts(parts)) return EMPTY_ASSISTANT_RESPONSE;
  return parts.some(
    (part) => isToolPart(part) && part.state === 'input-available',
  );
}

export type PersistAction = 'insert' | 'update' | 'skip';

/**
 * Decide what the server's `onFinish` should do with the response message.
 *
 * - `insert`  — new assistant row (the leaf was a user message). Always write,
 *   even with a pending tool call: the row must exist for the client's
 *   `onToolOutput` UPDATE to land, and the client resolves it before the
 *   auto-resubmit re-reads the branch.
 * - `update`  — continuation with everything resolved (or pure text / no
 *   tools). Safe to write; the client isn't persisting this turn.
 * - `skip`    — either an empty provider response (there is no valid assistant
 *   row to persist) or a continuation that still ends with a pending CLIENT
 *   tool. In the latter case the browser resolves and persists the
 *   `output-available` version itself; a delayed server write could land last
 *   and clobber it back to `input-available`, leaving a dangling tool call that
 *   500s the next send. Defer to the client.
 */
export function decidePersistAction({
  isContinuation,
  hasPendingToolCall,
}: {
  isContinuation: boolean;
  hasPendingToolCall: PendingClientToolState;
}): PersistAction {
  if (hasPendingToolCall === EMPTY_ASSISTANT_RESPONSE) return 'skip';
  if (!isContinuation) return 'insert';
  return hasPendingToolCall ? 'skip' : 'update';
}
