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

/**
 * Public GitHub sources for the built-in OpenSCAD model gallery.
 * Add another entry to include a repository folder; path is relative to that repo.
 * Example: { id: 'community', label: 'Community', owner: 'org', repository: 'models', branch: 'main', path: 'openscad' }
 */
export const MODEL_REPOSITORIES: ModelRepositoryConfig[] = [
  {
    id: 'parametric-designs',
    label: 'Parametric designs',
    owner: 'Noty-design',
    repository: 'Parametric-designs',
    branch: 'main',
    path: '',
  },
];

export function normalizeModelRepositoryPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (
    normalized.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid GitHub model repository folder: ${path}`);
  }
  return normalized;
}

export function getModelRepository(id: string): ModelRepositoryConfig {
  const source = MODEL_REPOSITORIES.find((repository) => repository.id === id);
  if (!source) throw new Error(`Unknown model repository source: ${id}`);
  return { ...source, path: normalizeModelRepositoryPath(source.path) };
}

export function getModelRepositories(): ModelRepositoryConfig[] {
  const ids = new Set<string>();
  return MODEL_REPOSITORIES.map((source) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(source.id) || ids.has(source.id)) {
      throw new Error(`Invalid or duplicate model repository ID: ${source.id}`);
    }
    ids.add(source.id);
    if (!source.owner.trim() || !source.repository.trim() || !source.branch.trim()) {
      throw new Error(`Incomplete GitHub model repository source: ${source.id}`);
    }
    return { ...source, path: normalizeModelRepositoryPath(source.path) };
  });
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
