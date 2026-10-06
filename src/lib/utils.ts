export * from './utilsCore';

import {
  CREATIVE_MESH_MODELS,
  getCreativeMeshInputCapability,
} from '@shared/creativeMeshModels';
import type { ModelConfig } from '../types/misc.ts';

const OPTIONAL_CREATIVE_PROVIDER_IDS = new Set(
  (import.meta.env.VITE_BREPIA_CREATIVE_MESH_PROVIDERS ?? '')
    .split(',')
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean),
);

function creativeProviderEnabled(provider: string): boolean {
  if (provider === 'local') return true;
  return (
    OPTIONAL_CREATIVE_PROVIDER_IDS.has('*') ||
    OPTIONAL_CREATIVE_PROVIDER_IDS.has('all') ||
    OPTIONAL_CREATIVE_PROVIDER_IDS.has(provider.toLowerCase())
  );
}

/**
 * Creative mesh picker entries. TRELLIS.2 is always available. Hosted 3D
 * services are explicit opt-ins via VITE_BREPIA_CREATIVE_MESH_PROVIDERS, e.g.
 * `fal`. Removing the provider ID removes its models from the picker again.
 */
export const CREATIVE_MODELS: ModelConfig[] = CREATIVE_MESH_MODELS.filter(
  (definition) => creativeProviderEnabled(definition.provider),
).map((definition) => ({
  id: definition.id,
  name: definition.name,
  description: definition.description,
  provider: definition.providerLabel,
  timeEstimate: definition.timeEstimate,
  inputCapability: getCreativeMeshInputCapability(definition.id),
}));
