import { OPENSCAD_PROJECT_MAX_ASSET_BYTES } from "@shared/openScadProject";

/** Direct files only. No provider API, credentials, redirect following or proxy. */
export function isDirectMeshUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.port && !url.hash && input.length <= 2048 &&
      /\.(?:stl|3mf)$/i.test(url.pathname);
  } catch { return false; }
}

export async function fetchPublicMesh(
  url: string, filename: string, fetcher: typeof fetch = fetch,
): Promise<File> {
  const remote = new URL(url);
  if (remote.protocol !== "https:" || !remote.hostname ||
      remote.username || remote.password || remote.port || remote.hash || url.length > 2048 || !isDirectMeshUrl(url)) {
    throw new Error("Only safe HTTPS model downloads are supported.");
  }
  if (filename.length > 128 || !/^[^\\/]+\.(?:stl|3mf)$/i.test(filename) ||
      Array.from(filename).some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) {
    throw new Error("Choose a valid STL or 3MF model filename.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetcher(remote.href, { method: "GET", mode: "cors",
      credentials: "omit", redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error(`Model file could not be downloaded (HTTP ${response.status}).`);
    if ((response.headers.get("content-type") ?? "").includes("text/html")) {
      throw new Error("The URL returned an HTML page, not a model file. Use a direct public file URL or upload the downloaded file.");
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > OPENSCAD_PROJECT_MAX_ASSET_BYTES) throw new Error("Model exceeds the 16 MiB asset limit.");
    if (!response.body) throw new Error("Streaming download is unavailable.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let count = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          count += value.byteLength;
          if (count > OPENSCAD_PROJECT_MAX_ASSET_BYTES) {
            await reader.cancel();
            throw new Error("Model exceeds the 16 MiB asset limit.");
          }
          chunks.push(value);
        }
      }
    } finally { reader.releaseLock(); }
    if (count === 0) throw new Error("The model file is empty.");
    return new File(chunks.map(bytes => new Uint8Array(bytes)), filename, { type: "application/octet-stream" });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Model download timed out.");
    if (error instanceof TypeError) throw new Error("The file host blocked cross-origin download (CORS). Download the file and use Upload STL/3MF instead.");
    throw error;
  } finally { clearTimeout(timeout); }
}
