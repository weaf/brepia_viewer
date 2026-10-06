import { imageIdFromFilename } from '@shared/imageRefs';
import { isRecord } from './api';
import { hasActiveGenerationForConversation } from './activeGeneration';
import { getAnonSupabaseClient } from './supabaseClient';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_ALIAS_RE = /^image-(\d+)(?:\.[^.]+)?$/i;
const MAX_BRANCH_HOPS = 64;

export type CreativeReferenceMessage = {
  role: string;
  parentMessageId: string | null;
  parts: unknown;
};

export function creativeImageIdsFromMessageParts(parts: unknown): string[] {
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

export function resolveCreativeRequestedImageIds(
  requested: readonly string[],
  attachedImageIds: readonly string[],
): string[] {
  if (requested.length === 0) return [...attachedImageIds];

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
    if (!alias) continue;
    const index = Number(alias[1]) - 1;
    if (Number.isInteger(index) && attachedImageIds[index]) {
      resolved.push(attachedImageIds[index]);
    }
  }

  // A model can omit or hallucinate the presentation alias while the current
  // user turn has one unambiguous uploaded image. Prefer the authoritative
  // attachment rather than letting a pseudo-ID reach storage lookup.
  if (resolved.length === 0 && attachedImageIds.length === 1) {
    resolved.push(attachedImageIds[0]);
  }

  return Array.from(new Set(resolved));
}

export async function findCreativeTurnImageIds({
  leafMessageId,
  loadMessage,
}: {
  leafMessageId: string | null | undefined;
  loadMessage: (messageId: string) => Promise<CreativeReferenceMessage | null>;
}): Promise<string[]> {
  if (!leafMessageId) return [];

  const visited = new Set<string>();
  let messageId: string | null = leafMessageId;

  for (let hop = 0; messageId && hop < MAX_BRANCH_HOPS; hop += 1) {
    if (visited.has(messageId)) return [];
    visited.add(messageId);

    const message = await loadMessage(messageId);
    if (!message) return [];

    // The nearest user message is the authority for this generation. Stop here
    // even when it has no image; walking past it could accidentally reuse an
    // attachment from an older turn.
    if (message.role === 'user') {
      return creativeImageIdsFromMessageParts(message.parts);
    }

    messageId = message.parentMessageId;
  }

  return [];
}

function requestImageIds(body: Record<string, unknown>): string[] {
  return Array.isArray(body.images)
    ? body.images.filter((value): value is string => typeof value === 'string')
    : [];
}

/**
 * During an AI Creative generation, stabilize reference-image lookup against
 * the active branch rather than assuming conversations.current_message_leaf_id
 * is still a user row by the time the mesh tool executes. This is deliberately
 * provider-adapter infrastructure: direct /api/mesh calls outside an active AI
 * generation keep their existing request semantics.
 */
export async function anchorActiveCreativeMeshReferenceImages(
  request: Request,
  parsedBody: unknown,
): Promise<unknown> {
  if (!isRecord(parsedBody)) return parsedBody;

  const conversationId =
    typeof parsedBody.conversationId === 'string'
      ? parsedBody.conversationId
      : null;
  if (
    !conversationId ||
    !hasActiveGenerationForConversation(conversationId)
  ) {
    return parsedBody;
  }

  const authorization = request.headers.get('Authorization') ?? '';
  const supabase = getAnonSupabaseClient({
    global: { headers: { Authorization: authorization } },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return parsedBody;

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('current_message_leaf_id')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (conversationError || !conversation?.current_message_leaf_id) {
    return parsedBody;
  }

  const attachedImageIds = await findCreativeTurnImageIds({
    leafMessageId: conversation.current_message_leaf_id,
    loadMessage: async (messageId) => {
      const { data, error } = await supabase
        .from('messages')
        .select('role, parts, parent_message_id')
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .maybeSingle();
      if (error || !data) return null;
      return {
        role: data.role,
        parentMessageId: data.parent_message_id,
        parts: data.parts,
      };
    },
  });

  const images = resolveCreativeRequestedImageIds(
    requestImageIds(parsedBody),
    attachedImageIds,
  );

  return { ...parsedBody, images };
}
