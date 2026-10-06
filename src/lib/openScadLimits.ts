export const OPENSCAD_MAX_SOURCE_BYTES = 256_000;
export const OPENSCAD_COMPILE_TIMEOUT_MS = 20_000;
export const OPENSCAD_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

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
): void {
  const bytes = openScadOutputByteLength(output);
  if (bytes > OPENSCAD_MAX_OUTPUT_BYTES) {
    throw new Error(
      `OpenSCAD output exceeds ${OPENSCAD_MAX_OUTPUT_BYTES} bytes.`,
    );
  }
}
