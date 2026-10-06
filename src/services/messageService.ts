import { useConversation } from '@/contexts/ConversationContext';
import { isTerminalAssistantMessage } from '@/hooks/chatCompletionReconciliation';
import { supabase } from '@/lib/supabase';
import type { AppUIMessage } from '@shared/chatAi';
import type { Conversation, Message } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const PENDING_ASSISTANT_POLL_MS = 2_500;
const PENDING_ASSISTANT_MAX_AGE_MS = 10 * 60_000;

export function shouldPollForPendingAssistant(
  messages: Message[] | undefined,
): boolean {
  const last = messages?.at(-1);
  if (!last) return false;

  const createdAt = Date.parse(last.created_at);
  if (!Number.isFinite(createdAt)) return false;
  if (Date.now() - createdAt >= PENDING_ASSISTANT_MAX_AGE_MS) return false;

  if (last.role === 'user') return true;
  if (last.role !== 'assistant') return false;

  const parts = Array.isArray(last.parts)
    ? (last.parts as AppUIMessage['parts'])
    : [];
  return !isTerminalAssistantMessage({
    id: last.id,
    role: last.role,
    parts,
    metadata: last.metadata,
  });
}

function hasPersistedBrepSource(messages: Message[]): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      Array.isArray(message.parts) &&
      (message.parts as AppUIMessage['parts']).some(
        (part) => part.type === 'data-brep-project',
      ),
  );
}

/**
 * A newly routed native-BRep conversation is not corrupt merely because its
 * first assistant revision has not landed yet. Keep that state explicit so
 * product surfaces can explain what is happening while the server-side AI turn
 * continues after a mobile browser has been backgrounded.
 */
export function isRecentPendingBrepCreation(
  conversation: Conversation,
  messages: Message[],
): boolean {
  if (conversation.settings?.parametricSourceKind !== 'brep') return false;
  if (hasPersistedBrepSource(messages)) return false;

  const latest = messages.at(-1);
  const createdAt = latest?.created_at ?? conversation.created_at;
  if (!createdAt) return false;
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return false;
  if (Date.now() - createdAtMs >= PENDING_ASSISTANT_MAX_AGE_MS) return false;

  return messages.length === 0 || latest?.role === 'user';
}

/**
 * Insert a new user message into the conversation. The `update_leaf_trigger`
 * on `public.messages` automatically advances
 * `conversations.current_message_leaf_id` to the inserted row's id, which
 * is what the server-side chat handler walks to build the branch — so a
 * single INSERT is sufficient to set up the next generation request.
 *
 * Returns the new id so the caller can re-use it for the optimistic
 * `useChat` user bubble (keeping the local-state id and the DB id in
 * sync prevents a duplicate-render flash when the messages query
 * refetches after the stream completes).
 */
export async function persistUserMessage({
  conversationId,
  parts,
  metadata,
  parentMessageId,
}: {
  conversationId: string;
  parts: AppUIMessage['parts'];
  metadata: AppUIMessage['metadata'];
  parentMessageId: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from('messages').insert({
    id,
    conversation_id: conversationId,
    role: 'user',
    parts: JSON.parse(JSON.stringify(parts)),
    metadata: JSON.parse(JSON.stringify(metadata ?? {})),
    parent_message_id: parentMessageId,
  });
  if (error) throw error;
  return id;
}

/**
 * Thrown when `persistAssistantParts` matched no row even after retries —
 * the assistant row was never INSERTed (the stream was interrupted before
 * the server's `onFinish` ran). Callers that merely mirror in-memory state
 * onto an existing row (load-time stuck-tool recovery) can treat this as
 * benign: with no row, the DB branch has no dangling tool call to repair.
 * Callers persisting NEW tool output must still surface it — the server
 * continues from the DB branch, so a lost write means a stale continuation.
 */
export class AssistantRowMissingError extends Error {}

/**
 * Persist updated `parts` on an existing assistant row. Used after the
 * client compiles a `build_parametric_model` tool call locally — we need
 * the DB row to reflect the completed tool output before the server reads
 * the leaf and continues the stream.
 */
export async function persistAssistantParts({
  conversationId,
  messageId,
  parts,
  metadata,
}: {
  conversationId: string;
  messageId: string;
  parts: AppUIMessage['parts'];
  // When provided, written atomically alongside `parts` in the same row
  // update. Used by parameter edits to lazily stash `metadata.originalCode`
  // on the first edit. Omitted by callers that only touch parts (tool
  // output), leaving the existing metadata untouched.
  metadata?: AppUIMessage['metadata'];
}) {
  const payload = {
    parts: JSON.parse(JSON.stringify(parts)),
    ...(metadata !== undefined
      ? { metadata: JSON.parse(JSON.stringify(metadata)) }
      : {}),
  };

  // A matched-nothing update is silent in PostgREST. The usual cause is benign
  // and self-healing: the client resolved a tool call before the server's
  // `onFinish` INSERT for this assistant row landed. The server walks the
  // branch from the DB on continuation, so we must NOT report success on a
  // no-op (the tool output would be lost and the server would continue from a
  // stale/absent branch). Retry briefly to let the INSERT land, then throw so
  // the caller can pause/surface it. The retry window covers normal stream
  // finalization and persistence latency without hanging the UI indefinitely.
  const MAX_ATTEMPTS = 6;
  const RETRY_DELAY_MS = 350;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from('messages')
      .update(payload)
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
      .select('id');
    if (error) throw error;
    if (data && data.length > 0) return;
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  throw new AssistantRowMissingError(
    `persistAssistantParts matched no row after ${MAX_ATTEMPTS} attempts ` +
      `(messageId=${messageId}). The assistant message was never persisted.`,
  );
}

export const useMessagesQuery = () => {
  const { conversation } = useConversation();
  const queryClient = useQueryClient();

  return useQuery<Message[]>({
    enabled: !!conversation.id,
    queryKey: ['messages', conversation.id],
    initialData: [],
    refetchOnWindowFocus: 'always',
    refetchIntervalInBackground: true,
    // Mobile browsers may suspend the foreground fetch/SSE connection when
    // Chrome is backgrounded. The server independently consumes/persists the
    // AI stream, so poll while the newest row is still a recent non-terminal
    // turn. A fresh native-BRep creation remains visible as its real persisted
    // user row; the BRep product surface interprets that as an explicit pending
    // creation instead of hiding it or misclassifying it as corrupt state.
    refetchInterval: (query) => {
      if (shouldPollForPendingAssistant(query.state.data)) {
        return PENDING_ASSISTANT_POLL_MS;
      }
      if (isRecentPendingBrepCreation(conversation, query.state.data ?? [])) {
        return PENDING_ASSISTANT_POLL_MS;
      }
      return false;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true })
        .overrideTypes<Message[]>();

      if (error) throw error;
      const rows = data ?? [];

      // A backgrounded mobile browser can lose its SSE connection while the
      // server continues a Parametric auto-continuation. One user turn may then
      // append several assistant rows (build/tool assistant -> final assistant)
      // while the cached Conversation still points at the original user row.
      //
      // The old shortcut only advanced the cache when the newest assistant was
      // a DIRECT child of the cached leaf. That misses multi-assistant chains
      // and leaves ChatSession on the stale branch until a full page reload.
      // When the message list has moved beyond the cached leaf, read the small
      // authoritative conversation leaf from Supabase and mirror the DB trigger
      // result exactly. Do not infer ancestry from the message list: a user may
      // intentionally select an older branch, and the authoritative leaf is the
      // only safe way to distinguish that from a stale mobile cache.
      const latest = rows.at(-1);
      if (latest && latest.id !== conversation.current_message_leaf_id) {
        const { data: leafState, error: leafError } = await supabase
          .from('conversations')
          .select('current_message_leaf_id')
          .eq('id', conversation.id)
          .limit(1)
          .single()
          .overrideTypes<Pick<Conversation, 'current_message_leaf_id'>>();

        if (leafError) {
          console.warn(
            'Failed to refresh authoritative conversation leaf during message polling:',
            leafError,
          );
        } else if (
          leafState?.current_message_leaf_id !==
          conversation.current_message_leaf_id
        ) {
          queryClient.setQueryData<Conversation>(
            ['conversation', conversation.id],
            (current) =>
              current
                ? {
                    ...current,
                    current_message_leaf_id:
                      leafState?.current_message_leaf_id ?? null,
                  }
                : current,
          );
        }
      }

      return rows;
    },
  });
};

/**
 * Optimistically update a message row's rating column. The chat tree is
 * read straight from Supabase via useMessagesQuery; this writes both the
 * cache and the DB so the thumb fills in instantly.
 */
export function useChangeRatingMutation({
  conversationId,
}: {
  conversationId: string;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['change-rating', conversationId],
    mutationFn: async ({
      messageId,
      rating,
    }: {
      messageId: string;
      rating: number;
    }) => {
      queryClient.setQueryData<Message[]>(
        ['messages', conversationId],
        (oldMessages) =>
          oldMessages?.map((m) => (m.id === messageId ? { ...m, rating } : m)),
      );
      const { error } = await supabase
        .from('messages')
        .update({ rating })
        .eq('id', messageId);
      if (error) throw error;
    },
  });
}

/**
 * "Restore" an old assistant message — preserves the historical behavior
 * exactly: insert a fresh row that COPIES the message's role, parts,
 * metadata, and `parent_message_id`, then point the conversation's
 * `current_message_leaf_id` at the new copy. Because the copy shares the
 * original's parent, the two messages become siblings, so BranchNavigation
 * keeps working (the user can flip back to whichever version they want).
 *
 * The previous implementation just retargeted `current_message_leaf_id`
 * to the existing message — that "worked" superficially but broke the
 * sibling story for any subsequent retry, because the assistant being
 * restored already had its own children in the tree.
 */
export function useRestoreMessageMutation({
  conversation,
}: {
  conversation: Conversation;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['restore-message', conversation.id],
    mutationFn: async ({
      message,
    }: {
      message: Pick<
        Message,
        'role' | 'parts' | 'metadata' | 'parent_message_id'
      >;
    }) => {
      const newId = crypto.randomUUID();
      const { error } = await supabase.from('messages').insert({
        id: newId,
        conversation_id: conversation.id,
        role: message.role,
        parts: JSON.parse(JSON.stringify(message.parts)),
        metadata: JSON.parse(JSON.stringify(message.metadata ?? {})),
        parent_message_id: message.parent_message_id,
        rating: 0,
      });
      if (error) throw error;

      // Pull the freshly inserted row into the messages query so the
      // tree merge sees it as a sibling immediately.
      queryClient.invalidateQueries({
        queryKey: ['messages', conversation.id],
      });
    },
  });
}
