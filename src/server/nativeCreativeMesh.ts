import { Buffer } from 'node:buffer';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
  NATIVE_CREATIVE_MESH_MODEL_ID,
  type CreativeMeshModelId,
} from '@shared/creativeMeshModels';
import { imageIdFromFilename } from '@shared/imageRefs';
import type { AiPreferencesDto } from '@shared/aiSettings';
import {
  requireCreativeRuntimeModel,
  type CreativeRuntimeModelRouting,
  type LocalCreativeProfile,
} from '@shared/modelRouting';
import type { MeshFileType } from '@shared/types';
import { corsHeaders, isRecord } from './api';
import {
  loadUserAiPreferences,
  resolveRuntimeNumberFromPreferences,
  resolveRuntimeStringFromPreferences,
} from './aiInstructionRuntime';
import { resolveCreativeConversationProfile } from './creativeConversationProfile';
import { env } from './env';
import { logError } from './serverLog';
import {
  getServiceRoleSupabaseClient,
  type SupabaseClient,
} from './supabaseClient';

const DEFAULT_LLAMA_SWAP_URL = 'http://127.0.0.1:8080';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_ALIAS_RE = /^image-(\d+)(?:\.[^.]+)?$/i;

type NativeCreativeStage =
  | 'llama-swap-health'
  | 'job-create'
  | 'image-download'
  | 'conditioning-image-generate'
  | 'mesh-generate'
  | 'storage-persist';

type NativeCreativeMeshRequestBody = {
  images?: string[];
  mesh?: string;
  text?: string;
  conversationId?: string;
  model?: string;
};

type ImageInput = {
  bytes: ArrayBuffer;
  mediaType: string;
  filename: string;
};

type NativeCreativeRuntime = {
  healthTimeoutMs: number;
  imageGenerationTimeoutMs: number;
  meshGenerationTimeoutMs: number;
  trellisResolution: '512' | '1024' | '1536';
};

type BufferedHttpResponse = {
  statusCode: number;
  contentType: string;
  body: Buffer;
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function localError(message: string, status = 400): Response {
  return jsonResponse({ error: { message } }, status);
}

function errorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return null;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const directCode = errorCode(error);
  const cause = 'cause' in error ? error.cause : undefined;
  if (cause instanceof Error) {
    const causeCode = errorCode(cause);
    const code = causeCode ? ` [${causeCode}]` : '';
    return `${error.message}: ${cause.name}${code}: ${cause.message}`;
  }

  return directCode ? `${error.message} [${directCode}]` : error.message;
}

function nativeCreativeLog(
  stage: NativeCreativeStage,
  message: string,
  context: Record<string, unknown> = {},
) {
  console.log('[native-creative-mesh]', { stage, message, ...context });
}

function llamaSwapUrl(): string {
  return (env('BREPIA_LLAMA_SWAP_URL') || DEFAULT_LLAMA_SWAP_URL).replace(
    /\/+$/,
    '',
  );
}

function llamaSwapHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = {};
  const apiKey = env('BREPIA_LLAMA_SWAP_API_KEY').trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function encodedModelPath(modelId: string): string {
  return modelId.split('/').map(encodeURIComponent).join('/');
}

function configuredTrellisResolution(
  preferences: AiPreferencesDto,
): '512' | '1024' | '1536' {
  const userOverride =
    preferences.runtimeOverrides['creative.trellisResolution'];
  if (
    userOverride === '512' ||
    userOverride === '1024' ||
    userOverride === '1536'
  ) {
    return userOverride;
  }

  const deploymentOverride = env('BREPIA_TRELLIS2_RESOLUTION').trim();
  if (
    deploymentOverride === '512' ||
    deploymentOverride === '1024' ||
    deploymentOverride === '1536'
  ) {
    return deploymentOverride;
  }

  const configured = resolveRuntimeStringFromPreferences(
    preferences,
    'creative.trellisResolution',
  );
  if (configured === '512' || configured === '1024' || configured === '1536') {
    return configured;
  }
  throw new Error(`Unsupported TRELLIS.2 resolution: ${configured}`);
}

function resolveNativeCreativeRuntime(
  preferences: AiPreferencesDto,
  profile: LocalCreativeProfile | null,
): NativeCreativeRuntime {
  const legacyImageTimeoutMs = resolveRuntimeNumberFromPreferences(
    preferences,
    'creative.imageGenerationTimeoutMs',
  );
  const legacyMeshTimeoutMs = resolveRuntimeNumberFromPreferences(
    preferences,
    'creative.meshGenerationTimeoutMs',
  );

  return {
    healthTimeoutMs: resolveRuntimeNumberFromPreferences(
      preferences,
      'creative.healthTimeoutMs',
    ),
    imageGenerationTimeoutMs:
      profile?.imageGenerationTimeoutMs ?? legacyImageTimeoutMs,
    meshGenerationTimeoutMs:
      profile?.meshGenerationTimeoutMs ?? legacyMeshTimeoutMs,
    trellisResolution:
      profile?.resolution ?? configuredTrellisResolution(preferences),
  };
}

function zImageSize(): string {
  const configured = env('BREPIA_Z_IMAGE_SIZE').trim();
  return /^\d{3,4}x\d{3,4}$/.test(configured) ? configured : '1024x1024';
}

function failureDetailFromText(status: number, text: string): string {
  if (!text) return `HTTP ${status}`;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) {
      if (typeof parsed.error === 'string') return parsed.error;
      if (typeof parsed.detail === 'string') return parsed.detail;
      if (isRecord(parsed.error) && typeof parsed.error.message === 'string') {
        return parsed.error.message;
      }
    }
  } catch {
    // Keep the upstream text below.
  }
  return text.slice(0, 1000);
}

async function responseFailureDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return failureDetailFromText(response.status, text);
}

async function bufferedHttpRequest({
  url,
  headers,
  body,
  timeoutMs,
}: {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
  timeoutMs: number;
}): Promise<BufferedHttpResponse> {
  const target = new URL(url);
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const signal = AbortSignal.timeout(timeoutMs);

  return await new Promise<BufferedHttpResponse>((resolve, reject) => {
    const request = requestFn(
      target,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': String(body.byteLength),
        },
        signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('error', reject);
        response.on('aborted', () =>
          reject(new Error('Upstream response was aborted before completion')),
        );
        response.on('end', () => {
          const rawContentType = response.headers['content-type'];
          const contentType = Array.isArray(rawContentType)
            ? rawContentType.join(', ')
            : (rawContentType ?? '');
          resolve({
            statusCode: response.statusCode ?? 0,
            contentType,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    request.on('error', reject);
    request.end(body);
  });
}

async function encodeMultipartForm(form: FormData): Promise<{
  body: Buffer;
  contentType: string;
}> {
  const encodedRequest = new Request('http://native-creative.local/', {
    method: 'POST',
    body: form,
  });
  const contentType = encodedRequest.headers.get('content-type');
  if (!contentType) {
    throw new Error('Failed to encode native Creative multipart request');
  }
  return {
    body: Buffer.from(await encodedRequest.arrayBuffer()),
    contentType,
  };
}

async function ensureLlamaSwapModels(
  requiredModelIds: string[],
  timeoutMs: number,
): Promise<void> {
  const baseUrl = llamaSwapUrl();
  nativeCreativeLog('llama-swap-health', 'checking llama-swap model catalog', {
    llamaSwapUrl: baseUrl,
    requiredModelIds,
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/models`, {
      headers: llamaSwapHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(
      `llama-swap is not reachable at ${baseUrl}. Start llama-swap with the Creative runtime models configured. (${errorMessage(error)})`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `llama-swap model discovery failed: ${await responseFailureDetail(response)}`,
    );
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('llama-swap returned an invalid /v1/models response');
  }

  const available = new Set(
    payload.data
      .filter(isRecord)
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string'),
  );
  const missing = requiredModelIds.filter((id) => !available.has(id));
  if (missing.length > 0) {
    throw new Error(
      `llama-swap is running but missing Creative runtime model${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
    );
  }
}

function imageIdsFromMessageParts(parts: unknown): string[] {
  if (!Array.isArray(parts)) return [];
  const ids: string[] = [];
  for (const part of parts) {
    if (!isRecord(part) || part.type !== 'file') continue;
    if (
      typeof part.mediaType === 'string' &&
      !part.mediaType.startsWith('image/')
    ) {
      continue;
    }
    const filename = typeof part.filename === 'string' ? part.filename : null;
    const imageId = imageIdFromFilename(filename);
    if (imageId && UUID_RE.test(imageId)) ids.push(imageId);
  }
  return Array.from(new Set(ids));
}

async function currentLeafImageIds(
  supabase: SupabaseClient,
  conversationId: string,
  leafMessageId: string | null | undefined,
): Promise<string[]> {
  if (!leafMessageId) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('parts, role')
    .eq('id', leafMessageId)
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to resolve Creative reference images: ${error.message}`,
    );
  }
  if (!data || data.role !== 'user') return [];
  return imageIdsFromMessageParts(data.parts);
}

function resolveRequestedImageIds(
  requested: string[],
  attachedImageIds: string[],
): string[] {
  if (requested.length === 0) return attachedImageIds;

  const resolved: string[] = [];
  for (const raw of requested) {
    if (UUID_RE.test(raw)) {
      resolved.push(raw);
      continue;
    }

    const filenameId = imageIdFromFilename(raw);
    if (filenameId && UUID_RE.test(filenameId)) {
      resolved.push(filenameId);
      continue;
    }

    const alias = raw.match(IMAGE_ALIAS_RE);
    if (alias) {
      const index = Number(alias[1]) - 1;
      if (Number.isInteger(index) && attachedImageIds[index]) {
        resolved.push(attachedImageIds[index]);
      }
    }
  }

  if (resolved.length === 0 && attachedImageIds.length === 1) {
    resolved.push(attachedImageIds[0]);
  }

  return Array.from(new Set(resolved));
}

async function downloadReferenceImage(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  imageId: string,
): Promise<ImageInput> {
  const { data, error } = await supabase.storage
    .from('images')
    .download(`${userId}/${conversationId}/${imageId}`);
  if (error || !data) {
    throw new Error(
      `Failed to load Creative reference image ${imageId}${error?.message ? `: ${error.message}` : ''}`,
    );
  }
  return {
    bytes: await data.arrayBuffer(),
    mediaType: data.type || 'image/png',
    filename: `reference-${imageId}.png`,
  };
}

async function generateConditioningImage(
  prompt: string,
  timeoutMs: number,
  model: string,
): Promise<ImageInput> {
  nativeCreativeLog(
    'conditioning-image-generate',
    'generating native conditioning image',
    {
      model,
      size: zImageSize(),
      timeoutMs,
    },
  );

  const requestBody = Buffer.from(
    JSON.stringify({
      model,
      prompt,
      n: 1,
      size: zImageSize(),
      output_format: 'png',
    }),
  );
  const response = await bufferedHttpRequest({
    url: `${llamaSwapUrl()}/v1/images/generations`,
    headers: llamaSwapHeaders(true),
    body: requestBody,
    timeoutMs,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Conditioning image generation failed: ${failureDetailFromText(
        response.statusCode,
        response.body.toString('utf8'),
      )}`,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body.toString('utf8')) as unknown;
  } catch {
    payload = null;
  }
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('Conditioning image runtime returned an invalid response');
  }
  const first = payload.data[0];
  if (!isRecord(first) || typeof first.b64_json !== 'string') {
    throw new Error(
      'Conditioning image response did not contain base64 image data',
    );
  }

  const decoded = Buffer.from(first.b64_json, 'base64');
  if (decoded.length === 0) {
    throw new Error('Conditioning image runtime returned an empty image');
  }
  const bytes = Uint8Array.from(decoded);
  return {
    bytes: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
    mediaType: 'image/png',
    filename: 'native-conditioning.png',
  };
}

async function generateNativeMeshGlb(
  image: ImageInput,
  runtime: NativeCreativeRuntime,
  model: string,
): Promise<ArrayBuffer> {
  const form = new FormData();
  form.append(
    'image',
    new Blob([image.bytes], { type: image.mediaType }),
    image.filename,
  );
  form.append('resolution', runtime.trellisResolution);

  const url = `${llamaSwapUrl()}/upstream/${encodedModelPath(model)}/generate`;
  nativeCreativeLog('mesh-generate', 'starting native mesh generation', {
    model,
    resolution: runtime.trellisResolution,
    timeoutMs: runtime.meshGenerationTimeoutMs,
    via: url,
  });

  const encoded = await encodeMultipartForm(form);
  const response = await bufferedHttpRequest({
    url,
    headers: {
      ...llamaSwapHeaders(),
      'Content-Type': encoded.contentType,
    },
    body: encoded.body,
    timeoutMs: runtime.meshGenerationTimeoutMs,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Native mesh generation failed: ${failureDetailFromText(
        response.statusCode,
        response.body.toString('utf8'),
      )}`,
    );
  }

  if (
    !response.contentType.includes('model/gltf-binary') &&
    !response.contentType.includes('application/octet-stream')
  ) {
    throw new Error(
      `Native mesh runtime returned unexpected content type: ${response.contentType || 'missing'}`,
    );
  }

  if (response.body.byteLength < 12) {
    throw new Error('Native mesh runtime returned an empty or invalid GLB');
  }
  const bytes = Uint8Array.from(response.body);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function persistMeshResult({
  supabase,
  userId,
  conversationId,
  meshId,
  bytes,
}: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  meshId: string;
  bytes: ArrayBuffer;
}) {
  const { error: uploadError } = await supabase.storage
    .from('meshes')
    .upload(`${userId}/${conversationId}/${meshId}.glb`, bytes, {
      contentType: 'model/gltf-binary',
      upsert: true,
    });
  if (uploadError) {
    throw new Error(
      `Failed to store native Creative mesh: ${uploadError.message}`,
    );
  }

  const { error: updateError } = await supabase
    .from('meshes')
    .update({ status: 'success', file_type: 'glb' })
    .eq('id', meshId)
    .eq('user_id', userId)
    .eq('conversation_id', conversationId);
  if (updateError) {
    throw new Error(
      `Failed to finalize native Creative mesh: ${updateError.message}`,
    );
  }
}

async function markFailure(
  supabase: SupabaseClient,
  meshId: string,
  userId: string,
  conversationId: string,
  stage: NativeCreativeStage,
  error: unknown,
) {
  console.error('[native-creative-mesh] generation failed', {
    stage,
    meshId,
    conversationId,
    error: errorMessage(error),
  });
  logError(error, {
    functionName: 'native-creative-mesh',
    statusCode: 500,
    userId,
    conversationId,
    additionalContext: {
      meshId,
      model: NATIVE_CREATIVE_MESH_MODEL_ID,
      stage,
      errorDetail: errorMessage(error),
    },
  });
  await supabase
    .from('meshes')
    .update({ status: 'failure' })
    .eq('id', meshId)
    .eq('user_id', userId)
    .eq('conversation_id', conversationId);
}

export async function handleNativeCreativeMeshRequest(
  request: Request,
  parsedBody?: unknown,
): Promise<Response> {
  const body = (
    isRecord(parsedBody) ? parsedBody : await request.json().catch(() => null)
  ) as NativeCreativeMeshRequestBody | null;
  if (!body) return localError('Invalid native Creative request body');
  if (body.model !== NATIVE_CREATIVE_MESH_MODEL_ID) {
    return localError('Unknown native Creative mesh backend');
  }
  if (body.mesh) {
    return localError(
      'Follow-up editing of locally generated Creative meshes is not enabled yet.',
      422,
    );
  }

  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : undefined;
  if (!token) return localError('Unauthorized', 401);

  const supabase = getServiceRoleSupabaseClient();
  const { data: userData, error: userError } =
    await supabase.auth.getUser(token);
  if (userError || !userData.user?.id) return localError('Unauthorized', 401);

  let preferences: AiPreferencesDto;
  let modelRouting: CreativeRuntimeModelRouting;
  try {
    preferences = await loadUserAiPreferences(userData.user.id);
    modelRouting = preferences.modelRouting;
  } catch (error) {
    return localError(
      `Invalid Creative runtime settings: ${errorMessage(error)}`,
      500,
    );
  }

  const conversationId = body.conversationId;
  if (!conversationId) return localError('Conversation ID is required');

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('id, current_message_leaf_id, settings')
    .eq('id', conversationId)
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (conversationError || !conversation) {
    return localError('Conversation not found', 404);
  }

  let profileResolution: ReturnType<typeof resolveCreativeConversationProfile>;
  try {
    profileResolution = resolveCreativeConversationProfile(
      modelRouting,
      conversation.settings,
    );
  } catch (error) {
    return localError(errorMessage(error), 422);
  }
  if (profileResolution.source === 'pinned-none') {
    return localError(
      'This Creative conversation was created without a Local Creative profile. Select a default Local Creative profile and start a new Creative conversation.',
      422,
    );
  }

  const activeProfile = profileResolution.profile;
  let runtime: NativeCreativeRuntime;
  try {
    runtime = resolveNativeCreativeRuntime(preferences, activeProfile);
  } catch (error) {
    return localError(
      `Invalid Creative runtime settings: ${errorMessage(error)}`,
      500,
    );
  }

  const text = body.text?.trim() || undefined;
  let attachedImageIds: string[];
  try {
    attachedImageIds = await currentLeafImageIds(
      supabase,
      conversationId,
      conversation.current_message_leaf_id,
    );
  } catch (error) {
    return localError(errorMessage(error), 500);
  }

  const requestedImageIds = Array.isArray(body.images) ? body.images : [];
  const imageIds = resolveRequestedImageIds(
    requestedImageIds,
    attachedImageIds,
  );
  if (!text && imageIds.length === 0) {
    return localError(
      'Text or a reference image is required for native Creative generation',
    );
  }
  if (imageIds.length > 1) {
    return localError(
      'The native Creative backend currently accepts one reference image per generation. Attach or select a single image.',
      422,
    );
  }

  let nativeImageModel: string | null = null;
  let nativeMeshModel: string;
  try {
    if (activeProfile) {
      const profileMeshModel = activeProfile.meshModelId?.trim();
      if (!profileMeshModel) {
        throw new Error(
          `Local Creative profile ${activeProfile.name} does not configure a mesh runtime model.`,
        );
      }
      nativeMeshModel = profileMeshModel;

      if (imageIds.length === 0) {
        const profileImageModel = activeProfile.imageModelId?.trim();
        if (!profileImageModel) {
          throw new Error(
            `Local Creative profile ${activeProfile.name} does not configure a conditioning image model required for text-to-3D generation.`,
          );
        }
        nativeImageModel = profileImageModel;
      }
    } else {
      nativeMeshModel = requireCreativeRuntimeModel(
        modelRouting,
        'nativeMeshModelId',
      );
      if (imageIds.length === 0) {
        nativeImageModel = requireCreativeRuntimeModel(
          modelRouting,
          'nativeImageModelId',
        );
      }
    }
  } catch (error) {
    return localError(errorMessage(error), 422);
  }

  const requiredRuntimeModels = [nativeMeshModel];
  if (nativeImageModel) requiredRuntimeModels.unshift(nativeImageModel);
  try {
    await ensureLlamaSwapModels(requiredRuntimeModels, runtime.healthTimeoutMs);
  } catch (error) {
    return localError(errorMessage(error), 503);
  }

  nativeCreativeLog('job-create', 'creating native Creative mesh job', {
    conversationId,
    profileId: activeProfile?.id ?? null,
    profileSource: profileResolution.source,
    imageCount: imageIds.length,
    usesConditioningImage: imageIds.length === 0,
    runtime,
  });
  const { data: meshData, error: meshError } = await supabase
    .from('meshes')
    .insert({
      user_id: userData.user.id,
      images: imageIds.length > 0 ? imageIds : null,
      conversation_id: conversationId,
      file_type: 'glb' as MeshFileType,
      prompt: {
        ...(text ? { text } : {}),
        ...(imageIds.length > 0 ? { images: imageIds } : {}),
        model: NATIVE_CREATIVE_MESH_MODEL_ID as CreativeMeshModelId,
      },
    })
    .select()
    .single();

  if (meshError || !meshData) {
    return localError(
      meshError?.message ?? 'Failed to create native Creative mesh job',
      500,
    );
  }

  let stage: NativeCreativeStage = 'image-download';
  try {
    let conditioningImage: ImageInput;
    if (imageIds.length > 0) {
      nativeCreativeLog(stage, 'loading native Creative reference image', {
        meshId: meshData.id,
        imageId: imageIds[0],
      });
      conditioningImage = await downloadReferenceImage(
        supabase,
        userData.user.id,
        conversationId,
        imageIds[0],
      );
      if (text) {
        nativeCreativeLog(
          stage,
          'reference image takes precedence over text conditioning for this generation',
          { meshId: meshData.id },
        );
      }
    } else {
      stage = 'conditioning-image-generate';
      conditioningImage = await generateConditioningImage(
        text as string,
        runtime.imageGenerationTimeoutMs,
        nativeImageModel as string,
      );
    }

    stage = 'mesh-generate';
    const glb = await generateNativeMeshGlb(
      conditioningImage,
      runtime,
      nativeMeshModel,
    );

    stage = 'storage-persist';
    await persistMeshResult({
      supabase,
      userId: userData.user.id,
      conversationId,
      meshId: meshData.id,
      bytes: glb,
    });
    nativeCreativeLog(stage, 'native Creative generation completed', {
      meshId: meshData.id,
      conversationId,
      profileId: activeProfile?.id ?? null,
      profileSource: profileResolution.source,
    });
  } catch (error) {
    await markFailure(
      supabase,
      meshData.id,
      userData.user.id,
      conversationId,
      stage,
      error,
    );
    return localError(errorMessage(error), 500);
  }

  return jsonResponse({ id: meshData.id, fileType: 'glb' }, 200);
}
