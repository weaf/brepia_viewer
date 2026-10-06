import type { Model } from './types';

// Model identity is configuration-owned. Historical/stale ids are never
// remapped to a different hardcoded model; callers must validate them against
// the user's current Settings catalog instead.
export function normalizeModelId(model: Model): Model {
  return model;
}

// Canonical OpenCode agent model ID: `agent/opencode/<provider>/<model>`.
// `/api/opencode/models` emits exactly this form. Both the CLI adapter and the
// streaming HTTP adapter must accept the same ID and the transport must be
// chosen by `executionMode`, never by picking a different model ID.
export function isOpenCodeAgentModel(modelId: string): boolean {
  return modelId.startsWith('agent/opencode/');
}

// True for any model that can switch CLI vs Streaming transport: the
// canonical `agent/opencode/...` agent IDs plus legacy `opencode/...` IDs
// that may still be persisted in old conversations.
export function isOpenCodeTransportModel(modelId: string): boolean {
  return isOpenCodeAgentModel(modelId) || modelId.startsWith('opencode/');
}
