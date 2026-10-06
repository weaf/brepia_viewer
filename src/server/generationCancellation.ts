import { cancelActiveGenerationWithRunId } from './activeGeneration';
import {
  cancelDurableGenerationRun,
  cancelLatestDurableGenerationRun,
} from './aiGenerationRunLifecycle';

/**
 * Cancel the generation currently owned by a conversation.
 *
 * The in-memory AbortController is authoritative while this server process is
 * alive. After a process restart that entry no longer exists, but the durable
 * generation run can still be queued/running and keep the browser in an active
 * state. In that case, cancel the latest owned durable run so Stop remains
 * restart-safe and the persisted lifecycle can become terminal.
 */
export async function cancelConversationGeneration(
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const active = cancelActiveGenerationWithRunId(userId, conversationId);

  if (active.durableRunId) {
    await cancelDurableGenerationRun(
      active.durableRunId,
      userId,
      conversationId,
    );
    return true;
  }

  const durableCancelled = await cancelLatestDurableGenerationRun(
    userId,
    conversationId,
  );
  return active.cancelled || durableCancelled;
}
