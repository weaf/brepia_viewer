import { isInternalCreativeRuntimeModelId } from '@shared/creativeRuntimeModels';
import type { Model } from '@shared/types';

export const CREATIVE_AGENT_STORAGE_KEY = 'brepia.creativeAgentModel';

export type CreativeAgentCandidate = {
  id: string;
  supportsTools?: boolean;
  supportsVision?: boolean;
  source?: string;
  enabled?: boolean;
  available?: boolean;
};

/**
 * Keep the client-side Creative controller picker aligned with the server's
 * automatic Creative-agent eligibility rules. Internal generation runtimes
 * (Z-Image/TRELLIS) and OpenCode/Codex adapters are not chat controllers for
 * Creative mode; the selected model must be an available tool-capable LLM.
 *
 * Non-vision models are ordered first to mirror the server fallback. Creative
 * has a separate vision-routing path, so a vision-specialized controller is
 * useful only when the user explicitly chooses one.
 */
export function creativeAgentCandidates<T extends CreativeAgentCandidate>(
  models: readonly T[],
): T[] {
  const eligible = models.filter(
    (model) =>
      model.supportsTools === true &&
      model.source !== 'opencode' &&
      model.enabled !== false &&
      model.available !== false &&
      !isInternalCreativeRuntimeModelId(model.id),
  );

  return [
    ...eligible.filter((model) => model.supportsVision !== true),
    ...eligible.filter((model) => model.supportsVision === true),
  ];
}

export function readPreferredCreativeAgentModel(): Model | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = window.localStorage.getItem(CREATIVE_AGENT_STORAGE_KEY)?.trim();
  return value ? value : undefined;
}

export function writePreferredCreativeAgentModel(modelId: Model): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CREATIVE_AGENT_STORAGE_KEY, modelId);
}

export function resolvePreferredCreativeAgentModel<
  T extends CreativeAgentCandidate,
>(
  models: readonly T[],
  preferredModelId:
    string | null | undefined = readPreferredCreativeAgentModel(),
): Model | undefined {
  const candidates = creativeAgentCandidates(models);
  if (
    preferredModelId &&
    candidates.some((model) => model.id === preferredModelId)
  ) {
    return preferredModelId;
  }
  return candidates[0]?.id;
}
