import { createFileRoute } from "@tanstack/react-router";
import {
  isRecord,
  json,
  preflight,
  readBoundedJson,
  StepExportRequestError,
} from "@/server/stepExportRequest";
import { type OpenScadProject } from "@shared/openScadProject";
import {
  StepExportError,
  exportOpenScadProjectToStep,
} from "@/server/stepExport";

function projectFromRequestBody(
  body: Record<string, unknown>,
): OpenScadProject | null {
  if (isRecord(body.project)) {
    return body.project as unknown as OpenScadProject;
  }

  // Compatibility for an already-open pre-Step-8 browser bundle. The server
  // still converts this through the project-directory sandbox path.
  if (typeof body.sourceCode === "string" && body.sourceCode.trim()) {
    return {
      schemaVersion: 1,
      entrypointPath: "model.scad",
      files: [{ path: "model.scad", content: body.sourceCode }],
    };
  }

  return null;
}

function errorResponse(error: unknown) {
  if (error instanceof StepExportRequestError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  if (error instanceof StepExportError) {
    if (error.code === "capacity_exceeded") {
      return Response.json(
        { error: error.message, code: error.code },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "2",
          },
        },
      );
    }
    const status = error.code === "provider_unavailable" ? 503 : 400;
    return json({ error: error.message, code: error.code }, status);
  }
  console.error("[STEP export] Unexpected failure:", error);
  return json({ error: "step_export_failed" }, 500);
}

export const Route = createFileRoute("/api/export/step")({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          const body = await readBoundedJson(request);
          if (!isRecord(body)) {
            return json({ error: "invalid_scad_project" }, 400);
          }

          const project = projectFromRequestBody(body);
          if (!project) {
            return json({ error: "invalid_scad_project" }, 400);
          }

          if (body.conversationId != null) {
            return json(
              {
                error:
                  "Anonymous STEP export does not support conversation-scoped assets.",
              },
              400,
            );
          }

          const result = await exportOpenScadProjectToStep(project);
          const responseBytes = new Uint8Array(result.bytes.byteLength);
          responseBytes.set(result.bytes);
          return new Response(responseBytes.buffer, {
            status: 200,
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "model/step",
              "Content-Disposition": 'attachment; filename="model.step"',
              "X-Content-Type-Options": "nosniff",
              "X-BREPIA-Step-Provider": result.provider,
              "X-BREPIA-Step-Warning-Count": String(result.warnings.length),
            },
          });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
