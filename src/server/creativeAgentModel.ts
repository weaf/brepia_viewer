import type { User } from '@supabase/supabase-js';
import { isInternalCreativeRuntimeModelId } from '@shared/creativeRuntimeModels';
import type { Conversation, Model } from '@shared/types';
import { buildSelectableCatalog, type CatalogEntry } from './modelCatalog';

export type CreativeAgentModelSource = 'request' | 'conversation' | 'catalog';

export type CreativeAgentModelResolution = {
  modelId: string;
  source: CreativeAgentModelSource;
};

type CreativeConversation = Pick<Conversation, 'settings'>;

function nonEmptyModel(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function creativeAgentModel(value: unknown): string | null {
  const modelId = nonEmptyModel(value);
  return modelId && !isInternalCreativeRuntimeModelId(modelId) ? modelId : null;
}

function isAutomaticCreativeAgentCandidate(entry: CatalogEntry): boolean {
  return (
    !isInternalCreativeRuntimeModelId(entry.id) &&
    entry.source !== 'opencode' &&
    entry.enabled &&
    entry.available &&
    entry.supportsTools === true
  );
}

/**
 * Choose a Creative-mode LLM from the user's selectable Settings catalog.
 * Explicit request and conversation-pinned choices remain preferred, but they
 * are no longer authoritative when they are stale, hidden, disabled, or not
 * present in Settings.
 */
export function selectCreativeAgentModel(
  conversation: CreativeConversation,
  requestedAgentModel: Model | undefined,
  selectableCatalog: CatalogEntry[],
): CreativeAgentModelResolution | null {
  const selectableIds = new Set(selectableCatalog.map((entry) => entry.id));

  const requested = creativeAgentModel(requestedAgentModel);
  if (requested && selectableIds.has(requested)) {
    return { modelId: requested, source: 'request' };
  }

  const pinned = creativeAgentModel(conversation.settings?.creativeAgentModel);
  if (pinned && selectableIds.has(pinned)) {
    return { modelId: pinned, source: 'conversation' };
  }

  const eligible = selectableCatalog.filter(isAutomaticCreativeAgentCandidate);
  const fallback =
    eligible.find((entry) => entry.supportsVision !== true) ?? eligible[0];

  return fallback ? { modelId: fallback.id, source: 'catalog' } : null;
}

export async function resolveCreativeAgentModel({
  conversation,
  requestedAgentModel,
  user,
}: {
  conversation: CreativeConversation;
  requestedAgentModel?: Model;
  user: User;
}): Promise<CreativeAgentModelResolution | null> {
  const catalog = await buildSelectableCatalog(user);
  return selectCreativeAgentModel(conversation, requestedAgentModel, catalog);
}
