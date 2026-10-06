function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error ?? '');
}

export const MODEL_USAGE_LIMIT_MESSAGE =
  'Model usage limit reached. The selected model or provider has reached its current rate or usage limit. Choose another model or try again later.';

export const VISION_CONFIGURATION_MESSAGE =
  'Vision models are not configured. Open Settings → Vision and select a Fast vision model before using images with a text-only model or OpenCode/Codex.';

export const PROVIDER_AUTH_MESSAGE =
  'The selected model provider is not authenticated. Open Settings → Providers and configure the required credential.';

export const CONNECTION_INTERRUPTED_MESSAGE =
  'Connection interrupted. Brepia keeps server-side generation running and will refresh this conversation when the saved result becomes available.';

/**
 * Convert raw provider/transport failures into concise product-level messages.
 * Keep unknown errors unchanged so diagnostics are not hidden accidentally.
 */
export function userFacingChatError(error: unknown): Error {
  const message = errorText(error);

  if (
    /FreeUsageLimitError|rate limit exceeded|too many requests|\bHTTP\s*429\b|\bstatus\s*429\b/i.test(
      message,
    )
  ) {
    return new Error(MODEL_USAGE_LIMIT_MESSAGE);
  }

  if (/Vision models are not configured/i.test(message)) {
    return new Error(VISION_CONFIGURATION_MESSAGE);
  }

  if (
    /Missing Authentication header|missing api key|invalid api key|unauthorized|\bHTTP\s*401\b/i.test(
      message,
    )
  ) {
    return new Error(PROVIDER_AUTH_MESSAGE);
  }

  if (
    /\bnetwork error\b|failed to fetch|network request failed|load failed|fetch failed|connection (?:was )?(?:lost|closed|reset)/i.test(
      message,
    )
  ) {
    return new Error(CONNECTION_INTERRUPTED_MESSAGE);
  }

  if (error instanceof Error) return error;
  return new Error(message || 'The model call failed. Please try again.');
}
