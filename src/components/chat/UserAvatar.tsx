import { useAuth } from '@/contexts/AuthContext';
import { useProfile, useAvatarUrl } from '@/services/profileService';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AvatarPresetIcon } from '@/components/avatar/AvatarPresetIcon';
import { getInitials } from '@/lib/utils';
import { ssoClaims, ssoManaged } from '@/lib/supabase';

export function UserAvatar({
  className,
  ignorePreset = false,
}: {
  className?: string;
  ignorePreset?: boolean;
}) {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { data: avatarUrl } = useAvatarUrl(profile?.avatar_path);

  // A Brepia preset is an explicit app-level choice and therefore wins over
  // provider/uploaded images until the user switches back to their profile photo.
  const avatarPreset = ignorePreset ? null : (profile?.avatar_preset ?? null);

  // The provider photo. Under SSO read it from the fresh identity claims (the
  // same source as the name) — NOT user_metadata, which GoTrue leaves stale. In
  // self-host, fall back to whatever the OAuth provider put in user_metadata.
  const claims = ssoClaims(user);
  const metadata = user?.user_metadata as
    { avatar_url?: string; picture?: string } | undefined;
  const providerAvatar = claims
    ? claims.picture || claims.avatar_url
    : metadata?.avatar_url || metadata?.picture;

  // When the account is externally SSO-managed, the provider photo is the
  // normal image source. In self-host mode the self-uploaded avatar wins.
  const src = avatarPreset
    ? undefined
    : ssoManaged
      ? providerAvatar || avatarUrl || undefined
      : avatarUrl || providerAvatar || undefined;

  return (
    <Avatar className={className}>
      {avatarPreset ? (
        <div className="flex h-full w-full items-center justify-center rounded-full bg-adam-neutral-800 text-adam-blue">
          <AvatarPresetIcon
            preset={avatarPreset}
            className="h-[55%] w-[55%] stroke-[1.8]"
          />
        </div>
      ) : (
        <>
          <AvatarImage src={src} />
          <AvatarFallback>
            {getInitials(profile?.full_name || null)}
          </AvatarFallback>
        </>
      )}
    </Avatar>
  );
}
