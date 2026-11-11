/** Formatting for read-only preview profiling; no data is persisted. */
export function formatPreviewBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "Unavailable";
  if (bytes < 1024) return Math.round(bytes) + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KiB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MiB";
}

export function formatPreviewDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return "Unavailable";
  }
  if (durationMs < 1000) return Math.round(durationMs) + " ms";
  return (durationMs / 1000).toFixed(2) + " s";
}
