import { OPENSCAD_PROJECT_MAX_TOTAL_BYTES } from "@shared/openScadProject";

const STEP_EXPORT_REQUEST_LIMIT_BYTES =
  OPENSCAD_PROJECT_MAX_TOTAL_BYTES * 6 + 1024 * 1024;

export class StepExportRequestError extends Error {
  constructor(
    public readonly code: "request_too_large" | "invalid_json",
    public readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
    this.name = "StepExportRequestError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function preflight() {
  return new Response("ok", {
    headers: {
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store",
    },
  });
}

export async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (
      Number.isFinite(declaredBytes) &&
      declaredBytes > STEP_EXPORT_REQUEST_LIMIT_BYTES
    ) {
      throw new StepExportRequestError(
        "request_too_large",
        413,
        "STEP export request body is too large.",
      );
    }
  }

  if (!request.body) {
    throw new StepExportRequestError(
      "invalid_json",
      400,
      "STEP export request body must be JSON.",
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > STEP_EXPORT_REQUEST_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new StepExportRequestError(
          "request_too_large",
          413,
          "STEP export request body is too large.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StepExportRequestError(
      "invalid_json",
      400,
      "STEP export request body must be valid UTF-8 JSON.",
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StepExportRequestError(
      "invalid_json",
      400,
      "STEP export request body must be valid JSON.",
    );
  }
}
