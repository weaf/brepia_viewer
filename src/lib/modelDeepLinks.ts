import { identifyPlatformModelUrl, isDirectMeshUrl } from "./platformModelImport";

/** Query strings are deliberately explicit: links do not execute code or mutate local models. */
export type ViewerModelLink =
  | { kind: "url"; url: string }
  | { kind: "library"; repositoryId: string; path: string };

export function parseViewerModelLink(query: string): ViewerModelLink | null {
  const params = new URLSearchParams(query);
  const urls = params.getAll("model");
  const libraries = params.getAll("library");
  const files = params.getAll("file");
  if (!urls.length && !libraries.length && !files.length) return null;
  if (urls.length > 1 || libraries.length > 1 || files.length > 1 ||
      (urls.length && (libraries.length || files.length))) {
    throw new Error("Use one model URL or one library model per link.");
  }
  if (urls.length) {
    const input = urls[0];
    if (input.length > 2048) throw new Error("Model link is too long.");
    let url: URL;
    try { url = new URL(input); } catch { throw new Error("The linked model URL is invalid."); }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.port) {
      throw new Error("Model links must use HTTPS without credentials or custom ports.");
    }
    if (url.hash) throw new Error("Remove fragments from the model URL.");
    // Preserve remote query strings: direct raw SCAD hosts sometimes require them.
    if (!/\.scad(?:\.txt)?$/i.test(url.pathname) && !isDirectMeshUrl(url.href) &&
      !identifyPlatformModelUrl(url.href) &&
      !["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
      throw new Error("Link to a public SCAD/STL/3MF file, GitHub project or supported model platform.");
    }
    return { kind: "url", url: url.href };
  }
  if (!libraries.length || !files.length || !libraries[0] || !files[0] ||
    !/^[a-z0-9][a-z0-9-]*$/.test(libraries[0]) || files[0].length > 1024 ||
    files[0].startsWith("/") || files[0].split("/").some((part) =>
      !part || part === "." || part === ".." || part.includes("\\") ||
      Array.from(part).some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127))) {
    throw new Error("The linked library model is invalid.");
  }
  return { kind: "library", repositoryId: libraries[0], path: files[0] };
}

export function createViewerModelLink(link: ViewerModelLink, base = "https://viewer.notydesign.se/"): string {
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  if (link.kind === "url") url.searchParams.set("model", link.url);
  else {
    url.searchParams.set("library", link.repositoryId);
    url.searchParams.set("file", link.path);
  }
  return url.href;
}
