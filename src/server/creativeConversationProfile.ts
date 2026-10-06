import {
  getDefaultLocalCreativeProfile,
  type CreativeRuntimeModelRouting,
  type LocalCreativeProfile,
} from '@shared/modelRouting';

export type CreativeConversationProfileSource =
  'legacy-current-default' | 'pinned' | 'pinned-none';

export type CreativeConversationProfileResolution = {
  profile: LocalCreativeProfile | null;
  profileId: string | null;
  source: CreativeConversationProfileSource;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolve the Local Creative runtime profile for one conversation.
 *
 * Legacy conversations predate `localCreativeProfileId`, so they intentionally
 * keep Phase-1 behavior and follow the user's current explicit default profile.
 * New conversations always carry the key: a string pins one exact profile and
 * null records that no Local Creative profile was selected at creation time.
 *
 * `enabled` only controls whether a profile can be selected for new/default
 * usage. An already-pinned conversation may continue using a disabled profile
 * as long as the profile still exists and has a mesh runtime configured.
 */
export function resolveCreativeConversationProfile(
  routing: CreativeRuntimeModelRouting,
  conversationSettings: unknown,
): CreativeConversationProfileResolution {
  if (
    !isRecord(conversationSettings) ||
    !Object.prototype.hasOwnProperty.call(
      conversationSettings,
      'localCreativeProfileId',
    )
  ) {
    const profile = getDefaultLocalCreativeProfile(routing);
    return {
      profile,
      profileId: profile?.id ?? null,
      source: 'legacy-current-default',
    };
  }

  const rawProfileId = conversationSettings.localCreativeProfileId;
  if (rawProfileId === null) {
    return { profile: null, profileId: null, source: 'pinned-none' };
  }
  if (typeof rawProfileId !== 'string' || !rawProfileId.trim()) {
    throw new Error('Conversation has an invalid Local Creative profile pin.');
  }

  const profileId = rawProfileId.trim();
  const profile = routing.localCreativeProfiles.find(
    (candidate) => candidate.id === profileId,
  );
  if (!profile) {
    throw new Error(
      `Pinned Local Creative profile ${profileId} no longer exists. Restore that profile or start a new Creative conversation with an available profile.`,
    );
  }
  if (!profile.meshModelId?.trim()) {
    throw new Error(
      `Pinned Local Creative profile ${profile.name} no longer has a mesh runtime configured. Restore the profile configuration before continuing this conversation.`,
    );
  }

  return { profile, profileId, source: 'pinned' };
}
