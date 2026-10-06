export type ChatTextSubmitter = (text: string) => boolean;

const submitters = new Map<string, ChatTextSubmitter>();

/**
 * Register the currently mounted normal chat-submit path for one conversation.
 *
 * This bridge deliberately knows nothing about transports, persistence or the
 * AI SDK. The registered callback is owned by ChatSession through its existing
 * suggestion submit path, so callers still enter the same `handleSend` flow as
 * an ordinary user message.
 */
export function registerChatTextSubmitter(
  conversationId: string,
  submitter: ChatTextSubmitter,
): () => void {
  if (!conversationId) return () => undefined;

  submitters.set(conversationId, submitter);
  return () => {
    if (submitters.get(conversationId) === submitter) {
      submitters.delete(conversationId);
    }
  };
}

/**
 * Submit text through the currently mounted normal chat path.
 * Returns false when the conversation has no active submitter or the submitter
 * declines the request (for example while disabled).
 */
export function submitChatText(conversationId: string, text: string): boolean {
  if (!conversationId || !text.trim()) return false;
  return submitters.get(conversationId)?.(text) ?? false;
}

export const __chatSubmitBridgeTestUtils = {
  clear() {
    submitters.clear();
  },
};
