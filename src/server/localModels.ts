import { isInternalCreativeRuntimeModelId } from '@shared/creativeRuntimeModels';
import { env } from './env';
import { loadBuiltinProviderRuntimeOverrides } from './builtinProviderOverrides';
import { getServiceRoleSupabaseClient } from './supabaseClient';

export interface LocalModelMetadata {
  modelId: string;
  displayName: string;
  supportsTools: boolean;
  supportsThinking: boolean;
  supportsVision: boolean;
  contextLimit: number | null;
  outputLimit: number | null;
  isVisible: boolean;
  metadataConfigured: boolean;
}

export interface DiscoveredLocalModel extends LocalModelMetadata {
  id: string;
  provider: 'Local OpenAI / llama-swap';
}

export interface LocalRuntimeConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
}

export interface UpdateLocalModelMetadataInput {
  modelId: string;
  displayName?: string;
  supportsTools: boolean;
  supportsThinking: boolean;
  supportsVision: boolean;
  contextLimit?: number | null;
  outputLimit?: number | null;
  isVisible: boolean;
}

const DEFAULT_LOCAL_MODEL_METADATA = {
  supportsTools: true,
  supportsThinking: false,
  supportsVision: false,
  contextLimit: null,
  outputLimit: null,
  isVisible: true,
} as const;

export function normalizeLocalOpenAiUrls(rawUrl: string): {
  baseUrl: string;
  modelsUrl: string;
  rootUrl: string;
} {
  const baseUrl = rawUrl.trim().replace(/\/+$/, '');
  const hasV1Suffix = /\/v1$/i.test(baseUrl);
  return {
    baseUrl,
    modelsUrl: hasV1Suffix ? `${baseUrl}/models` : `${baseUrl}/v1/models`,
    rootUrl: hasV1Suffix ? baseUrl.replace(/\/v1$/i, '') : baseUrl,
  };
}

export function parseLocalOpenAiModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = Reflect.get(payload, 'data');
  if (!Array.isArray(data)) return [];

  const ids = data.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const id = Reflect.get(entry, 'id');
    if (typeof id !== 'string') return [];
    const trimmed = id.trim();
    return trimmed && trimmed.length <= 512 ? [trimmed] : [];
  });

  return [...new Set(ids)];
}

export async function getLocalRuntimeConfig(
  userId: string,
): Promise<LocalRuntimeConfig | null> {
  const overrides = await loadBuiltinProviderRuntimeOverrides(userId);
  const override = overrides['openai-compatible'];
  const baseUrl = (override?.baseUrl || env('LOCAL_LLM_BASE_URL')).trim();
  if (!baseUrl) return null;

  return {
    enabled: override?.enabled !== false,
    baseUrl,
    apiKey: (override?.credential ?? env('LOCAL_LLM_API_KEY')) || 'local',
  };
}

type MetadataRow = {
  model_id: string;
  display_name: string | null;
  supports_tools: boolean;
  supports_thinking: boolean;
  supports_vision: boolean;
  context_limit: number | null;
  output_limit: number | null;
  is_visible: boolean;
};

async function loadMetadataRows(
  userId: string,
): Promise<Map<string, MetadataRow>> {
  // Generated Supabase types can lag migrations, so keep this isolated cast here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getServiceRoleSupabaseClient() as any;
  const { data, error } = await supabase
    .from('ai_local_model_metadata')
    .select(
      'model_id, display_name, supports_tools, supports_thinking, supports_vision, context_limit, output_limit, is_visible',
    )
    .eq('user_id', userId);

  if (error) return new Map();
  return new Map(
    ((data ?? []) as MetadataRow[]).map((row) => [row.model_id, row]),
  );
}

export function applyLocalModelMetadata(
  modelIds: string[],
  rows: Map<string, MetadataRow>,
): DiscoveredLocalModel[] {
  return modelIds
    .filter((modelId) => !isInternalCreativeRuntimeModelId(modelId))
    .map((modelId) => {
      const row = rows.get(modelId);
      return {
        id: `local/${modelId}`,
        modelId,
        displayName: row?.display_name?.trim() || modelId,
        provider: 'Local OpenAI / llama-swap' as const,
        supportsTools:
          row?.supports_tools ?? DEFAULT_LOCAL_MODEL_METADATA.supportsTools,
        supportsThinking:
          row?.supports_thinking ??
          DEFAULT_LOCAL_MODEL_METADATA.supportsThinking,
        supportsVision:
          row?.supports_vision ?? DEFAULT_LOCAL_MODEL_METADATA.supportsVision,
        contextLimit:
          row?.context_limit ?? DEFAULT_LOCAL_MODEL_METADATA.contextLimit,
        outputLimit:
          row?.output_limit ?? DEFAULT_LOCAL_MODEL_METADATA.outputLimit,
        isVisible: row?.is_visible ?? DEFAULT_LOCAL_MODEL_METADATA.isVisible,
        metadataConfigured: Boolean(row),
      };
    });
}

export async function discoverLocalModels(
  userId: string,
  timeoutMs = 3000,
): Promise<DiscoveredLocalModel[]> {
  const runtime = await getLocalRuntimeConfig(userId);
  if (!runtime?.enabled) return [];

  const { modelsUrl } = normalizeLocalOpenAiUrls(runtime.baseUrl);
  const response = await fetch(modelsUrl, {
    headers: { Authorization: `Bearer ${runtime.apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(
      `Local model discovery failed: ${response.status} ${response.statusText}`,
    );
  }

  const ids = parseLocalOpenAiModelIds(await response.json());
  const metadata = await loadMetadataRows(userId);
  return applyLocalModelMetadata(ids, metadata);
}

export async function getLocalModelMetadataById(
  userId: string,
  modelId: string,
): Promise<LocalModelMetadata | null> {
  const rows = await loadMetadataRows(userId);
  const row = rows.get(modelId);
  if (!row) return null;
  return applyLocalModelMetadata([modelId], rows)[0] ?? null;
}

export async function updateLocalModelMetadata(
  userId: string,
  input: UpdateLocalModelMetadataInput,
): Promise<LocalModelMetadata> {
  const modelId = input.modelId.trim();
  if (!modelId || modelId.length > 512) {
    throw new Error('Invalid local model ID');
  }

  // Only allow overlays for models currently advertised by the configured runtime.
  const discovered = await discoverLocalModels(userId);
  if (!discovered.some((model) => model.modelId === modelId)) {
    throw new Error('Local model is not currently advertised by /v1/models');
  }

  // Generated Supabase types can lag migrations, so keep this isolated cast here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getServiceRoleSupabaseClient() as any;
  const row = {
    user_id: userId,
    model_id: modelId,
    display_name: input.displayName?.trim() || modelId,
    supports_tools: input.supportsTools,
    supports_thinking: input.supportsThinking,
    supports_vision: input.supportsVision,
    context_limit: input.contextLimit ?? null,
    output_limit: input.outputLimit ?? null,
    is_visible: input.isVisible,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('ai_local_model_metadata')
    .upsert(row, { onConflict: 'user_id,model_id' });
  if (error) {
    throw new Error(`Failed to save local model metadata: ${error.message}`);
  }

  const saved = await getLocalModelMetadataById(userId, modelId);
  if (!saved) throw new Error('Local model metadata was not persisted');
  return saved;
}
