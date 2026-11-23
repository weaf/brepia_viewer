import { OPENSCAD_PROJECT_MAX_ASSET_BYTES } from "@shared/openScadProject";

export type SupportedPlatform = "printables" | "thingiverse" | "makerworld" | "snapmaker-space";
export type PlatformModel = { platform: SupportedPlatform; label: string; url: string; modelId: string };
export type RemoteModelFile = { id: string; name: string; bytes: number | null; format: "stl" | "3mf" };
export type PlatformFileList = { model: PlatformModel; title: string; files: RemoteModelFile[] };

const PLATFORM_LABELS: Record<SupportedPlatform, string> = {
  printables: "Printables", thingiverse: "Thingiverse",
  makerworld: "MakerWorld", "snapmaker-space": "Snapmaker Space",
};

/** Identify supported platforms without fetching HTML or scraping creator pages. */
export function identifyPlatformModelUrl(input: string): PlatformModel | null {
  let url: URL;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.hash || input.length > 2048) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let platform: SupportedPlatform;
  let modelId: string;
  if (host === "printables.com") {
    platform = "printables";
    modelId = url.pathname.match(/^\/model\/(\d+)(?:[-/]|$)/i)?.[1] ?? "";
  } else if (host === "thingiverse.com") {
    platform = "thingiverse";
    modelId = url.pathname.match(/^\/thing:(\d+)(?:\/|$)/i)?.[1] ?? "";
  } else if (host === "makerworld.com") {
    platform = "makerworld";
    modelId = url.pathname.match(/^\/(?:en\/)?models\/(\d+)(?:[-/]|$)/i)?.[1] ?? "";
  } else if (host === "space.snapmaker.com") {
    platform = "snapmaker-space";
    modelId = url.pathname.match(/^\/(?:en\/)?model\/(\d+)(?:\/|$)/i)?.[1] ?? "";
  } else return null;
  if (!modelId) return null;
  return { platform, label: PLATFORM_LABELS[platform], url: url.href, modelId };
}

export function isDirectMeshUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.port && !url.hash && input.length <= 2048 &&
      /\.(?:stl|3mf)$/i.test(url.pathname);
  } catch { return false; }
}

function parseModelFile(raw: unknown): RemoteModelFile | null {
  if (!raw || typeof raw !== "object") return null;
  const file = raw as Record<string, unknown>;
  if (!/^[a-z0-9_-]{1,100}$/i.test(String(file.id ?? "")) ||
      typeof file.name !== "string" || file.name.length > 160 ||
      file.name.includes("/") || file.name.includes("\\") ||
      Array.from(file.name).some(ch => ch.charCodeAt(0) < 32)) return null;
  const format = file.name.toLowerCase().endsWith(".stl") ? "stl" :
    file.name.toLowerCase().endsWith(".3mf") ? "3mf" : null;
  if (!format) return null;
  const size = typeof file.fileSize === "number" && Number.isSafeInteger(file.fileSize) ?
    file.fileSize : null;
  if (size != null && (size < 1 || size > OPENSCAD_PROJECT_MAX_ASSET_BYTES)) return null;
  return { id: String(file.id), name: file.name, bytes: size, format };
}

/** Printables' publicly reachable GraphQL surface is undocumented; fail closed if it changes. */
export async function listPrintablesModelFiles(
  model: PlatformModel, fetcher: typeof fetch = fetch,
): Promise<PlatformFileList> {
  if (model.platform !== "printables" || !/^\d{1,15}$/.test(model.modelId)) {
    throw new Error("Not a valid Printables model link.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher("https://api.printables.com/graphql/", {
      method: "POST", mode: "cors", credentials: "omit", redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query ViewerFiles($id: ID!) { print(id: $id) { name stls { id name fileSize } } }",
        variables: { id: model.modelId } }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Printables file listing returned HTTP ${response.status}.`);
    const json: unknown = await response.json();
    const data = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    if (Array.isArray(data.errors) && data.errors.length) throw new Error("Printables could not list files for this model.");
    const print = (data.data as { print?: { name?: unknown; stls?: unknown } } | undefined)?.print;
    if (!print || !Array.isArray(print.stls)) throw new Error("Printables did not return a public file list.");
    const files = print.stls.map(parseModelFile).filter((file): file is RemoteModelFile => file !== null).slice(0, 64);
    return { model, title: typeof print.name === "string" ? print.name.slice(0, 120) : "Printables model", files };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Printables request timed out.");
    if (error instanceof TypeError) throw new Error("Printables blocks this browser request (CORS or network). Open the original page and download the file there.");
    throw error;
  } finally { clearTimeout(timeout); }
}

/** Resolve one selected public file. Never use credentials or scrape protected pages. */
export async function getPrintablesDownloadUrl(
  model: PlatformModel, file: RemoteModelFile, fetcher: typeof fetch = fetch,
): Promise<string> {
  if (model.platform !== "printables" || !/^\d{1,15}$/.test(model.modelId) ||
      !/^[a-z0-9_-]{1,100}$/i.test(file.id) || !["stl", "3mf"].includes(file.format)) {
    throw new Error("Invalid Printables file selection.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher("https://api.printables.com/graphql/", {
      method: "POST", mode: "cors", credentials: "omit", redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "mutation ViewerDownload { getDownloadLink(id: " + JSON.stringify(file.id) +
          ", printId: " + JSON.stringify(model.modelId) +
          ', fileType: stl, source: model_detail) { ok output { link } } }',
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Printables download lookup returned HTTP ${response.status}.`);
    const json: unknown = await response.json();
    const data = (json as { data?: { getDownloadLink?: { ok?: boolean; output?: { link?: string } } } } | null)?.data?.getDownloadLink;
    const link = data?.ok ? data.output?.link : null;
    if (!link || typeof link !== "string") {
      throw new Error("No public download link. This file may require sign-in or a paid membership.");
    }
    const url = new URL(link);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["files.printables.com", "storage.googleapis.com"].includes(url.hostname.toLowerCase())) {
      throw new Error("Printables returned an untrusted download destination.");
    }
    return url.href;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Printables download lookup timed out.");
    if (error instanceof TypeError) throw new Error("This browser cannot access Printables' download API (CORS or network).");
    throw error;
  } finally { clearTimeout(timeout); }
}

/** Limit downloads before allocating model buffers, even when content-length is omitted. */
export async function fetchPublicMesh(
  url: string, filename: string, fetcher: typeof fetch = fetch,
): Promise<File> {
  const remote = new URL(url);
  if (remote.protocol !== "https:" || !remote.hostname ||
      remote.username || remote.password || remote.port) {
    throw new Error("Only safe HTTPS model downloads are supported.");
  }
  if (!/\.(?:stl|3mf)$/i.test(filename)) throw new Error("Choose an STL or 3MF model file.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetcher(remote.href, { method: "GET", mode: "cors",
      credentials: "omit", redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error(`Model file could not be downloaded (HTTP ${response.status}).`);
    if ((response.headers.get("content-type") ?? "").includes("text/html")) {
      throw new Error("The platform returned an HTML page rather than a model file.");
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
    if (error instanceof TypeError) throw new Error("The file host blocked cross-origin download (CORS). Download it from the model page instead.");
    throw error;
  } finally { clearTimeout(timeout); }
}
