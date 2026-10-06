import { z } from 'zod';
import { apiJson } from '@/services/api';

export const InstanceIdentitySchema = z.object({
  operatorName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  communityUrl: z.string().nullable(),
  communityLabel: z.string(),
  showCommunityLink: z.boolean(),
  discordUrl: z.string().nullable(),
  legalPagesEnabled: z.boolean(),
  termsUrl: z.string().nullable(),
  privacyUrl: z.string().nullable(),
});

export type InstanceIdentity = z.infer<typeof InstanceIdentitySchema>;

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

export function getInstanceIdentity() {
  return apiJson(
    'settings/instanceIdentity',
    { method: 'GET' },
    InstanceIdentitySchema,
  );
}

export function saveInstanceIdentity(settings: InstanceIdentity) {
  return apiJson(
    'settings/instanceIdentity',
    { method: 'PUT', body: JSON.stringify(settings) },
    InstanceIdentitySchema,
  );
}
