/**
 * Custom model ID helpers — stable, namespaced identifiers for custom
 * provider models that cannot collide with upstream (built-in or opencode)
 * model IDs.
 *
 * Format: `custom/<provider-uuid>/<model-id>`
 *
 * Parser rule:
 *   - First segment must be exactly `custom`.
 *   - Second segment is the provider UUID (stable, immutable).
 *   - Remaining segments joined with `/` form the provider-native model ID,
 *     which itself may contain `/`.
 *
 * Display name or mutable provider slugs are NOT used as identifiers.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CUSTOM_PREFIX = 'custom';

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Returns true if the given model ID follows the `custom/...` naming
 * convention and therefore refers to a custom provider model.
 */
export function isCustomProviderModel(id: string): boolean {
  const parts = id.split('/');
  return parts.length >= 3 && parts[0] === CUSTOM_PREFIX;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Creates a stable custom model ID from a provider UUID and a
 * provider-native model ID.
 *
 * The provider-native model ID may itself contain `/` characters;
 * it is joined verbatim.
 *
 * @example makeCustomProviderModelId('abc-123-def', 'gpt-4')
 *   => 'custom/abc-123-def/gpt-4'
 * @example makeCustomProviderModelId('abc-123-def', 'openai/gpt-4')
 *   => 'custom/abc-123-def/openai/gpt-4'
 */
export function makeCustomProviderModelId(
  providerId: string,
  modelId: string,
): string {
  return `${CUSTOM_PREFIX}/${providerId}/${modelId}`;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parses a custom model ID into its constituent parts.
 *
 * @example parseCustomProviderModelId('custom/abc-123-def/gpt-4')
 *   => { providerId: 'abc-123-def', modelId: 'gpt-4' }
 * @example parseCustomProviderModelId('custom/abc-123-def/openai/gpt-4')
 *   => { providerId: 'abc-123-def', modelId: 'openai/gpt-4' }
 *
 * @returns The parsed parts, or `null` if the ID does not match the
 *          custom/ format.
 */
export function parseCustomProviderModelId(
  id: string,
): { providerId: string; modelId: string } | null {
  if (!isCustomProviderModel(id)) return null;

  const parts = id.split('/');
  // Skip the 'custom' prefix (index 0), take index 1 as providerId,
  // and join the rest as modelId.
  if (parts.length < 3) return null;

  const providerId = parts[1];
  const modelId = parts.slice(2).join('/');

  // Provider UUID must be non-empty.
  if (!providerId) return null;
  // Model ID must be non-empty.
  if (!modelId) return null;

  return { providerId, modelId };
}
