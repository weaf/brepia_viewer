import { Buffer } from 'node:buffer';
import type { SupabaseClient } from './supabaseClient';
import { fal } from '@fal-ai/client';
import OpenAI from 'openai';
import { reformatSignedUrl } from './messageUtils';
import { env, requiredEnv } from './env';
import { resolveUserInstruction } from './aiInstructionRuntime';

const DEBUG_LOGS =
  env('ENVIRONMENT') === 'local' || env('DEBUG_LOGS') === 'true';
const debugLog = (...args: unknown[]) => {
  if (DEBUG_LOGS) console.log(...args);
};

/**
 * Compatibility marker used by the optional legacy fal.ai pipeline. The
 * actual conditioning text is resolved from the user's instruction profile
 * immediately before a provider request is sent.
 */
export const INSTRUCTIONS_3D = '[[BREPIA_FAL_IMAGE_CONDITIONING]]';

const LEGACY_IMAGE_GUIDANCE =
  /You are generating a fully textured and rendered 3D model\. Output one centered 3D model or multiple centered objects, no text\.\s*Plain white background \(or an empty background which provides optimal contrast with the textures of the 3D model\)\s*,?\s*neutral lighting, and a soft shadow directly under the 3D model\. Keep the entire object fully in-frame with 5[–-]10% padding; no cropping\. Make sure the description strongly impacts the form and shape of the 3D Model not just the surface texture/gi;

async function resolveFalImagePrompt(
  userId: string,
  prompt: string,
): Promise<string> {
  const conditioning = await resolveUserInstruction(
    userId,
    'provider.fal.image_conditioning',
  );
  const resolved = prompt
    .split(INSTRUCTIONS_3D)
    .join(conditioning)
    .replace(LEGACY_IMAGE_GUIDANCE, conditioning)
    .trim();
  return resolved || conditioning;
}

let falConfigured = false;
function ensureFalConfig() {
  if (falConfigured) return;
  fal.config({ credentials: requiredEnv('FAL_KEY') });
  falConfigured = true;
}

export type GptImageQuality = 'low' | 'medium' | 'high';

export type OpenAiImageResult = {
  imageBytes: Buffer;
  imageCallId: string | null;
  // MIME of the returned bytes — configured OpenAI image model returns jpeg per our tool
  // config. Callers must use this when persisting to storage so the
  // Content-Type header matches the actual bytes.
  contentType: 'image/jpeg';
};

/**
 * Generates an image with configured OpenAI image model via the OpenAI Responses API.
 * This is the default image model for mesh mode.
 *
 * Multi-turn: when `priorImageCallId` is provided, the prior
 * image_generation_call is referenced by ID (the canonical edit pattern)
 * instead of re-encoding the image as base64. Newly uploaded references
 * (no prior call ID) fall through to input_image base64.
 *
 * Output format: jpeg. Per OpenAI's docs, jpeg is faster than png with
 * the image_generation tool, and our downstream 3D pipelines don't need
 * alpha (we also set background=opaque). Latency win.
 */
export const generateImageWithOpenAiImageTool = async (
  supabaseClient: SupabaseClient,
  openAI: OpenAI,
  userId: string,
  conversationId: string,
  prompt: string,
  images: string[],
  priorImageCallId: string | null,
  orchestratorModelId: string,
  imageModelId: string,
  // 'low' (~$0.006) for fast/draft use, 'high' (~$0.21) for final mesh
  // seeds. 'medium' also available (~$0.053).
  quality: GptImageQuality,
): Promise<OpenAiImageResult> => {
  const resolvedPrompt = await resolveFalImagePrompt(userId, prompt);
  debugLog(
    'Generating image with configured OpenAI image model via Responses API',
    {
      userId,
      conversationId,
      prompt: resolvedPrompt,
      imagesCount: images.length,
      priorImageCallId,
    },
  );

  const content: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string; detail: 'auto' }
  > = [{ type: 'input_text', text: resolvedPrompt }];

  // Base64 path is only used when we have no prior configured OpenAI image model call to
  // reference (e.g. a freshly uploaded user image).
  const shouldEncodeReference = !priorImageCallId && images.length > 0;

  if (shouldEncodeReference) {
    const latestImageId = images[images.length - 1];
    const { data: imageData } = await supabaseClient.storage
      .from('images')
      .download(`${userId}/${conversationId}/${latestImageId}`);

    if (!imageData) {
      throw new Error(`Failed to download image ${latestImageId}`);
    }

    const imageArrayBuffer = await imageData.arrayBuffer();
    const base64Image = Buffer.from(imageArrayBuffer).toString('base64');
    const mimeType =
      imageData.type && imageData.type.startsWith('image/')
        ? imageData.type
        : 'image/png';

    content.push({
      type: 'input_image',
      image_url: `data:${mimeType};base64,${base64Image}`,
      detail: 'auto',
    });
  }

  const input: Array<
    | { role: 'user'; content: typeof content }
    | {
        type: 'image_generation_call';
        id: string;
        result: string | null;
        status: 'completed';
      }
  > = [];

  // Prior assistant-side image_generation_call must precede the new user
  // message so the model sees the image it produced before the edit request.
  if (priorImageCallId) {
    input.push({
      type: 'image_generation_call',
      id: priorImageCallId,
      result: null,
      status: 'completed',
    });
  }

  input.push({ role: 'user', content });

  const response = await openAI.responses.create({
    model: orchestratorModelId,
    input,
    tools: [
      {
        type: 'image_generation',
        model: imageModelId,
        quality,
        size: '1024x1024',
        output_format: 'jpeg',
        background: 'opaque',
        moderation: 'low',
      },
    ],
  });

  const imageCalls = response.output.flatMap((item) =>
    item.type === 'image_generation_call' ? [item] : [],
  );
  const latestCall = imageCalls[imageCalls.length - 1];

  if (!latestCall?.result) {
    throw new Error(
      'No generated image data from configured OpenAI image model',
    );
  }

  debugLog('Successfully generated image with configured OpenAI image model', {
    imageCallId: latestCall.id,
    status: latestCall.status,
  });

  return {
    imageBytes: Buffer.from(latestCall.result, 'base64'),
    imageCallId: latestCall.id,
    contentType: 'image/jpeg',
  };
};

export const generateImageWithFalFlux = async (
  supabaseClient: SupabaseClient,
  userId: string,
  conversationId: string,
  promptText: string,
  images: string[],
  textModelId: string,
  referenceModelId: string,
) => {
  ensureFalConfig();
  // Extract all available images for visual context, similar to how OpenAI processes them
  const contextImages: string[] = [];

  if (images.length > 0) {
    // Process images the same way OpenAI would, but collect them for Flux
    await Promise.all(
      images.map(async (image) => {
        // First check if this image exists in storage
        const { data: exists } = await supabaseClient.storage
          .from('images')
          .exists(`${userId}/${conversationId}/${image}`);

        if (exists) {
          contextImages.push(image);
        }
      }),
    );
  }

  const enhancedPrompt = await resolveFalImagePrompt(userId, promptText);

  let imageInputs: string[] = [];
  if (contextImages.length > 0) {
    const imageFiles = contextImages.map((image) => {
      return `${userId}/${conversationId}/${image}`;
    });

    const { data: rawImageUrls } = await supabaseClient.storage
      .from('images')
      .createSignedUrls(imageFiles, 60 * 60);

    if (!rawImageUrls) {
      throw new Error('No image URL from Flux');
    }

    imageInputs = rawImageUrls
      .filter((image) => !image.error && image.signedUrl)
      .map((image) => reformatSignedUrl(image.signedUrl!));
  }

  if (imageInputs.length > 0) {
    const result = await fal.run(referenceModelId, {
      input: {
        prompt: enhancedPrompt,
        image_urls: imageInputs,
        safety_tolerance: '6',
      },
    });

    const imageUrl = result.data.images[0];
    const response = await fetch(imageUrl.url);
    const imageBytes = await response.arrayBuffer();
    return Buffer.from(imageBytes);
  }

  const result = await fal.run(textModelId, {
    input: {
      prompt: enhancedPrompt,
      safety_tolerance: '6',
    },
  });

  const imageUrl = result.data.images[0];
  const response = await fetch(imageUrl.url);
  const imageBytes = await response.arrayBuffer();
  return Buffer.from(imageBytes);
};
