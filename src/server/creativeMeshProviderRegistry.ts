import {
  CORE_CREATIVE_MESH_MODELS,
  CREATIVE_MESH_PROVIDERS,
  OPTIONAL_CREATIVE_MESH_MODELS,
  getCreativeMeshModelDefinition,
  normalizeCreativeMeshModelId,
  type CreativeMeshModelDefinition,
  type CreativeMeshModelId,
  type CreativeMeshProvider,
} from '@shared/creativeMeshModels';
import { env } from './env';
import { anchorActiveCreativeMeshReferenceImages } from './creativeMeshReferenceImages';
import { handleNativeCreativeMeshRequest } from './nativeCreativeMesh';

type CreativeMeshHandler = (
  request: Request,
  parsedBody?: unknown,
) => Promise<Response>;

export type CreativeMeshProviderAdapter = {
  id: CreativeMeshProvider;
  label: string;
  optional: boolean;
  models: readonly CreativeMeshModelDefinition[];
  configured: () => boolean;
  handleRequest: CreativeMeshHandler;
  singleFlight: boolean;
  syncGeneratedMeshesAfterSuccess: boolean;
};

const optionalProviderIds = () => {
  const raw: string =
    env('BREPIA_CREATIVE_MESH_PROVIDERS') ||
    import.meta.env.VITE_BREPIA_CREATIVE_MESH_PROVIDERS ||
    env('VITE_BREPIA_CREATIVE_MESH_PROVIDERS');
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
};

function optionalProviderEnabled(id: CreativeMeshProvider): boolean {
  const configured = optionalProviderIds();
  return configured.has('*') || configured.has('all') || configured.has(id);
}

const PROVIDERS: readonly CreativeMeshProviderAdapter[] = [
  {
    id: 'local',
    label: 'Local',
    optional: false,
    models: CORE_CREATIVE_MESH_MODELS,
    configured: () => true,
    handleRequest: async (request, parsedBody) =>
      handleNativeCreativeMeshRequest(
        request,
        await anchorActiveCreativeMeshReferenceImages(request, parsedBody),
      ),
    singleFlight: true,
    syncGeneratedMeshesAfterSuccess: true,
  },
  {
    id: 'fal',
    label: 'fal.ai',
    optional: true,
    models: OPTIONAL_CREATIVE_MESH_MODELS.filter(
      (model) => model.provider === 'fal',
    ),
    configured: () => Boolean(env('FAL_KEY')),
    // Keep the optional hosted provider out of the native path until it is
    // actually selected. Future services follow the same adapter contract.
    handleRequest: async (request) => {
      const { handleMeshRequest } = await import('./falMesh');
      return handleMeshRequest(request);
    },
    singleFlight: false,
    syncGeneratedMeshesAfterSuccess: false,
  },
] as const;

export type CreativeMeshProviderStatus = {
  id: CreativeMeshProvider;
  label: string;
  optional: boolean;
  enabled: boolean;
  configured: boolean;
  modelIds: CreativeMeshModelId[];
};

export type CreativeMeshCatalog = {
  models: CreativeMeshModelDefinition[];
  providers: CreativeMeshProviderStatus[];
};

export function isCreativeMeshProviderEnabled(
  provider: CreativeMeshProviderAdapter,
): boolean {
  return (
    provider.configured() &&
    (!provider.optional || optionalProviderEnabled(provider.id))
  );
}

export function getCreativeMeshProviderAdapter(
  id: CreativeMeshProvider,
): CreativeMeshProviderAdapter | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

export function getCreativeMeshCatalog(): CreativeMeshCatalog {
  const providers = PROVIDERS.map((provider) => {
    const enabled = isCreativeMeshProviderEnabled(provider);
    return {
      id: provider.id,
      label: provider.label,
      optional: provider.optional,
      enabled,
      configured: provider.configured(),
      modelIds: provider.models.map((model) => model.id),
    } satisfies CreativeMeshProviderStatus;
  });

  const enabledProviderIds = new Set(
    providers
      .filter((provider) => provider.enabled)
      .map((provider) => provider.id),
  );

  return {
    models: PROVIDERS.flatMap((provider) =>
      enabledProviderIds.has(provider.id) ? [...provider.models] : [],
    ),
    providers,
  };
}

export function resolveCreativeMeshProvider(model: unknown): {
  modelId: CreativeMeshModelId;
  definition: CreativeMeshModelDefinition;
  provider: CreativeMeshProviderAdapter;
  enabled: boolean;
} | null {
  const modelId = normalizeCreativeMeshModelId(model);
  if (!modelId) return null;

  const definition = getCreativeMeshModelDefinition(modelId);
  if (!definition) return null;

  const provider = PROVIDERS.find((candidate) =>
    candidate.models.some((candidateModel) => candidateModel.id === modelId),
  );
  if (!provider) return null;

  return {
    modelId,
    definition,
    provider,
    enabled: isCreativeMeshProviderEnabled(provider),
  };
}

/**
 * Provider metadata is compile-time registered, while enablement is runtime
 * configuration. Adding another hosted 3D service therefore requires only a
 * provider adapter + model definitions; the main mesh route stays unchanged.
 */
export function listCreativeMeshProviderAdapters(): readonly CreativeMeshProviderAdapter[] {
  return PROVIDERS;
}

// Assert that every shared provider definition has a server adapter. This is a
// cheap startup-independent guard against adding a provider to the UI catalog
// without giving the server a route for it.
for (const provider of CREATIVE_MESH_PROVIDERS) {
  if (!PROVIDERS.some((adapter) => adapter.id === provider.id)) {
    throw new Error(`Missing Creative mesh provider adapter: ${provider.id}`);
  }
}
