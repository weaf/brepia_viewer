import {
  OPENSCAD_PROJECT_MAX_ASSETS,
  OPENSCAD_PROJECT_MAX_ASSET_BYTES,
  OPENSCAD_PROJECT_MAX_FILES,
  OPENSCAD_PROJECT_MAX_FILE_BYTES,
  OPENSCAD_PROJECT_MAX_TOTAL_ASSET_BYTES,
  OPENSCAD_PROJECT_MAX_TOTAL_BYTES,
  normalizeOpenScadProject,
  normalizeOpenScadProjectPath,
} from "@shared/openScadProject";
import {
  decodeScadFolderImportEntries,
  finalizeScadFolderImport,
  isSupportedScadAssetFilename,
  isSupportedScadFilename,
  type ScadFolderSourceInput,
} from "@/lib/scadImport";

const MAX_REPOSITORY_ENTRIES = 5000;
const MAX_REPOSITORY_SCAD_FILES = 200;
const FETCH_TIMEOUT_MS = 20000;
const API_BASE = "https://api.github.com/repos";
const GH_HOSTS = new Set(["github.com", "www.github.com"]);

type GithubBlob = {
  path: string;
  size: number;
  sha: string;
};

export type GithubScadInspection = {
  owner: string;
  repository: string;
  branch: string;
  commitSha: string;
  files: GithubBlob[];
  scopes: string[];
  suggestedScope: string;
  suggestedEntrypoint: string;
  skippedFiles: number;
};

export type GithubScadSelection = {
  sources: GithubBlob[];
  assets: GithubBlob[];
  skipped: number;
  entrypoints: string[];
};

export type GithubScadImportResult = {
  title: string;
  project: ReturnType<typeof normalizeOpenScadProject>;
  assets: { path: string; bytes: Uint8Array }[];
  importedFiles: number;
  skippedFiles: number;
};

function safeUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid HTTPS URL.");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error("Only HTTPS URLs without credentials or custom ports are supported.");
  }
  return url;
}

export function isGithubRepositoryUrl(input: string): boolean {
  try {
    return GH_HOSTS.has(safeUrl(input).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function parseGithubUrl(input: string): {
  owner: string;
  repository: string;
  kind: "repo" | "blob" | "tree";
  rest: string[];
} {
  const url = safeUrl(input);
  if (!GH_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Enter a public github.com repository, folder or .scad file URL.");
  }
  if (url.search || url.hash) {
    throw new Error("Remove query parameters and fragments from the GitHub URL.");
  }
  let parts: string[];
  try {
    // Decoding *each* component preserves URLs such as knob_factory%2Fknob-factory.scad.
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new Error("The GitHub URL contains invalid percent encoding.");
  }
  const [owner, repository, mode, ...tail] = parts;
  if (
    !owner || !repository ||
    !/^[a-z\d](?:[a-z\d._-]*[a-z\d])?$/i.test(owner) ||
    !/^[a-z\d._-]+$/i.test(repository)
  ) {
    throw new Error("The GitHub URL must include a repository owner and name.");
  }
  if (mode && mode !== "tree" && mode !== "blob") {
    throw new Error("Use a GitHub repository, /tree/ folder or /blob/ OpenSCAD file URL.");
  }
  if (mode && !tail.length) {
    throw new Error("The GitHub link is missing its branch name.");
  }
  if (parts.some((part) => part === "." || part === ".." || part.includes("\\") || Array.from(part).some((character) => character.charCodeAt(0) < 32))) {
    throw new Error("The GitHub URL contains an unsafe path.");
  }
  return { owner, repository, kind: mode === "tree" || mode === "blob" ? mode : "repo", rest: tail };
}

function apiUrl(owner: string, repository: string, suffix: string): string {
  return `${API_BASE}/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${suffix}`;
}

function githubFetchError(response: Response, subject: string): Error {
  if (response.status === 404) {
    return new Error(`${subject} was not found or is not public (HTTP 404).`);
  }
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
  ) {
    return new Error("GitHub's unauthenticated API limit was reached. Try again after the rate limit resets.");
  }
  if (response.status === 403) {
    return new Error(`GitHub denied access to ${subject} (HTTP 403).`);
  }
  return new Error(`Could not fetch ${subject} (HTTP ${response.status}).`);
}

async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await task(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after 20 seconds.`);
    }
    if (error instanceof TypeError) {
      throw new Error(`Network or CORS error while fetching ${label}.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function apiJson<T>(
  url: string,
  subject: string,
  fetcher: typeof fetch,
): Promise<T> {
  return withTimeout(async (signal) => {
    const response = await fetcher(url, {
      credentials: "omit",
      mode: "cors",
      redirect: "error",
      headers: { Accept: "application/vnd.github+json" },
      signal,
    });
    if (!response.ok) throw githubFetchError(response, subject);
    return (await response.json()) as T;
  }, subject);
}

type GithubBranch = { name: string; commit: { sha: string } };

async function getBranches(
  owner: string,
  repository: string,
  fetcher: typeof fetch,
): Promise<GithubBranch[]> {
  const branches: GithubBranch[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await apiJson<GithubBranch[]>(
      apiUrl(owner, repository, `/branches?per_page=100&page=${page}`),
      "GitHub branches",
      fetcher,
    );
    if (!Array.isArray(batch)) throw new Error("GitHub returned an invalid branch listing.");
    branches.push(...batch);
    if (batch.length < 100) break;
    if (page === 3) throw new Error("This repository has too many branches to resolve safely (300+).");
  }
  return branches;
}

function relativePath(path: string, scope: string): string {
  return scope ? path.slice(scope.length + 1) : path;
}

function withinScope(path: string, scope: string): boolean {
  return !scope || path.startsWith(`${scope}/`);
}

export function getGithubScadSelection(
  inspection: GithubScadInspection,
  scope: string,
): GithubScadSelection {
  if (!inspection.scopes.includes(scope)) {
    throw new Error("Choose an available GitHub project folder.");
  }
  const selected = inspection.files.filter((file) => withinScope(file.path, scope));
  const sources = selected.filter((file) => isSupportedScadFilename(file.path));
  const assets = selected.filter((file) => isSupportedScadAssetFilename(file.path));
  const entrypoints = sources.map((file) => {
    const path = relativePath(file.path, scope).replace(/\.scad\.txt$/i, ".scad");
    return normalizeOpenScadProjectPath(path);
  });
  return {
    sources,
    assets,
    skipped: inspection.skippedFiles + selected.length - sources.length - assets.length,
    entrypoints,
  };
}

function assertSafeSelection(selection: GithubScadSelection, scope: string): void {
  if (!selection.sources.length) throw new Error("No OpenSCAD files were found in this folder.");
  if (selection.sources.length > OPENSCAD_PROJECT_MAX_FILES) {
    throw new Error(`Folder contains ${selection.sources.length} OpenSCAD files; the limit is ${OPENSCAD_PROJECT_MAX_FILES}. Choose a smaller folder.`);
  }
  if (selection.assets.length > OPENSCAD_PROJECT_MAX_ASSETS) {
    throw new Error(`Folder contains ${selection.assets.length} supported assets; the limit is ${OPENSCAD_PROJECT_MAX_ASSETS}. Choose a smaller folder.`);
  }
  let totalSource = 0;
  let totalAssets = 0;
  for (const file of [...selection.sources, ...selection.assets]) {
    normalizeOpenScadProjectPath(relativePath(file.path, scope));
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error(`GitHub returned an invalid file size for ${file.path}.`);
    }
    if (selection.sources.includes(file)) {
      if (file.size > OPENSCAD_PROJECT_MAX_FILE_BYTES) {
        throw new Error(`OpenSCAD source ${file.path} exceeds ${OPENSCAD_PROJECT_MAX_FILE_BYTES} bytes.`);
      }
      totalSource += file.size;
    } else {
      if (file.size < 1 || file.size > OPENSCAD_PROJECT_MAX_ASSET_BYTES) {
        throw new Error(`Asset ${file.path} is empty or too large.`);
      }
      totalAssets += file.size;
    }
  }
  if (totalSource > OPENSCAD_PROJECT_MAX_TOTAL_BYTES) {
    throw new Error("The selected OpenSCAD project exceeds the total source size limit.");
  }
  if (totalAssets > OPENSCAD_PROJECT_MAX_TOTAL_ASSET_BYTES) {
    throw new Error("The selected OpenSCAD project exceeds the total asset size limit.");
  }
}

export async function inspectGithubScadUrl(
  input: string,
  fetcher: typeof fetch = fetch,
): Promise<GithubScadInspection> {
  const parsed = parseGithubUrl(input);
  const branches = await getBranches(parsed.owner, parsed.repository, fetcher);
  let branch: GithubBranch | undefined;
  let selectedPath = "";
  if (parsed.kind === "repo") {
    const info = await apiJson<{ default_branch: string }>(
      apiUrl(parsed.owner, parsed.repository, ""),
      "GitHub repository",
      fetcher,
    );
    branch = branches.find((item) => item.name === info.default_branch);
  } else {
    const fullPath = parsed.rest.join("/");
    // A branch can contain '/', and a path can contain URL-encoded '/'.
    branch = branches
      .filter((item) => fullPath === item.name || fullPath.startsWith(`${item.name}/`))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (branch) selectedPath = fullPath.slice(branch.name.length).replace(/^\//, "");
  }
  if (!branch || !/^[a-f0-9]{40}$/i.test(branch.commit.sha)) {
    throw new Error("Could not resolve this GitHub branch. Check that the repository and branch are public.");
  }
  if (parsed.kind === "blob" && !selectedPath) {
    throw new Error("The GitHub file URL does not include a source path.");
  }
  if (selectedPath) selectedPath = normalizeOpenScadProjectPath(selectedPath);

  const tree = await apiJson<{
    truncated?: boolean;
    tree: Array<{ path: string; mode: string; type: string; sha: string; size?: number }>;
  }>(
    apiUrl(parsed.owner, parsed.repository, `/git/trees/${branch.commit.sha}?recursive=1`),
    "GitHub repository tree",
    fetcher,
  );
  if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > MAX_REPOSITORY_ENTRIES) {
    throw new Error("This GitHub repository is too large for safe browser import. Download a smaller folder and use Upload folder.");
  }
  const files = tree.tree.filter((item) =>
    item.type === "blob" &&
    (item.mode === "100644" || item.mode === "100755") &&
    typeof item.path === "string" &&
    Number.isSafeInteger(item.size) &&
    /^[a-f0-9]{40}$/i.test(item.sha)
  ).map((item) => ({ path: item.path, size: item.size as number, sha: item.sha }));
  const sourcePaths = files.filter((file) => isSupportedScadFilename(file.path));
  if (sourcePaths.length > MAX_REPOSITORY_SCAD_FILES) {
    throw new Error("This repository has more than 200 OpenSCAD files. Download a smaller folder and use Upload folder.");
  }
  if (!sourcePaths.length) throw new Error("This repository contains no supported .scad files.");
  if (parsed.kind === "blob" && (!isSupportedScadFilename(selectedPath) || !sourcePaths.some((file) => file.path === selectedPath))) {
    throw new Error("The selected OpenSCAD file does not exist on this GitHub branch.");
  }
  if (parsed.kind === "tree" && selectedPath && !sourcePaths.some((file) => withinScope(file.path, selectedPath))) {
    throw new Error("The GitHub folder does not exist or contains no OpenSCAD files.");
  }
  const scopeSet = new Set([""]);
  for (const file of sourcePaths) {
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      scopeSet.add(parts.slice(0, i).join("/"));
    }
  }
  const suggestedScope = parsed.kind === "blob"
    ? selectedPath.split("/").slice(0, -1).join("/")
    : selectedPath;
  const scopes = Array.from(scopeSet).sort((a, b) => a.localeCompare(b, "en-US"));
  if (!scopes.includes(suggestedScope)) {
    throw new Error("The selected GitHub path is not an OpenSCAD project folder.");
  }
  return {
    owner: parsed.owner,
    repository: parsed.repository,
    branch: branch.name,
    commitSha: branch.commit.sha,
    files,
    scopes,
    suggestedScope,
    suggestedEntrypoint: parsed.kind === "blob"
      ? relativePath(selectedPath, suggestedScope).replace(/\.scad\.txt$/i, ".scad")
      : "",
    skippedFiles: tree.tree.length - files.length,
  };
}

async function rawBytes(
  url: string,
  file: GithubBlob,
  limit: number,
  fetcher: typeof fetch,
): Promise<Uint8Array> {
  return withTimeout(async (signal) => {
    const response = await fetcher(url, {
      credentials: "omit",
      mode: "cors",
      redirect: "error",
      signal,
    });
    if (!response.ok) throw githubFetchError(response, file.path);
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > limit) throw new Error(`Downloaded file is too large: ${file.path}.`);
    if ((response.headers.get("content-type") ?? "").includes("text/html")) {
      throw new Error(`GitHub returned HTML instead of ${file.path}.`);
    }
    if (!response.body) throw new Error("Streaming downloads are unavailable in this browser.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > limit || total > file.size) {
            throw new Error(`Downloaded file exceeds its safe size limit: ${file.path}.`);
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (total !== file.size) {
      throw new Error(`Downloaded file size differs from GitHub's listing: ${file.path}.`);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }, file.path);
}

export async function downloadGithubScadProject(
  inspection: GithubScadInspection,
  scope: string,
  chosenEntrypoint: string,
  onProgress: (completed: number, total: number) => void = () => {},
  fetcher: typeof fetch = fetch,
): Promise<GithubScadImportResult> {
  const selection = getGithubScadSelection(inspection, scope);
  assertSafeSelection(selection, scope);
  if (!selection.entrypoints.includes(chosenEntrypoint)) {
    throw new Error("Choose a valid OpenSCAD entrypoint before downloading.");
  }
  const selectedFiles = [...selection.sources, ...selection.assets];
  const entries: ScadFolderSourceInput[] = [];
  const rootName = "github-project";
  onProgress(0, selectedFiles.length);
  // Sequential downloads keep memory and mobile network use bounded.
  for (const file of selectedFiles) {
    const path = relativePath(file.path, scope);
    const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(inspection.owner)}/${encodeURIComponent(inspection.repository)}/${inspection.commitSha}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
    const bytes = await rawBytes(
      rawUrl,
      file,
      selection.sources.includes(file) ? OPENSCAD_PROJECT_MAX_FILE_BYTES : OPENSCAD_PROJECT_MAX_ASSET_BYTES,
      fetcher,
    );
    entries.push({ name: path.split("/").at(-1) ?? path, relativePath: `${rootName}/${path}`, bytes });
    onProgress(entries.length, selectedFiles.length);
  }
  // The same validator, dependency resolution and asset retention as Upload folder.
  const decoded = decodeScadFolderImportEntries(entries);
  const project = decoded.kind === "entrypoint-required"
    ? finalizeScadFolderImport(decoded.pending, chosenEntrypoint)
    : normalizeOpenScadProject({ ...decoded.project, entrypointPath: chosenEntrypoint });
  const title = scope.split("/").at(-1) || inspection.repository;
  return {
    title,
    project,
    assets: decoded.kind === "entrypoint-required" ? decoded.pending.assets : decoded.assets,
    importedFiles: selectedFiles.length,
    skippedFiles: selection.skipped,
  };
}
