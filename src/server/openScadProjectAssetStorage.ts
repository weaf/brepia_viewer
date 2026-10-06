import { createHash } from 'node:crypto';
import {
  normalizeOpenScadProjectPath,
  type OpenScadProjectAsset,
} from '@shared/openScadProject';
import { getServiceRoleSupabaseClient } from './supabaseClient';

const OPENSCAD_ASSET_BUCKET = 'meshes';

export type ServerOpenScadProjectAssetResolver = (
  asset: OpenScadProjectAsset,
) => Promise<Uint8Array>;

export function assertServerOpenScadProjectAssetStorageScope(input: {
  asset: OpenScadProjectAsset;
  userId: string;
  conversationId: string;
}): void {
  const userId = normalizeOpenScadProjectPath(input.userId);
  const conversationId = normalizeOpenScadProjectPath(input.conversationId);
  const expectedPrefix = `${userId}/${conversationId}/`;
  if (!input.asset.storagePath.startsWith(expectedPrefix)) {
    throw new Error(
      `OpenSCAD project asset storage is outside the active conversation: ${input.asset.path}`,
    );
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createServerOpenScadProjectAssetResolver(
  conversationId: string,
  expectedUserId?: string,
): ServerOpenScadProjectAssetResolver {
  const normalizedConversationId = normalizeOpenScadProjectPath(conversationId);
  const normalizedExpectedUserId = expectedUserId
    ? normalizeOpenScadProjectPath(expectedUserId)
    : undefined;
  const supabase = getServiceRoleSupabaseClient();
  let ownerPromise: Promise<string> | undefined;

  const resolveOwner = () => {
    if (!ownerPromise) {
      ownerPromise = (async () => {
        const { data, error } = await supabase
          .from('conversations')
          .select('user_id')
          .eq('id', normalizedConversationId)
          .single();
        if (error || !data?.user_id) {
          throw new Error('Could not resolve OpenSCAD asset conversation owner.');
        }
        if (
          normalizedExpectedUserId &&
          data.user_id !== normalizedExpectedUserId
        ) {
          throw new Error(
            'OpenSCAD project asset conversation is not owned by the active user.',
          );
        }
        return data.user_id;
      })();
    }
    return ownerPromise;
  };

  return async (asset) => {
    const userId = await resolveOwner();
    assertServerOpenScadProjectAssetStorageScope({
      asset,
      userId,
      conversationId: normalizedConversationId,
    });

    const { data, error } = await supabase.storage
      .from(OPENSCAD_ASSET_BUCKET)
      .download(asset.storagePath);
    if (error || !data) {
      throw new Error(
        `Could not load OpenSCAD project asset ${asset.path}: ${error?.message ?? 'missing object'}`,
      );
    }

    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.byteLength !== asset.byteLength) {
      throw new Error(`OpenSCAD project asset size mismatch for ${asset.path}.`);
    }
    if (sha256(bytes) !== asset.sha256) {
      throw new Error(
        `OpenSCAD project asset checksum mismatch for ${asset.path}.`,
      );
    }
    return bytes;
  };
}
