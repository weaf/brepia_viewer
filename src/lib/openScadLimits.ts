export const OPENSCAD_MAX_SOURCE_BYTES = 256_000;
export const OPENSCAD_COMPILE_TIMEOUT_MS = 20_000;
export const OPENSCAD_EXPORT_TIMEOUT_MS = 60_000;
export const OPENSCAD_OUTPUT_LIMIT_CHOICES = [64, 128, 256, 512] as const;
export type OpenScadOutputLimitMiB = typeof OPENSCAD_OUTPUT_LIMIT_CHOICES[number];
export const OPENSCAD_DEFAULT_OUTPUT_LIMIT_MIB: OpenScadOutputLimitMiB = 128;
export const OPENSCAD_MAX_OUTPUT_BYTES = OPENSCAD_DEFAULT_OUTPUT_LIMIT_MIB * 1024 * 1024;

/** Keep the worker and UI on the same bounded allowlist, even for malformed messages. */
export function isOpenScadOutputLimitMiB(value: unknown): value is OpenScadOutputLimitMiB {
  return OPENSCAD_OUTPUT_LIMIT_CHOICES.some(choice => choice === value);
}

export function resolveOpenScadOutputLimitBytes(value: unknown = OPENSCAD_DEFAULT_OUTPUT_LIMIT_MIB): number {
  if (!isOpenScadOutputLimitMiB(value)) {
    throw new Error('Invalid OpenSCAD output limit.');
  }
  return value * 1024 * 1024;
}

export function isOpenScadOutputLimitError(error: unknown): boolean {
  return error instanceof Error && /^OpenSCAD output exceeds \d+ bytes\./.test(error.message);
}

type ByteSized = {
  byteLength: number;
};

type OpenScadOutputLike = {
  output?: ByteSized | null;
  extraOutputs?: Record<string, ByteSized> | null;
};

export function openScadUtf8ByteLength(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

export function assertOpenScadSourceWithinLimit(source: string): void {
  const bytes = openScadUtf8ByteLength(source);
  if (bytes > OPENSCAD_MAX_SOURCE_BYTES) {
    throw new Error(
      `OpenSCAD source exceeds ${OPENSCAD_MAX_SOURCE_BYTES} UTF-8 bytes.`,
    );
  }
}

export function openScadOutputByteLength(output: OpenScadOutputLike): number {
  let bytes = output.output?.byteLength ?? 0;
  for (const extra of Object.values(output.extraOutputs ?? {})) {
    bytes += extra.byteLength;
  }
  return bytes;
}

export function assertOpenScadOutputWithinLimit(
  output: OpenScadOutputLike,
  limitMiB: unknown = OPENSCAD_DEFAULT_OUTPUT_LIMIT_MIB,
): void {
  const limitBytes = resolveOpenScadOutputLimitBytes(limitMiB);
  const bytes = openScadOutputByteLength(output);
  if (bytes > limitBytes) {
    throw new Error(
      `OpenSCAD output exceeds ${limitBytes} bytes.`,
    );
  }
}
