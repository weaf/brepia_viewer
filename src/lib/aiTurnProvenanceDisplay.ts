import type { AppUIMessage } from '@shared/chatAi';

type ModelLabel = { id: string; name: string };

type ConversationKind = 'parametric' | 'creative';

function findModelName(id: string, models: readonly ModelLabel[]): string {
  const exact = models.find((model) => model.id === id);
  if (exact) return exact.name;

  const wrapped = models.find((model) => model.id.endsWith(`/${id}`));
  if (wrapped) return wrapped.name;

  const unwrapped = models.find((model) => id.endsWith(`/${model.id}`));
  if (unwrapped) return unwrapped.name;

  return id.slice(id.lastIndexOf('/') + 1) || id;
}

function withoutTransportPrefix(
  name: string,
  transport: 'opencode' | 'codex',
): string {
  const pattern =
    transport === 'opencode'
      ? /^OpenCode(?: Agent)?\s*(?:[·:–-]\s*)?/i
      : /^Codex(?: CLI| Agent)?\s*(?:[·:–-]\s*)?/i;
  return name.replace(pattern, '').trim() || name;
}

function inferredLegacyTransport(modelId: string | undefined) {
  if (modelId?.startsWith('agent/opencode/')) return 'opencode' as const;
  if (modelId?.startsWith('agent/codex/')) return 'codex' as const;
  return undefined;
}

/**
 * Build small historical labels using only persisted message metadata and
 * immutable model catalogs. Mutable conversation settings are intentionally
 * not an input.
 */
export function buildAiTurnProvenanceLines({
  metadata,
  conversationType,
  aiModels,
  meshModels,
}: {
  metadata: AppUIMessage['metadata'] | undefined;
  conversationType: ConversationKind;
  aiModels: readonly ModelLabel[];
  meshModels: readonly ModelLabel[];
}): string[] {
  if (!metadata) return [];

  if (conversationType === 'creative') {
    const aiModelId = metadata.actualModel ?? metadata.agentModel;
    const meshModelId = metadata.model;
    return [
      ...(aiModelId
        ? [`AI: ${findModelName(aiModelId, aiModels)}`]
        : []),
      ...(meshModelId
        ? [`3D: ${findModelName(meshModelId, meshModels)}`]
        : []),
    ];
  }

  const modelId = metadata.actualModel ?? metadata.model;
  if (!modelId) return [];

  const transportKind =
    metadata.transportKind ?? inferredLegacyTransport(metadata.model);
  const modelName = findModelName(modelId, aiModels);

  if (transportKind === 'opencode') {
    const mode = metadata.openCodeExecutionMode;
    return [
      [
        'OpenCode',
        mode === 'streaming' ? 'Streaming' : mode === 'cli' ? 'CLI' : undefined,
        withoutTransportPrefix(modelName, 'opencode'),
      ]
        .filter(Boolean)
        .join(' · '),
    ];
  }

  if (transportKind === 'codex') {
    return [`Codex CLI · ${withoutTransportPrefix(modelName, 'codex')}`];
  }

  if (transportKind === 'cli-agent') {
    return [`CLI agent · ${modelName}`];
  }

  return [modelName];
}
