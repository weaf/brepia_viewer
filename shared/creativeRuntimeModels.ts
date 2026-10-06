const INTERNAL_CREATIVE_RUNTIME_MODEL_PREFIX = 'creative/';

/**
 * Internal Creative generation runtimes are identified by namespace rather
 * than concrete model IDs. The actual runtime model IDs are user-configurable
 * under AI Settings > Model routing.
 */
export function isInternalCreativeRuntimeModelId(modelId: string): boolean {
  const normalized = modelId.startsWith('local/')
    ? modelId.slice('local/'.length)
    : modelId;
  return normalized.startsWith(INTERNAL_CREATIVE_RUNTIME_MODEL_PREFIX);
}
