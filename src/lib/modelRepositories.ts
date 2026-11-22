export type ModelRepositoryConfig = {
  /** Stable, unique ID used to separate this source's local model copies. */
  id: string;
  /** Label shown in model categories. */
  label: string;
  owner: string;
  repository: string;
  /** Branch or tag to read from GitHub. */
  branch: string;
  /** Optional folder inside the repository; empty string means repository root. */
  path: string;
};

import curatedRepositories from "./modelRepositories.json";

/** Every source is curated in modelRepositories.json and reviewed through pull requests. */
export const MODEL_REPOSITORIES: ModelRepositoryConfig[] = validateModelRepositories(curatedRepositories);

export function normalizeModelRepositoryPath(path: string): string {
  if (
    typeof path !== "string" ||
    (path !== "" && !/^[a-z0-9_./-]+$/i.test(path)) ||
    path.startsWith("/") || path.endsWith("/") || path.includes("//") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid GitHub model repository folder: ${path}`);
  }
  return path;
}

/** Validate the untrusted PR-editable registry before constructing any GitHub URLs. */
export function validateModelRepositories(raw: unknown): ModelRepositoryConfig[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
    throw new Error("Model repository catalog must contain 1 to 50 entries.");
  }
  const ids = new Set<string>();
  return raw.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Invalid model repository entry.");
    }
    const entry = item as Record<string, unknown>;
    const fields = ["id", "label", "owner", "repository", "branch", "path"];
    if (Object.keys(entry).some((key) => !fields.includes(key)) ||
      fields.some((key) => typeof entry[key] !== "string")) {
      throw new Error("Model repository entry has missing or unexpected fields.");
    }
    const source = entry as unknown as ModelRepositoryConfig;
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(source.id) ||
      ids.has(source.id) || ["all", "uploads"].includes(source.id)) {
      throw new Error(`Invalid or duplicate model repository ID: ${source.id}`);
    }
    ids.add(source.id);
    if (source.label !== source.label.trim() || source.label.length < 1 ||
      source.label.length > 70 || /[\x00-\x1f\x7f]/.test(source.label)) {
      throw new Error(`Invalid model repository label: ${source.id}`);
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(source.owner) ||
      !/^[a-z0-9_.-]+$/i.test(source.repository) ||
      source.repository === "." || source.repository === ".." ||
      source.repository.length > 100) {
      throw new Error(`Invalid GitHub owner/repository: ${source.id}`);
    }
    if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(source.branch) ||
      source.branch.length > 160 || source.branch.includes("..") ||
      source.branch.includes("//") || source.branch.endsWith("/") ||
      source.branch.endsWith(".lock")) {
      throw new Error(`Invalid GitHub branch or tag: ${source.id}`);
    }
    normalizeModelRepositoryPath(source.path);
    return { ...source };
  });
}

export function getModelRepository(id: string): ModelRepositoryConfig {
  const source = MODEL_REPOSITORIES.find((repository) => repository.id === id);
  if (!source) throw new Error(`Unknown model repository source: ${id}`);
  return { ...source };
}

export function getModelRepositories(): ModelRepositoryConfig[] {
  return MODEL_REPOSITORIES.map((source) => ({ ...source }));
}

export function modelRepositoryCacheKey(source: ModelRepositoryConfig): string {
  return [
    'built-in-model-catalog',
    source.id,
    source.owner,
    source.repository,
    source.branch,
    source.path,
  ].join(':');
}

export function modelRepositoryUrl(source: ModelRepositoryConfig): string {
  return `https://github.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}`;
}

export function modelRepositoryTreeUrl(
  source: ModelRepositoryConfig,
  projectPath = '',
): string {
  const branch = source.branch
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const suffix = [source.path, projectPath]
    .filter(Boolean)
    .join('/')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  return `${modelRepositoryUrl(source)}/tree/${branch}${suffix ? `/${suffix}` : ''}`;
}

export function modelRepositoryRawUrl(
  source: ModelRepositoryConfig,
  projectPath: string,
): string {
  const branch = source.branch
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const repositoryPath = [source.path, projectPath]
    .filter(Boolean)
    .join('/')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  return `https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/${branch}/${repositoryPath}`;
}

export function modelRepositoryApiTreeUrl(
  source: ModelRepositoryConfig,
): string {
  const branchRef = encodeURIComponent(source.branch);
  return `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/git/trees/${branchRef}?recursive=1`;
}
