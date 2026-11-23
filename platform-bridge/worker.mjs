// No generic proxy: two fixed Printables operations, no upstream URL from callers.
// This Worker is opt-in. It does not need creator credentials or relay model binaries.
const PRINTABLES_GRAPHQL = "https://api.printables.com/graphql/";
const MAX_JSON_BYTES = 128 * 1024;
const MAX_MESH_BYTES = 16_777_216;
const TRUSTED_DOWNLOAD_HOSTS = new Set(["files.printables.com", "storage.googleapis.com"]);
const FILE_QUERY =
  "query ViewerFiles($id: ID!) { print(id: $id) { name stls { id name fileSize } } }";

function responseJson(status, value, origin, allowOrigin = true) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
  });
  if (allowOrigin && origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Accept");
  }
  return new Response(JSON.stringify(value), { status, headers });
}

function parseFile(record) {
  if (!record || typeof record !== "object") return null;
  const { id, name, fileSize } = record;
  if (!/^[a-z0-9_-]{1,100}$/i.test(String(id ?? "")) ||
      typeof name !== "string" || name.length > 160 ||
      name.includes("/") || name.includes("\\") ||
      [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  const format = name.toLowerCase().endsWith(".stl") ? "stl" :
    name.toLowerCase().endsWith(".3mf") ? "3mf" : null;
  if (!format) return null;
  const bytes = typeof fileSize === "number" && Number.isSafeInteger(fileSize) ? fileSize : null;
  if (bytes != null && (bytes < 1 || bytes > MAX_MESH_BYTES)) return null;
  return { id: String(id), name, bytes, format };
}

async function boundedJson(response) {
  const sizeHeader = response.headers.get("content-length");
  if (sizeHeader && Number(sizeHeader) > MAX_JSON_BYTES) {
    throw new Error("Upstream metadata exceeds size limit");
  }
  if (!response.body) throw new Error("Upstream response has no body");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new Error("Upstream metadata exceeds size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
}

async function queryPrintables(query, variables, fetcher) {
  const response = await fetcher(PRINTABLES_GRAPHQL, {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 429) {
    const error = new Error("Printables rate limited this request");
    error.status = 429;
    throw error;
  }
  if (!response.ok) throw new Error("Printables API is unavailable");
  const data = await boundedJson(response);
  if (!data || typeof data !== "object" || (Array.isArray(data.errors) && data.errors.length)) {
    throw new Error("Printables API rejected the request");
  }
  return data.data;
}

async function listFiles(modelId, fetcher) {
  const data = await queryPrintables(FILE_QUERY, { id: modelId }, fetcher);
  if (!data?.print || !Array.isArray(data.print.stls)) {
    throw new Error("Printables returned no public file listing");
  }
  const files = data.print.stls.map(parseFile).filter(Boolean).slice(0, 64);
  return {
    title: typeof data.print.name === "string" ? data.print.name.slice(0, 120) : "Printables model",
    files,
  };
}

function checkedDownloadUrl(raw) {
  if (typeof raw !== "string") throw new Error("No public download link");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.hash || !TRUSTED_DOWNLOAD_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Untrusted download destination");
  }
  return url.href;
}

export async function handleBridgeRequest(
  request,
  { fetcher = fetch, rateLimiter = null, allowedOrigins = ["https://viewer.notydesign.se"] } = {},
) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins.includes(origin)) {
    return responseJson(403, { error: "Origin not allowed" }, null, false);
  }
  if (request.method === "OPTIONS") {
    const headers = new Headers({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept",
      "Access-Control-Max-Age": "600",
      "Cache-Control": "no-store",
      "Vary": "Origin",
    });
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET") {
    return responseJson(405, { error: "Method not allowed" }, origin);
  }
  const url = new URL(request.url);
  if (url.search || url.hash) return responseJson(400, { error: "Unexpected URL parameters" }, origin);
  const route = url.pathname.match(/^\/v1\/printables\/([0-9]{1,15})\/files(?:\/([a-z0-9_-]{1,100})\/download)?$/i);
  if (!route) return responseJson(404, { error: "Not found" }, origin);
  const [, modelId, fileId] = route;
  if (rateLimiter) {
    const { success } = await rateLimiter.limit({ key: "public-printables" });
    if (!success) return responseJson(429, { error: "Too many requests" }, origin);
  }
  try {
    const listing = await listFiles(modelId, fetcher);
    if (!fileId) return responseJson(200, listing, origin);
    const file = listing.files.find(item => item.id === fileId);
    if (!file) return responseJson(404, { error: "File is not publicly listed" }, origin);
    const query =
      'mutation ViewerDownload { getDownloadLink(id: "' + file.id +
      '", printId: "' + modelId +
      '", fileType: stl, source: model_detail) { ok output { link } } }';
    const data = await queryPrintables(query, {}, fetcher);
    const link = data?.getDownloadLink?.ok ? data.getDownloadLink.output?.link : null;
    if (!link) return responseJson(404, { error: "Public download is unavailable" }, origin);
    return responseJson(200, {
      url: checkedDownloadUrl(link),
      filename: file.name,
      format: file.format,
    }, origin);
  } catch (error) {
    return responseJson(error?.status === 429 ? 429 : 502, {
      error: error?.status === 429
        ? "Printables is rate limiting requests"
        : "Printables is currently unavailable for automatic import",
    }, origin);
  }
}

export default {
  async fetch(request, env) {
    // Use a fixed public Viewer origin unless a separate tested local origin is supplied.
    const origins = (env?.ALLOWED_ORIGINS || "https://viewer.notydesign.se")
      .split(",").map(origin => origin.trim()).filter(Boolean);
    return handleBridgeRequest(request, {
      allowedOrigins: origins,
      rateLimiter: env?.RATE_LIMITER,
    });
  },
};
