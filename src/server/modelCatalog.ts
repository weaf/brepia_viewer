/**
 * Model Catalog — unified Settings-owned model discovery layer.
 *
 * The catalog contains only models that are discoverable/configurable through
 * AI Settings:
 *
 *   1. Dynamic Local OpenAI / llama-swap models from GET /v1/models
 *   2. Dynamic OpenCode agent models (opt-in through Settings)
 *   3. Configured Codex CLI agent models
 *   4. Custom provider models from ai_provider_models
 *
 * There is intentionally no compile-time hosted-model catalog or default.
 */

import {
  makeCustomProviderModelId,
  parseCustomProviderModelId,
} from '../../shared/customModelIds';
import { isModelVisibleByPreference } from '../../shared/modelVisibility';
import { getUserProviders, getProviderModels } from './customProviders';
import type { User } from '@supabase/supabase-js';
import { opencodeModels } from './opencode';
import { configuredCodexModels } from './cliAgents';
import type { ModelConfig } from '../../src/types/misc';
import { getPreferences } from './aiSettings';
import { discoverLocalModels } from './localModels';

// `builtin` remains in the public type temporarily for compatibility with
// older Settings UI filters/tests, but this module never emits builtin entries.
export type CatalogEntrySource = 'builtin' | 'local' | 'opencode' | 'custom';

export interface CatalogEntry extends ModelConfig {
  source: CatalogEntrySource;
  enabled: boolean;
  available: boolean;
  unavailableReason?: string;
}

export function isCustomCatalogEntry(entry: CatalogEntry): boolean {
  return entry.source === 'custom';
}

/** @deprecated Built-in LLM models were removed; use Settings sources only. */
export function getBuiltInModels(): CatalogEntry[] {
  return [];
}

export async function getLocalModels(
  user: User | null,
): Promise<CatalogEntry[]> {
  if (!user) return [];

  try {
    const models = await discoverLocalModels(user.id);
    return models.map((model) => ({
      id: model.id,
      name: model.displayName,
      description: model.metadataConfigured
        ? 'Discovered from Local OpenAI / llama-swap with user capability metadata'
        : 'Discovered dynamically from Local OpenAI / llama-swap',
      provider: model.provider,
      supportsTools: model.supportsTools,
      supportsThinking: model.supportsThinking,
      supportsVision: model.supportsVision,
      source: 'local' as const,
      enabled: model.isVisible,
      available: true,
      ...(!model.isVisible
        ? { unavailableReason: 'Disabled in local model metadata' }
        : {}),
    }));
  } catch {
    return [];
  }
}

function toOpencodeCatalogEntry(m: {
  cliId: string;
  name: string;
  providerID: string;
}): CatalogEntry | undefined {
  if (!m.cliId || !m.name) return undefined;

  return {
    id: `agent/opencode/${m.cliId}`,
    name: `OpenCode · ${m.name}`,
    description: `OpenCode agent via ${m.providerID}`,
    provider: 'OpenCode Agent',
    supportsTools: true,
    supportsThinking: false,
    supportsVision: false,
    source: 'opencode' as const,
    enabled: true,
    available: true,
  };
}

function toCodexCatalogEntry(
  model: ReturnType<typeof configuredCodexModels>[number],
): CatalogEntry {
  return {
    ...model,
    source: 'opencode' as const,
    enabled: true,
    available: true,
  };
}

export async function getOpencodeModels(): Promise<CatalogEntry[]> {
  let openCodeEntries: CatalogEntry[] = [];
  try {
    const models = await opencodeModels();
    openCodeEntries = models
      .map(toOpencodeCatalogEntry)
      .filter((entry): entry is CatalogEntry => entry !== undefined);
  } catch {
    // OpenCode server/CLI unreachable — configured Codex may still be available.
  }

  const codexEntries = configuredCodexModels().map(toCodexCatalogEntry);
  return [...openCodeEntries, ...codexEntries];
}

function toCustomCatalogEntry(
  model: {
    id: string;
    providerId: string;
    userId: string;
    modelId: string;
    displayName: string;
    description?: string | null;
    supportsTools?: boolean;
    supportsThinking?: boolean;
    supportsVision?: boolean;
    isVisible: boolean;
    createdAt: string;
    updatedAt: string;
  },
  providerName: string,
  enabled: boolean,
): CatalogEntry {
  return {
    id: makeCustomProviderModelId(model.providerId, model.modelId),
    name: model.displayName,
    description: model.description ?? '',
    provider: providerName,
    supportsTools: model.supportsTools ?? false,
    supportsThinking: model.supportsThinking ?? false,
    supportsVision: model.supportsVision ?? false,
    source: 'custom' as const,
    enabled: enabled && model.isVisible,
    available: true,
    ...(!enabled
      ? { unavailableReason: `${providerName} is disabled in AI Settings` }
      : {}),
  };
}

export async function getCustomProviderModels(
  user: User | null,
): Promise<CatalogEntry[]> {
  if (!user) return [];

  try {
    const providers = await getUserProviders(user);
    const results: CatalogEntry[] = [];

    for (const provider of providers) {
      // Reserved builtin-* rows are credential/runtime overlays only. They do
      // not manufacture model identities; models must exist explicitly in
      // Settings as normal provider-model rows.
      if (provider.slug.startsWith('builtin-')) continue;
      const models = await getProviderModels(provider.id, user.id);
      for (const model of models) {
        results.push(
          toCustomCatalogEntry(model, provider.name, provider.enabled),
        );
      }
    }

    return results;
  } catch {
    return [];
  }
}

function mergeByProvider(
  opencode: CatalogEntry[],
  custom: CatalogEntry[],
): CatalogEntry[] {
  const customByProvider = new Map<string, Map<string, CatalogEntry>>();

  for (const entry of custom) {
    const provider = entry.provider ?? 'Unknown';
    const models = customByProvider.get(provider) ?? new Map();
    const parsed = parseCustomProviderModelId(entry.id);
    if (parsed) models.set(parsed.modelId, entry);
    customByProvider.set(provider, models);
  }

  const opencodeByProvider = new Map<string, Map<string, CatalogEntry>>();
  const ordering: { provider: string; nativeId: string }[] = [];

  for (const entry of opencode) {
    const cliId = entry.id.replace('agent/opencode/', '');
    const provider = entry.provider ?? 'Unknown';
    const models = opencodeByProvider.get(provider) ?? new Map();
    models.set(cliId, entry);
    opencodeByProvider.set(provider, models);
    ordering.push({ provider, nativeId: cliId });
  }

  const result: CatalogEntry[] = [];

  for (const { provider, nativeId } of ordering) {
    const opencodeModelsForProvider = opencodeByProvider.get(provider);
    const customModels = customByProvider.get(provider);

    if (customModels?.has(nativeId)) {
      result.push(customModels.get(nativeId)!);
    } else {
      result.push(opencodeModelsForProvider!.get(nativeId)!);
    }
  }

  for (const [provider, customModels] of customByProvider) {
    for (const [nativeId, entry] of customModels) {
      const opencodeModelsForProvider = opencodeByProvider.get(provider);
      if (!opencodeModelsForProvider?.has(nativeId)) result.push(entry);
    }
  }

  return result;
}

export async function buildCatalog(
  user: User | null = null,
): Promise<CatalogEntry[]> {
  const local = await getLocalModels(user);
  const opencode = await getOpencodeModels();
  const custom = await getCustomProviderModels(user);

  const occupiedIds = new Set(local.map((model) => model.id));
  const dedupedOpencode = opencode.filter((model) => !occupiedIds.has(model.id));
  for (const entry of dedupedOpencode) occupiedIds.add(entry.id);
  const dedupedCustom = custom.filter((model) => !occupiedIds.has(model.id));

  const merged = mergeByProvider(dedupedOpencode, dedupedCustom);
  return [
    ...local,
    ...merged.filter((entry) => entry.source === 'opencode'),
    ...merged.filter((entry) => entry.source === 'custom'),
  ];
}

export function filterSelectableCatalog(
  catalog: CatalogEntry[],
  hiddenIds: Set<string>,
  enabledOpenCodeIds?: Set<string>,
): CatalogEntry[] {
  return catalog.filter((entry) => {
    if (enabledOpenCodeIds) {
      if (
        !isModelVisibleByPreference(entry, {
          hiddenModelIds: hiddenIds,
          enabledOpenCodeModelIds: enabledOpenCodeIds,
        })
      ) {
        return false;
      }
    } else if (hiddenIds.has(entry.id)) {
      return false;
    }
    if (!entry.enabled) return false;
    if (!entry.available) return false;
    return true;
  });
}

export async function buildFullCatalog(
  user: User | null = null,
): Promise<CatalogEntry[]> {
  return buildCatalog(user);
}

export async function buildSelectableCatalog(
  user: User | null = null,
): Promise<CatalogEntry[]> {
  const catalog = await buildCatalog(user);
  if (!user) {
    return filterSelectableCatalog(catalog, new Set(), new Set());
  }

  try {
    const prefs = await getPreferences(user);
    return filterSelectableCatalog(
      catalog,
      new Set(prefs.hiddenModelIds ?? []),
      new Set(prefs.enabledOpenCodeModelIds ?? []),
    );
  } catch {
    return filterSelectableCatalog(catalog, new Set(), new Set());
  }
}

/** @deprecated There is no compile-time default model. */
export function getDefaultModel(): undefined {
  return undefined;
}
