import type { Model } from '@shared/types';

type SelectedTransport =
  | { kind: 'normal' }
  | { kind: 'cli-agent' }
  | { kind: 'streaming-opencode'; underlyingModelId: string };

export type AiTurnTransportKind =
  | 'direct'
  | 'opencode'
  | 'codex'
  | 'cli-agent';

export type AiTurnProvenance = {
  actualModel: Model;
  transportKind: AiTurnTransportKind;
  openCodeExecutionMode?: 'cli' | 'streaming';
};

function stripAgentPrefix(modelId: string, prefix: string): string {
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

/**
 * Resolve immutable per-assistant-turn provenance from the transport that was
 * actually selected by the server. This deliberately does not read mutable
 * conversation settings after selection.
 */
export function resolveAiTurnProvenance({
  actualModelId,
  transport,
  executionMode,
}: {
  actualModelId: Model;
  transport: SelectedTransport;
  executionMode: 'cli' | 'streaming';
}): AiTurnProvenance {
  if (transport.kind === 'streaming-opencode') {
    return {
      actualModel: transport.underlyingModelId,
      transportKind: 'opencode',
      openCodeExecutionMode: 'streaming',
    };
  }

  if (actualModelId.startsWith('agent/opencode/')) {
    return {
      actualModel: stripAgentPrefix(actualModelId, 'agent/opencode/'),
      transportKind: 'opencode',
      openCodeExecutionMode: executionMode,
    };
  }

  // Legacy persisted OpenCode IDs can still select CLI vs Streaming in the
  // product. CLI uses the older normal adapter internally, so classify the
  // user-visible transport from the immutable model ID rather than exposing
  // that implementation detail as a misleading direct-provider turn.
  if (actualModelId.startsWith('opencode/')) {
    return {
      actualModel: actualModelId,
      transportKind: 'opencode',
      openCodeExecutionMode: executionMode,
    };
  }

  if (actualModelId.startsWith('agent/codex/')) {
    return {
      actualModel: stripAgentPrefix(actualModelId, 'agent/codex/'),
      transportKind: 'codex',
    };
  }

  return {
    actualModel: actualModelId,
    transportKind: transport.kind === 'cli-agent' ? 'cli-agent' : 'direct',
  };
}
