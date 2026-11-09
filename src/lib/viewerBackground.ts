/** Resolve the saved viewer brightness without confusing a missing key with zero. */
export function resolveViewerBackgroundLightness(
  storedValue: string | null,
  fallbackLightness: number,
): number {
  if (storedValue === null || storedValue.trim() === "") {
    return fallbackLightness;
  }
  const value = Number(storedValue);
  return Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : fallbackLightness;
}
