import { OPENSCAD_MAX_SOURCE_BYTES } from "@/lib/openScadLimits";
import { decodeScadImportBytes, isSupportedScadFilename } from "@/lib/scadImport";

/**
 * Import one direct HTTPS OpenSCAD source. The remote host must allow CORS.
 * No third-party proxy, credentials, automatic dependency fetching or redirects.
 */
export async function fetchScadSourceFromUrl(
  input: string,
  fetcher: typeof fetch = fetch,
): Promise<{ filename: string; bytes: Uint8Array }> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid HTTPS URL to a .scad file.");
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Only HTTPS URLs without embedded credentials are supported.");
  }
  if (!url.hostname || url.port) {
    throw new Error("Use a direct HTTPS link without a custom port.");
  }

  let filename: string;
  try {
    filename = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  } catch {
    throw new Error("The URL contains an invalid filename.");
  }
  if (filename.includes("/") || filename.includes("\\") || !isSupportedScadFilename(filename)) {
    throw new Error("Choose a direct link ending in .scad or .scad.txt.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetcher(url.href, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("Could not download the .scad file (HTTP " + response.status + ").");
    }
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (type.includes("text/html")) {
      throw new Error("The URL returned an HTML page, not a raw .scad file.");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > OPENSCAD_MAX_SOURCE_BYTES) {
      throw new Error("OpenSCAD source exceeds " + OPENSCAD_MAX_SOURCE_BYTES + " UTF-8 bytes.");
    }
    if (!response.body) {
      throw new Error("Streaming download is unavailable in this browser.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > OPENSCAD_MAX_SOURCE_BYTES) {
            throw new Error("OpenSCAD source exceeds " + OPENSCAD_MAX_SOURCE_BYTES + " UTF-8 bytes.");
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // Reuse exactly the same encoding, binary and dependency checks as file upload.
    decodeScadImportBytes(filename, bytes);
    return { filename, bytes };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The .scad download timed out after 20 seconds.");
    }
    if (error instanceof TypeError) {
      throw new Error("Could not fetch this URL. The server may not permit cross-origin downloads (CORS).");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
