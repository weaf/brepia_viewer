import { isInternalCreativeRuntimeModelId } from '@shared/creativeRuntimeModels';
import { env } from './env';
import { parseLocalOpenAiModelIds } from './localModels';

const DEFAULT_LLAMA_SWAP_URL = 'http://127.0.0.1:8080';

export type DiscoveredCreativeRuntimeModel = {
  modelId: string;
};

function llamaSwapUrl(): string {
  return (env('BREPIA_LLAMA_SWAP_URL') || DEFAULT_LLAMA_SWAP_URL).replace(
    /\/+$/,
    '',
  );
}

function llamaSwapHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const apiKey = env('BREPIA_LLAMA_SWAP_API_KEY').trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export function selectCreativeRuntimeModelIds(modelIds: string[]): string[] {
  return modelIds.filter(isInternalCreativeRuntimeModelId);
}

export async function discoverCreativeRuntimeModels(
  timeoutMs = 3000,
): Promise<DiscoveredCreativeRuntimeModel[]> {
  const response = await fetch(`${llamaSwapUrl()}/v1/models`, {
    headers: llamaSwapHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(
      `Creative runtime model discovery failed: ${response.status} ${response.statusText}`,
    );
  }

  const modelIds = selectCreativeRuntimeModelIds(
    parseLocalOpenAiModelIds(await response.json()),
  );
  return modelIds.map((modelId) => ({ modelId }));
}
