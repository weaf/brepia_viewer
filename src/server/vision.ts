import { createHash } from 'node:crypto';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type {
  LanguageModelV3,
  LanguageModelV3FilePart,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ToolResultPart,
} from '@ai-sdk/provider';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { generateText, wrapLanguageModel, type LanguageModel } from 'ai';
import { isCustomProviderModel } from '@shared/customModelIds';
import { PARAMETRIC_MODELS } from '../lib/utils';
import { getPreferencesByUserId } from './aiSettings';
import {
  resolveInstructionFromPreferences,
  resolveRuntimeNumberFromPreferences,
} from './aiInstructionRuntime';
import { loadBuiltinProviderRuntimeOverrides } from './builtinProviderOverrides';
import { buildCustomChatModel } from './customProviders';
import {
  getLocalModelMetadataById,
  getLocalRuntimeConfig,
} from './localModels';
import { env } from './env';
import { logWarning } from './serverLog';

const MAX_CACHE_ENTRIES = 128;

export const VISION_NOT_CONFIGURED_MESSAGE =
  'Vision models are not configured. Open Settings → Vision and select a Fast vision model before using a text-only model or OpenCode/Codex with images.';

type VisionTransportKind = 'normal' | 'streaming-opencode' | 'cli-agent';
export type VisionAnalysisKind = 'reference' | 'inspection';

export type VisionAnalysisRequest = {
  kind: VisionAnalysisKind;
  images: string[];
  userRequest?: string;
  signal?: AbortSignal;
};

export type VisionAnalyzer = (
  request: VisionAnalysisRequest,
) => Promise<string | undefined>;

type VisionModelPreferences = {
  visionFastModelId: string | null;
  visionDeepModelId: string | null;
};

type ResolvedVisionModel = {
  modelId: string;
  model: LanguageModel;
  providerOptions?: ProviderOptions;
};

const visionCache = new Map<string, Promise<string | undefined>>();

export function selectVisionModelId(
  kind: VisionAnalysisKind,
  preferences: VisionModelPreferences,
): string | undefined {
  if (kind === 'inspection') {
    return (
      preferences.visionDeepModelId ??
      preferences.visionFastModelId ??
      undefined
    );
  }
  return preferences.visionFastModelId ?? undefined;
}

function combinedSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function normalizedAnthropicBaseURL(rawOverride?: string): string | undefined {
  const raw = (rawOverride ?? env('ANTHROPIC_BASE_URL')).trim();
  if (!raw) return undefined;
  const base = raw.replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

async function resolveBuiltInVisionModel(
  userId: string,
  modelId: string,
): Promise<ResolvedVisionModel> {
  if (modelId.startsWith('local/')) {
    const nativeModelId = modelId.slice('local/'.length);
    const metadata = await getLocalModelMetadataById(userId, nativeModelId);
    if (!metadata?.supportsVision || !metadata.isVisible) {
      throw new Error(
        `Configured local vision model is not vision-capable: ${modelId}`,
      );
    }
    const runtime = await getLocalRuntimeConfig(userId);
    if (!runtime?.enabled) {
      throw new Error('Local provider is disabled or not configured');
    }
    const provider = createOpenAICompatible({
      name: 'local',
      baseURL: runtime.baseUrl,
      apiKey: runtime.apiKey,
    });
    return { modelId, model: provider(nativeModelId) };
  }

  const catalogModel = PARAMETRIC_MODELS.find((entry) => entry.id === modelId);
  if (!catalogModel?.supportsVision) {
    throw new Error(
      `Configured vision model is not vision-capable: ${modelId}`,
    );
  }

  const overrides = await loadBuiltinProviderRuntimeOverrides(userId);

  if (modelId.startsWith('anthropic/')) {
    const override = overrides.anthropic;
    if (override?.enabled === false) {
      throw new Error('Anthropic provider is disabled');
    }
    const id = modelId.slice('anthropic/'.length).replace(/\./g, '-');
    const baseURL = normalizedAnthropicBaseURL(override?.baseUrl);
    const provider = createAnthropic({
      apiKey: override?.credential ?? env('ANTHROPIC_API_KEY'),
      ...(baseURL ? { baseURL } : {}),
    });
    return { modelId, model: provider(id) };
  }

  if (modelId.startsWith('google/')) {
    const override = overrides.google;
    if (override?.enabled === false) {
      throw new Error('Google provider is disabled');
    }
    const baseURL = override?.baseUrl || env('GOOGLE_BASE_URL').trim();
    const provider = createGoogleGenerativeAI({
      apiKey: override?.credential ?? env('GOOGLE_API_KEY'),
      ...(baseURL ? { baseURL } : {}),
    });
    return { modelId, model: provider(modelId.slice('google/'.length)) };
  }

  const override = overrides.openrouter;
  if (override?.enabled === false) {
    throw new Error('OpenRouter provider is disabled');
  }
  const baseURL = override?.baseUrl || env('OPENROUTER_BASE_URL').trim();
  const provider = createOpenRouter({
    apiKey: override?.credential ?? env('OPENROUTER_API_KEY'),
    ...(baseURL ? { baseURL } : {}),
  });
  return {
    modelId,
    model: provider.chat(modelId, { usage: { include: true } }),
  };
}

async function resolveVisionModel(
  userId: string,
  modelId: string,
): Promise<ResolvedVisionModel> {
  if (isCustomProviderModel(modelId)) {
    const built = await buildCustomChatModel(modelId, userId, false);
    if (!built.capabilities.supportsVision) {
      throw new Error(
        `Configured custom model is not vision-capable: ${modelId}`,
      );
    }
    return {
      modelId,
      model: built.model,
      providerOptions: built.providerOptions,
    };
  }

  return resolveBuiltInVisionModel(userId, modelId);
}

function cacheKey({
  userId,
  kind,
  modelId,
  images,
  prompt,
  timeoutMs,
  temperature,
  maxOutputTokens,
}: {
  userId: string;
  kind: VisionAnalysisKind;
  modelId: string;
  images: string[];
  prompt: string;
  timeoutMs: number;
  temperature: number;
  maxOutputTokens: number;
}): string {
  const hash = createHash('sha256');
  hash.update(userId);
  hash.update('\0');
  hash.update(kind);
  hash.update('\0');
  hash.update(modelId);
  hash.update('\0');
  hash.update(prompt);
  hash.update('\0');
  hash.update(String(timeoutMs));
  hash.update('\0');
  hash.update(String(temperature));
  hash.update('\0');
  hash.update(String(maxOutputTokens));
  for (const image of images) {
    hash.update('\0');
    hash.update(image);
  }
  return hash.digest('hex');
}

function rememberVisionResult(
  key: string,
  value: Promise<string | undefined>,
): Promise<string | undefined> {
  if (visionCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = visionCache.keys().next().value as string | undefined;
    if (oldest) visionCache.delete(oldest);
  }
  visionCache.set(key, value);
  return value;
}

async function analyzeImagesWithConfiguredVision(
  userId: string,
  { kind, images, userRequest, signal }: VisionAnalysisRequest,
): Promise<string | undefined> {
  if (images.length === 0) return undefined;

  const preferences = await getPreferencesByUserId(userId);
  const selectedModelId = selectVisionModelId(kind, preferences);
  if (!selectedModelId) {
    logWarning(VISION_NOT_CONFIGURED_MESSAGE, {
      functionName: 'brepia-vision-fallback',
    });
    throw new Error(VISION_NOT_CONFIGURED_MESSAGE);
  }

  const prompt = await resolveInstructionFromPreferences(
    userId,
    preferences,
    kind === 'inspection' ? 'vision.inspection' : 'vision.reference',
    { userRequest: userRequest?.trim() ?? '' },
  );
  const timeoutMs = resolveRuntimeNumberFromPreferences(
    preferences,
    'vision.timeoutMs',
  );
  const temperature = resolveRuntimeNumberFromPreferences(
    preferences,
    'vision.temperature',
  );
  const maxOutputTokens = resolveRuntimeNumberFromPreferences(
    preferences,
    kind === 'inspection'
      ? 'vision.inspectionMaxOutputTokens'
      : 'vision.referenceMaxOutputTokens',
  );

  const key = cacheKey({
    userId,
    kind,
    modelId: selectedModelId,
    images,
    prompt,
    timeoutMs,
    temperature,
    maxOutputTokens,
  });
  const cached = visionCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const runtime = await resolveVisionModel(userId, selectedModelId);
      const result = await generateText({
        model: runtime.model,
        providerOptions: runtime.providerOptions,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map((image) => ({ type: 'image' as const, image })),
            ],
          },
        ],
        temperature,
        maxOutputTokens,
        abortSignal: combinedSignal(timeoutMs, signal),
      });
      const text = result.text.trim();
      if (!text) throw new Error('vision model returned no usable text');
      return text;
    } catch (error) {
      visionCache.delete(key);
      if (signal?.aborted) throw error;
      logWarning(
        `Brepia vision fallback failed (${selectedModelId}): ${error instanceof Error ? error.message : String(error)}`,
        { functionName: 'brepia-vision-fallback' },
      );
      return undefined;
    }
  })();

  return rememberVisionResult(key, pending);
}

export function createConfiguredVisionAnalyzer(userId: string): VisionAnalyzer {
  return (request) => analyzeImagesWithConfiguredVision(userId, request);
}

function dataUrlFromImageFile(
  part: LanguageModelV3FilePart,
): string | undefined {
  if (!part.mediaType.startsWith('image/')) return undefined;

  const { data } = part;
  if (data instanceof Uint8Array) {
    return `data:${part.mediaType};base64,${Buffer.from(data).toString('base64')}`;
  }
  if (data instanceof URL) {
    return data.protocol === 'data:' ? data.toString() : undefined;
  }
  if (typeof data !== 'string') return undefined;
  if (data.startsWith('data:')) return data;
  if (/^https?:\/\//i.test(data)) return undefined;
  return `data:${part.mediaType};base64,${data}`;
}

function toolImageDataUrl(
  item: Extract<
    Extract<
      LanguageModelV3ToolResultPart['output'],
      { type: 'content' }
    >['value'][number],
    { type: 'image-data' | 'image-url' | 'file-data' }
  >,
): string | undefined {
  if (item.type === 'image-data') {
    return item.data.startsWith('data:')
      ? item.data
      : `data:${item.mediaType};base64,${item.data}`;
  }
  if (item.type === 'image-url') {
    return item.url.startsWith('data:') ? item.url : undefined;
  }
  if (item.type === 'file-data' && item.mediaType.startsWith('image/')) {
    return item.data.startsWith('data:')
      ? item.data
      : `data:${item.mediaType};base64,${item.data}`;
  }
  return undefined;
}

function latestUserRequest(prompt: LanguageModelV3Prompt): string {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index];
    if (message.role !== 'user') continue;
    return message.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

type UserMessage = Extract<LanguageModelV3Message, { role: 'user' }>;
type AssistantMessage = Extract<LanguageModelV3Message, { role: 'assistant' }>;
type ToolMessage = Extract<LanguageModelV3Message, { role: 'tool' }>;

async function rewriteMultimodalMessage<
  T extends UserMessage | AssistantMessage,
>(
  message: T,
  analyzer: VisionAnalyzer,
  userRequest: string,
  signal?: AbortSignal,
): Promise<T> {
  const images = message.content.flatMap((part) => {
    if (part.type !== 'file') return [];
    const image = dataUrlFromImageFile(part);
    return image ? [image] : [];
  });
  if (images.length === 0) return message;

  const analysis = await analyzer({
    kind: 'reference',
    images,
    userRequest,
    signal,
  });
  const replacement = analysis
    ? `[Brepia vision fallback — visual reference]\n${analysis}`
    : '[Brepia vision fallback unavailable — visual reference could not be analyzed]';

  let inserted = false;
  const content = message.content.flatMap((part) => {
    if (part.type !== 'file' || !dataUrlFromImageFile(part)) return [part];
    if (inserted) return [];
    inserted = true;
    return [{ type: 'text' as const, text: replacement }];
  });

  return { ...message, content } as T;
}

async function rewriteToolResult(
  part: LanguageModelV3ToolResultPart,
  analyzer: VisionAnalyzer,
  userRequest: string,
  signal?: AbortSignal,
): Promise<LanguageModelV3ToolResultPart> {
  if (part.output.type !== 'content') return part;

  const images = part.output.value.flatMap((item) => {
    if (
      item.type !== 'image-data' &&
      item.type !== 'image-url' &&
      item.type !== 'file-data'
    ) {
      return [];
    }
    const image = toolImageDataUrl(item);
    return image ? [image] : [];
  });
  if (images.length === 0) return part;

  const analysis = await analyzer({
    kind: 'inspection',
    images,
    userRequest,
    signal,
  });
  const replacement = analysis
    ? `[Brepia vision fallback — rendered inspection]\n${analysis}`
    : '[Brepia vision fallback unavailable — rendered inspection could not be analyzed]';

  const retained = part.output.value.filter((item) => {
    if (
      item.type !== 'image-data' &&
      item.type !== 'image-url' &&
      item.type !== 'file-data'
    ) {
      return true;
    }
    return !toolImageDataUrl(item);
  });

  return {
    ...part,
    output: {
      ...part.output,
      value: [...retained, { type: 'text', text: replacement }],
    },
  };
}

async function rewriteToolMessage(
  message: ToolMessage,
  analyzer: VisionAnalyzer,
  userRequest: string,
  signal?: AbortSignal,
): Promise<ToolMessage> {
  return {
    ...message,
    content: await Promise.all(
      message.content.map((part) =>
        part.type === 'tool-result'
          ? rewriteToolResult(part, analyzer, userRequest, signal)
          : part,
      ),
    ),
  };
}

export async function rewritePromptForVisionFallback(
  prompt: LanguageModelV3Prompt,
  options: { analyzer: VisionAnalyzer; signal?: AbortSignal },
): Promise<LanguageModelV3Prompt> {
  const userRequest = latestUserRequest(prompt);

  return Promise.all(
    prompt.map((message) => {
      switch (message.role) {
        case 'user':
        case 'assistant':
          return rewriteMultimodalMessage(
            message,
            options.analyzer,
            userRequest,
            options.signal,
          );
        case 'tool':
          return rewriteToolMessage(
            message,
            options.analyzer,
            userRequest,
            options.signal,
          );
        default:
          return message;
      }
    }),
  );
}

/**
 * Decide whether Brepia should preserve image parts for the selected model.
 * Explicit static/custom-provider capabilities are authoritative. Dynamic local
 * models are conservatively routed through the configured vision analyzer so a
 * text-only llama-swap model is never accidentally sent raw image parts.
 */
export function modelSupportsDirectVision(
  modelId: string,
  transportKind: VisionTransportKind,
  customSupportsVision?: boolean,
): boolean {
  if (transportKind !== 'normal') return false;
  if (customSupportsVision !== undefined) return customSupportsVision;
  if (
    modelId.startsWith('agent/codex/') ||
    modelId.startsWith('agent/opencode/') ||
    modelId.startsWith('opencode/') ||
    modelId.startsWith('local/')
  ) {
    return false;
  }

  const configured = PARAMETRIC_MODELS.find((model) => model.id === modelId);
  return configured ? configured.supportsVision === true : true;
}

/**
 * Wrap a text-only LanguageModelV3 so image inputs are converted to textual
 * observations by the user's configured Fast/Deep vision models. Native
 * multimodal models are never wrapped and keep the original image parts.
 *
 * Use the AI SDK middleware wrapper rather than object-spreading the provider
 * model. Provider capabilities such as supportedUrls may be exposed through
 * prototype getters and are therefore lost by a plain object spread.
 */
export function withVisionFallback(
  model: LanguageModel,
  userId: string,
): LanguageModel {
  const v3 = model as LanguageModelV3;
  if (v3.specificationVersion !== 'v3') return model;
  const analyzer = createConfiguredVisionAnalyzer(userId);

  return wrapLanguageModel({
    model: v3,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => ({
        ...params,
        prompt: await rewritePromptForVisionFallback(params.prompt, {
          analyzer,
          signal: params.abortSignal,
        }),
      }),
    },
  });
}
