import { Chat } from '@ai-sdk/react';
import { useEffect, useMemo, useRef } from 'react';
import type { AppUIMessage } from '@shared/chatAi';
import { persistedCompletionCoversLiveTurn } from './chatCompletionReconciliation';
import {
  CONNECTION_INTERRUPTED_MESSAGE,
  userFacingChatError,
} from './chatErrorPresentation';
import { pendingClientToolsNeedingRecovery } from './chatPendingToolRecovery';

const MAX_CACHE_SIZE = 10;
const TOOL_CALL_COMMIT_RETRY_MS = 16;
const TOOL_CALL_COMMIT_MAX_ATTEMPTS = 8;

const chatCache = new Map<string, Chat<AppUIMessage>>();
type ReactChatInit = ConstructorParameters<typeof Chat<AppUIMessage>>[0];
type ToolCallCallbackArg = Parameters<
  NonNullable<ReactChatInit['onToolCall']>
>[0];

type CallbackRefs = {
  onError: { current: ReactChatInit['onError'] };
  onFinish: { current: ReactChatInit['onFinish'] };
  onData: { current: ReactChatInit['onData'] };
  onToolCall: { current: ReactChatInit['onToolCall'] };
  sendAutomaticallyWhen: {
    current: ReactChatInit['sendAutomaticallyWhen'];
  };
};

const callbackRefs = new Map<string, CallbackRefs>();
const handledToolCallIds = new Map<string, Set<string>>();
const scheduledToolCallIds = new Map<string, Set<string>>();
const cachedTransports = new Map<string, ReactChatInit['transport']>();

function refsFor(id: string): CallbackRefs {
  let refs = callbackRefs.get(id);
  if (!refs) {
    refs = {
      onError: { current: undefined },
      onFinish: { current: undefined },
      onData: { current: undefined },
      onToolCall: { current: undefined },
      sendAutomaticallyWhen: { current: undefined },
    };
    callbackRefs.set(id, refs);
  }
  return refs;
}

function handledToolsFor(id: string): Set<string> {
  let handled = handledToolCallIds.get(id);
  if (!handled) {
    handled = new Set<string>();
    handledToolCallIds.set(id, handled);
  }
  return handled;
}

function scheduledToolsFor(id: string): Set<string> {
  let scheduled = scheduledToolCallIds.get(id);
  if (!scheduled) {
    scheduled = new Set<string>();
    scheduledToolCallIds.set(id, scheduled);
  }
  return scheduled;
}

function touch(id: string) {
  const chat = chatCache.get(id);
  if (!chat) return;
  chatCache.delete(id);
  chatCache.set(id, chat);
}

function evictIfNeeded() {
  while (chatCache.size > MAX_CACHE_SIZE) {
    // Truthy-check the value would treat an empty-string id as iterator-end,
    // letting the cache grow unbounded. Use `done` instead so any string key
    // (including '') is correctly evicted.
    const result = chatCache.keys().next();
    if (result.done) break;
    chatCache.delete(result.value);
    callbackRefs.delete(result.value);
    handledToolCallIds.delete(result.value);
    scheduledToolCallIds.delete(result.value);
    cachedTransports.delete(result.value);
  }
}

function messageSnapshot(messages: readonly AppUIMessage[]): string {
  return JSON.stringify(
    messages.map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts,
      metadata: message.metadata,
    })),
  );
}

/**
 * Creative mesh generation is a server-executed tool. A backend/runtime error
 * is not something another automatic LLM turn can repair, so resubmitting the
 * completed error tool result only encourages the model to call create_mesh
 * again and can produce an unbounded retry loop. Parametric compile errors are
 * intentionally excluded because that workflow uses auto-continuation for
 * model-authored OpenSCAD self-correction.
 */
export function lastAssistantHasTerminalMeshError(
  messages: readonly AppUIMessage[],
): boolean {
  const message = messages.at(-1);
  if (!message || message.role !== 'assistant') return false;

  return message.parts.some(
    (part) =>
      part.type === 'tool-create_mesh' &&
      'state' in part &&
      part.state === 'output-error',
  );
}

/**
 * A successfully persisted Parametric build is enough to release the mobile
 * recovery loader after the client transport has been interrupted. It is NOT
 * globally terminal for the Parametric agent: the normal uninterrupted path
 * may still auto-continue into visual review / answer_user. This helper is only
 * used to recognise the narrow case where both the cached Chat and Supabase
 * already contain the same resolved build after a dropped mobile connection.
 */
function lastAssistantHasResolvedParametricBuild(
  messages: readonly AppUIMessage[],
): boolean {
  const message = messages.at(-1);
  if (!message || message.role !== 'assistant') return false;

  return message.parts.some(
    (part) =>
      part.type === 'tool-build_parametric_model' &&
      'state' in part &&
      part.state === 'output-available',
  );
}

function canReplaceWithPersistedMessages(
  liveMessages: readonly AppUIMessage[],
  persistedMessages: readonly AppUIMessage[],
): boolean {
  if (persistedMessages.length === 0) return false;

  // While a response is only present in the in-memory Chat, the DB branch is
  // one message shorter and still ends at the user prompt. Do not erase that
  // partial assistant. Once the server-side stream consumer persists the
  // assistant, the persisted branch catches up and becomes authoritative.
  if (persistedMessages.length < liveMessages.length) {
    const liveLast = liveMessages.at(-1);
    const persistedLast = persistedMessages.at(-1);
    if (liveLast?.role === 'assistant' && persistedLast?.role === 'user') {
      return false;
    }
  }

  return true;
}

function chatContainsToolCall(
  chat: Chat<AppUIMessage> | undefined,
  toolCallId: string,
): boolean {
  return Boolean(
    chat?.messages.some(
      (message) =>
        message.role === 'assistant' &&
        message.parts.some(
          (part) => 'toolCallId' in part && part.toolCallId === toolCallId,
        ),
    ),
  );
}

function forwardTransportError(refs: CallbackRefs, error: unknown) {
  const visibleError = userFacingChatError(error);

  // Mobile browsers may drop the client HTTP/SSE connection while the server
  // keeps consuming and persisting the model turn. That condition is already
  // recovered from the DB below, so presenting it as a destructive model error
  // is misleading. Keep the SDK's internal error state intact until a fresh
  // persisted snapshot is adopted; only suppress the red product-level toast.
  if (visibleError.message === CONNECTION_INTERRUPTED_MESSAGE) {
    console.info(
      '[chat-recovery] client connection interrupted; awaiting persisted result',
    );
    return;
  }

  refs.onError.current?.(visibleError);
}

function dispatchToolCall(
  refs: CallbackRefs,
  handled: Set<string>,
  ctx: ToolCallCallbackArg,
): boolean {
  const callback = refs.onToolCall.current;
  if (!callback) return false;
  handled.add(ctx.toolCall.toolCallId);
  void Promise.resolve(callback(ctx)).catch((error) => {
    refs.onError.current?.(userFacingChatError(error));
  });
  return true;
}

/**
 * AI SDK can invoke `onToolCall` in the same turn of the event loop in which
 * it commits the assistant/tool part to Chat state. Brepia's tool callback must
 * see that assistant because its message id is the key used to persist the
 * client-executed tool result before auto-continuation.
 *
 * Defer dispatch until the emitted tool call is observable in the cached Chat.
 * If React/SDK state takes more than one tick, retry briefly. We intentionally
 * do NOT mark the call handled when it never becomes visible or when no Brepia
 * callback is registered; the persisted-message recovery path may then replay
 * the still-pending tool safely once the assistant row is available.
 */
function scheduleToolCallAfterMessageCommit({
  id,
  refs,
  handled,
  ctx,
}: {
  id: string;
  refs: CallbackRefs;
  handled: Set<string>;
  ctx: ToolCallCallbackArg;
}) {
  const toolCallId = ctx.toolCall.toolCallId;
  const scheduled = scheduledToolsFor(id);
  if (handled.has(toolCallId) || scheduled.has(toolCallId)) return;
  scheduled.add(toolCallId);

  const attemptDispatch = (attempt: number) => {
    setTimeout(
      () => {
        if (handled.has(toolCallId)) {
          scheduled.delete(toolCallId);
          return;
        }

        if (!chatContainsToolCall(chatCache.get(id), toolCallId)) {
          if (attempt + 1 < TOOL_CALL_COMMIT_MAX_ATTEMPTS) {
            attemptDispatch(attempt + 1);
            return;
          }
          scheduled.delete(toolCallId);
          return;
        }

        scheduled.delete(toolCallId);
        dispatchToolCall(refs, handled, ctx);
      },
      attempt === 0 ? 0 : TOOL_CALL_COMMIT_RETRY_MS,
    );
  };

  attemptDispatch(0);
}

export type CachedAiChatOptions = Omit<ReactChatInit, 'id'> & {
  id: string;
};

export function useCachedAiChat({
  id,
  messages,
  transport,
  onError,
  onFinish,
  onData,
  onToolCall,
  sendAutomaticallyWhen,
  ...rest
}: CachedAiChatOptions) {
  const refs = refsFor(id);
  const handled = handledToolsFor(id);
  const initialConfigRef = useRef({ id, messages, transport, rest });
  if (initialConfigRef.current.id !== id) {
    initialConfigRef.current = { id, messages, transport, rest };
  }

  useEffect(() => {
    refs.onError.current = onError;
    refs.onFinish.current = onFinish;
    refs.onData.current = onData;
    refs.onToolCall.current = onToolCall;
    refs.sendAutomaticallyWhen.current = sendAutomaticallyWhen;
  });

  const chat = useMemo(() => {
    const existing = chatCache.get(id);
    if (existing && cachedTransports.get(id) === transport) {
      touch(id);
      return existing;
    }

    const initial = initialConfigRef.current;
    // A model / CLI-vs-Streaming change creates a new transport object in
    // ChatSession. Rebuild the cached Chat for that conversation so the next
    // send actually uses the selected model, while carrying the live message
    // state forward. Previously the cache key was only conversation.id, which
    // could silently keep using the model that was active on first mount.
    const seedMessages = existing
      ? ([...existing.messages] as AppUIMessage[])
      : initial.messages;
    const created = new Chat<AppUIMessage>({
      ...initial.rest,
      id,
      messages: seedMessages,
      transport,
      onError: (error) => forwardTransportError(refs, error),
      onFinish: (ctx) => refs.onFinish.current?.(ctx),
      onData: (ctx) => refs.onData.current?.(ctx),
      onToolCall: (ctx) => {
        scheduleToolCallAfterMessageCommit({ id, refs, handled, ctx });
      },
      sendAutomaticallyWhen: (ctx) => {
        if (lastAssistantHasTerminalMeshError(ctx.messages)) return false;
        return refs.sendAutomaticallyWhen.current?.(ctx) ?? false;
      },
    });

    chatCache.set(id, created);
    cachedTransports.set(id, transport);
    evictIfNeeded();
    return created;
  }, [handled, id, refs, transport]);

  // Android browsers can suspend a background tab and tear down its HTTP/SSE
  // connection. The server keeps consuming/persisting the AI stream, but the
  // cached client Chat can remain stuck with an older in-memory branch.
  //
  // There are two authoritative DB recovery signals:
  // 1. A terminal assistant for the same live turn: stop the stale local stream
  //    and adopt the persisted branch.
  // 2. A leaf assistant with an input-available Brepia client tool: the server
  //    persisted the tool call but the browser missed/delayed the live SDK
  //    callback. Replay that tool even while the local Chat still reports
  //    streaming/submitted. This must happen BEFORE the in-flight early return
  //    or the chat deadlocks forever at "Generated model" until reload.
  useEffect(() => {
    const isLocallyInFlight =
      chat.status === 'streaming' || chat.status === 'submitted';
    const persistedCompletesLiveTurn =
      isLocallyInFlight &&
      messages !== undefined &&
      persistedCompletionCoversLiveTurn(chat.messages, messages);
    const persistedPendingTools = messages
      ? pendingClientToolsNeedingRecovery(messages, handled)
      : [];
    let recoveredFromPersistence = false;

    if (messages && persistedPendingTools.length > 0) {
      const liveIsMissingPendingTool = persistedPendingTools.some(
        (toolCall) => !chatContainsToolCall(chat, toolCall.toolCallId),
      );

      // ChatSession resolves the assistant message id from chat.messages before
      // persisting tool output. If the live stream missed that state commit,
      // adopt the persisted assistant first so the callback has an authoritative
      // message id and the DB output write can complete before auto-resubmit.
      if (
        liveIsMissingPendingTool &&
        messageSnapshot(chat.messages) !== messageSnapshot(messages)
      ) {
        chat.messages = messages;
        recoveredFromPersistence = true;
      }

      const scheduled = scheduledToolsFor(id);
      for (const toolCall of persistedPendingTools) {
        // A short live-dispatch timer may still be waiting for the same tool.
        // Cancel its eligibility before replay; dispatchToolCall marks the id
        // handled synchronously, so any already-queued timer becomes a no-op.
        scheduled.delete(toolCall.toolCallId);
        console.info(
          '[chat-tool-recovery] replaying persisted pending client tool',
          {
            conversationId: id,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            localStatus: chat.status,
          },
        );
        dispatchToolCall(refs, handled, { toolCall } as ToolCallCallbackArg);
      }
    }

    if (persistedCompletesLiveTurn && messages) {
      void chat.stop();
      if (messageSnapshot(chat.messages) !== messageSnapshot(messages)) {
        chat.messages = messages;
      }
      recoveredFromPersistence = true;
    } else if (isLocallyInFlight) {
      return;
    } else if (
      messages &&
      canReplaceWithPersistedMessages(chat.messages, messages) &&
      messageSnapshot(chat.messages) !== messageSnapshot(messages)
    ) {
      chat.messages = messages;
      recoveredFromPersistence = true;
    }

    // A dropped mobile connection can reach this effect after the exact same
    // resolved build is already present in both Chat state and Supabase. In
    // that case no replacement occurs, so `recoveredFromPersistence` stays
    // false even though persistence has demonstrably caught up. Clear only the
    // classified transport error in that narrow case. The DB poll deliberately
    // keeps running because a later final assistant may still arrive; clearing
    // the client error merely releases the stale `Creating...`/stop UI and does
    // NOT resubmit the model.
    const persistedResolvedBuildMatchesLive =
      messages !== undefined &&
      messages.length > 0 &&
      lastAssistantHasResolvedParametricBuild(messages) &&
      messageSnapshot(chat.messages) === messageSnapshot(messages);
    const recoveredInterruptedBuild =
      chat.status === 'error' &&
      !!chat.error &&
      userFacingChatError(chat.error).message ===
        CONNECTION_INTERRUPTED_MESSAGE &&
      persistedResolvedBuildMatchesLive;

    // A genuine provider/model error must remain visible to the user. Clear a
    // cached error only when a fresh persisted DB snapshot actually recovered
    // the chat, or when the matching resolved-build condition above proves the
    // mobile transport was the only thing that failed.
    if (
      chat.status === 'error' &&
      (recoveredFromPersistence || recoveredInterruptedBuild)
    ) {
      if (recoveredInterruptedBuild) {
        console.info(
          '[chat-recovery] persisted build matches client; releasing interrupted loading state',
          { conversationId: id, messageId: chat.lastMessage?.id },
        );
      }
      chat.clearError();
    }
  }, [chat, handled, id, messages, refs]);

  return chat;
}

export function createAndCacheAiChat(
  options: Omit<
    ReactChatInit,
    'onError' | 'onFinish' | 'onData' | 'onToolCall'
  > & {
    id: string;
  },
) {
  const { id, sendAutomaticallyWhen, transport, ...rest } = options;
  const refs = refsFor(id);
  const handled = handledToolsFor(id);
  refs.sendAutomaticallyWhen.current = sendAutomaticallyWhen;
  const chat = new Chat<AppUIMessage>({
    ...rest,
    id,
    transport,
    onError: (error) => forwardTransportError(refs, error),
    onFinish: (ctx) => refs.onFinish.current?.(ctx),
    onData: (ctx) => refs.onData.current?.(ctx),
    onToolCall: (ctx) => {
      scheduleToolCallAfterMessageCommit({ id, refs, handled, ctx });
    },
    sendAutomaticallyWhen: (ctx) => {
      if (lastAssistantHasTerminalMeshError(ctx.messages)) return false;
      return refs.sendAutomaticallyWhen.current?.(ctx) ?? false;
    },
  });

  chatCache.set(id, chat);
  cachedTransports.set(id, transport);
  evictIfNeeded();
  return chat;
}
