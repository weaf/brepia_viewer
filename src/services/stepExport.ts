import {
  normalizeOpenScadProject,
  type OpenScadProject,
} from "@shared/openScadProject";

export type StepExportResponse = {
  file: Blob;
  provider: string | null;
  warningCount: number;
};

export async function exportStep(
  projectOrSource: OpenScadProject | string,
): Promise<StepExportResponse> {
  const requestBody =
    typeof projectOrSource === "string"
      ? { sourceCode: projectOrSource }
      : { project: normalizeOpenScadProject(projectOrSource) };

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const response = await fetch(`${basePath}/api/export/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `STEP export failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const warningCount = Number(
    response.headers.get("X-BREPIA-Step-Warning-Count") ?? "0",
  );
  return {
    file: await response.blob(),
    provider: response.headers.get("X-BREPIA-Step-Provider"),
    warningCount: Number.isFinite(warningCount) ? warningCount : 0,
  };
}
