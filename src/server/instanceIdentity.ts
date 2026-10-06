import type { Database } from '@shared/database';
import { getServiceRoleSupabaseClient } from '@/server/supabaseClient';

export type InstanceIdentity = {
  operatorName: string | null;
  contactEmail: string | null;
  communityUrl: string | null;
  communityLabel: string;
  showCommunityLink: boolean;
  discordUrl: string | null;
  legalPagesEnabled: boolean;
  termsUrl: string | null;
  privacyUrl: string | null;
};

export type InstanceIdentityInput = InstanceIdentity;

type InstanceSettingsRow =
  Database['public']['Tables']['instance_settings']['Row'];

export const DEFAULT_INSTANCE_IDENTITY: InstanceIdentity = {
  operatorName: null,
  contactEmail: null,
  communityUrl: null,
  communityLabel: 'Community',
  showCommunityLink: false,
  discordUrl: null,
  legalPagesEnabled: false,
  termsUrl: null,
  privacyUrl: null,
};

export class InstanceIdentityError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
    this.name = 'InstanceIdentityError';
  }
}

function nullableText(value: string | null, maxLength: number, code: string) {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw new InstanceIdentityError(code);
  return trimmed;
}

function nullableEmail(value: string | null) {
  const email = nullableText(value, 254, 'invalid_contact_email');
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InstanceIdentityError('invalid_contact_email');
  }
  return email;
}

function nullableUrl(value: string | null, code: string) {
  const text = nullableText(value, 2048, code);
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new InstanceIdentityError(code);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new InstanceIdentityError(code);
  }
  return url.toString();
}

export function normalizeInstanceIdentity(
  input: InstanceIdentityInput,
): InstanceIdentity {
  const operatorName = nullableText(
    input.operatorName,
    200,
    'invalid_operator_name',
  );
  const contactEmail = nullableEmail(input.contactEmail);
  const communityUrl = nullableUrl(input.communityUrl, 'invalid_community_url');
  const communityLabel =
    nullableText(input.communityLabel, 40, 'invalid_community_label') ??
    'Community';
  const discordUrl = nullableUrl(input.discordUrl, 'invalid_discord_url');
  const termsUrl = nullableUrl(input.termsUrl, 'invalid_terms_url');
  const privacyUrl = nullableUrl(input.privacyUrl, 'invalid_privacy_url');

  return {
    operatorName,
    contactEmail,
    communityUrl,
    communityLabel,
    showCommunityLink: Boolean(input.showCommunityLink && communityUrl),
    discordUrl,
    legalPagesEnabled: Boolean(input.legalPagesEnabled),
    termsUrl,
    privacyUrl,
  };
}

function fromRow(row: InstanceSettingsRow): InstanceIdentity {
  return {
    operatorName: row.operator_name,
    contactEmail: row.contact_email,
    communityUrl: row.community_url,
    communityLabel: row.community_label || 'Community',
    showCommunityLink: Boolean(row.show_community_link && row.community_url),
    discordUrl: row.discord_url,
    legalPagesEnabled: row.legal_pages_enabled,
    termsUrl: row.terms_url,
    privacyUrl: row.privacy_url,
  };
}

export async function getInstanceIdentity(): Promise<InstanceIdentity> {
  const supabase = getServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from('instance_settings')
    .select(
      'id,operator_name,contact_email,community_url,community_label,show_community_link,discord_url,legal_pages_enabled,terms_url,privacy_url,created_at,updated_at',
    )
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    throw new InstanceIdentityError('failed_to_load_instance_identity', 500);
  }
  return data ? fromRow(data) : DEFAULT_INSTANCE_IDENTITY;
}

export async function updateInstanceIdentity(
  input: InstanceIdentityInput,
): Promise<InstanceIdentity> {
  const normalized = normalizeInstanceIdentity(input);
  const supabase = getServiceRoleSupabaseClient();
  const { error } = await supabase.from('instance_settings').upsert(
    {
      id: 1,
      operator_name: normalized.operatorName,
      contact_email: normalized.contactEmail,
      community_url: normalized.communityUrl,
      community_label: normalized.communityLabel,
      show_community_link: normalized.showCommunityLink,
      discord_url: normalized.discordUrl,
      legal_pages_enabled: normalized.legalPagesEnabled,
      terms_url: normalized.termsUrl,
      privacy_url: normalized.privacyUrl,
    },
    { onConflict: 'id' },
  );

  if (error) {
    throw new InstanceIdentityError('failed_to_update_instance_identity', 500);
  }
  return getInstanceIdentity();
}
