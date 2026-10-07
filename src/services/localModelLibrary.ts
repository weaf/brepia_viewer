import {
  OPENSCAD_PROJECT_MAX_ASSETS,
  OPENSCAD_PROJECT_MAX_ASSET_BYTES,
  OPENSCAD_PROJECT_MAX_FILES,
  OPENSCAD_PROJECT_MAX_TOTAL_ASSET_BYTES,
  OPENSCAD_PROJECT_MAX_TOTAL_BYTES,
  isOpenScadProjectAssetPathSupportedForKind,
  normalizeOpenScadProject,
  openScadProjectAssetMediaTypeForPath,
  type OpenScadProject,
  type OpenScadProjectAsset,
} from '@shared/openScadProject';
import {
  collectOpenScadProjectAssetReferences,
  collectOpenScadProjectSourceReferences,
  resolveOpenScadProjectReference,
  validateOpenScadProjectAssetReferences,
  validateOpenScadProjectSourceReferences,
} from '@shared/openScadProjectReferences';
import { OPENSCAD_MAX_SOURCE_BYTES } from '@/lib/openScadLimits';
import { createUuid } from '@/lib/uuid';
import type { ScadFolderAssetInput } from '@/lib/scadImport';
import {
  getModelRepositories,
  getModelRepository,
  modelRepositoryApiTreeUrl,
  modelRepositoryCacheKey,
  modelRepositoryRawUrl,
  modelRepositoryTreeUrl,
  type ModelRepositoryConfig,
} from '@/lib/modelRepositories';

export const BUILT_IN_MODELS_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_REPOSITORY_ID = 'parametric-designs';
const DEFAULT_CATALOG_KEY = 'built-in-model-catalog';
const DATABASE_NAME = 'brepia-local-models';
const DATABASE_VERSION = 1;
const MODEL_STORE = 'models';
const CACHE_STORE = 'cache';
const LAST_OPENED_MODEL_KEY = 'last-opened-local-model';
const BUNDLED_LIBRARY_ROOTS = new Set(['BOSL', 'BOSL2', 'MCAD']);

export type BuiltInModel = {
  repositoryId: string;
  path: string;
  name: string;
  category: string;
  size: number;
  sha: string;
  url: string;
};

export type LocalModelRecord = {
  id: string;
  name: string;
  origin: 'upload' | 'built-in';
  project: OpenScadProject;
  assetBlobs: Record<string, Blob>;
  updatedAt: string;
  sourcePath?: string;
  sourceRepositoryId?: string;
  sourceSha?: string;
  baseProject?: OpenScadProject;
};

type CatalogCache = {
  key: string;
  updatedAt: number;
  models: BuiltInModel[];
};

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(
      new Error('This browser does not support local model storage.'),
    );
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MODEL_STORE)) {
        database.createObjectStore(MODEL_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(CACHE_STORE)) {
        database.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open local model storage.'));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let result: T;
    let settled = false;
    const fail = (error: DOMException | Error | null) => {
      if (settled) return;
      settled = true;
      database.close();
      reject(error ?? new Error('Local model storage transaction failed.'));
    };

    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(storeName, mode);
      const request = run(transaction.objectStore(storeName));
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => {
        fail(request.error ?? new Error('Local model storage failed.'));
      };
    } catch (error) {
      database.close();
      reject(error);
      return;
    }

    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      database.close();
      resolve(result);
    };
    transaction.onabort = () => fail(transaction.error);
    transaction.onerror = () => fail(transaction.error);
  });
}

export async function getLocalModels(): Promise<LocalModelRecord[]> {
  const records = await withStore(MODEL_STORE, 'readonly', (store) =>
    store.getAll(),
  );
  return (records as LocalModelRecord[])
    .filter((record) => record.origin === 'upload')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getStoredModel(
  id: string,
): Promise<LocalModelRecord | undefined> {
  return (await withStore(MODEL_STORE, 'readonly', (store) =>
    store.get(id),
  )) as LocalModelRecord | undefined;
}

export async function getLastOpenedLocalModel(): Promise<LocalModelRecord | undefined> {
  const saved = (await withStore(CACHE_STORE, 'readonly', (store) =>
    store.get(LAST_OPENED_MODEL_KEY),
  )) as { key: string; modelId?: unknown } | undefined;
  if (typeof saved?.modelId === 'string') {
    const record = await getStoredModel(saved.modelId);
    if (record) return record;
  }

  const records = (await withStore(MODEL_STORE, 'readonly', (store) =>
    store.getAll(),
  )) as LocalModelRecord[];
  return records.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )[0];
}

export async function setLastOpenedLocalModel(id: string): Promise<void> {
  await withStore(CACHE_STORE, 'readwrite', (store) =>
    store.put({ key: LAST_OPENED_MODEL_KEY, modelId: id }),
  );
}

export async function clearLocalModelData(): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction([MODEL_STORE, CACHE_STORE], 'readwrite');
      transaction.objectStore(MODEL_STORE).clear();
      transaction.objectStore(CACHE_STORE).clear();
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Could not clear local model data.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Could not clear local model data.'));
    };
  });
}

export async function saveLocalModel(record: LocalModelRecord): Promise<void> {
  await withStore(MODEL_STORE, 'readwrite', (store) => store.put(record));
}

export async function removeUploadedModel(id: string): Promise<void> {
  const record = await getStoredModel(id);
  if (!record || record.origin !== 'upload') {
    throw new Error('Only uploaded models can be removed from this gallery.');
  }
  await withStore(MODEL_STORE, 'readwrite', (store) => store.delete(id));
}

export async function getBuiltInCatalog(
  forceRefresh = false,
): Promise<{ models: BuiltInModel[]; updatedAt: number; fromCache: boolean }> {
  const repositories = getModelRepositories();
  if (repositories.length === 0) {
    throw new Error('No GitHub model repositories are configured.');
  }

  const results = await Promise.allSettled(
    repositories.map((source) => getRepositoryCatalog(source, forceRefresh)),
  );
  const successful = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  if (successful.length === 0) {
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    throw new Error('Could not load any configured GitHub model repository.');
  }

  return {
    models: successful.flatMap((result) => result.models),
    updatedAt: Math.max(...successful.map((result) => result.updatedAt)),
    fromCache: successful.every((result) => result.fromCache),
  };
}

async function getRepositoryCatalog(
  source: ModelRepositoryConfig,
  forceRefresh: boolean,
): Promise<{ models: BuiltInModel[]; updatedAt: number; fromCache: boolean }> {
  const cacheKey =
    source.id === DEFAULT_REPOSITORY_ID
      ? DEFAULT_CATALOG_KEY
      : modelRepositoryCacheKey(source);
  const cached = (await withStore(CACHE_STORE, 'readonly', (store) =>
    store.get(cacheKey),
  )) as CatalogCache | undefined;

  if (
    !forceRefresh &&
    cached &&
    Date.now() - cached.updatedAt < BUILT_IN_MODELS_REFRESH_INTERVAL_MS
  ) {
    return {
      models: cached.models.map((model) => ({
        ...model,
        repositoryId: model.repositoryId ?? source.id,
      })),
      updatedAt: cached.updatedAt,
      fromCache: true,
    };
  }

  try {
    const response = await fetch(modelRepositoryApiTreeUrl(source), {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      throw new Error(
        response.status === 403 || response.status === 429
          ? `GitHub rate limit reached while loading ${source.label}.`
          : `GitHub could not load ${source.label} (HTTP ${response.status}).`,
      );
    }
    const payload = (await response.json()) as {
      truncated?: boolean;
      tree?: Array<{
        path?: unknown;
        type?: unknown;
        size?: unknown;
        sha?: unknown;
      }>;
    };
    if (payload.truncated || !Array.isArray(payload.tree)) {
      throw new Error(`GitHub returned an incomplete model list for ${source.label}.`);
    }

    const prefix = source.path ? `${source.path}/` : '';
    const models = payload.tree
      .flatMap((entry) => {
        if (
          entry.type !== 'blob' ||
          typeof entry.path !== 'string' ||
          !/\.scad$/i.test(entry.path)
        ) {
          return [];
        }
        const repositoryPath = entry.path.replace(/\\/g, '/');
        if (prefix && !repositoryPath.startsWith(prefix)) return [];
        const path = prefix ? repositoryPath.slice(prefix.length) : repositoryPath;
        if (!path || path.split('/').some((segment) => segment === '..')) return [];
        const parts = path.split('/');
        const filename = parts.at(-1) ?? path;
        const title = filename
          .replace(/\.scad$/i, '')
          .replace(/[_-]+/g, ' ')
          .trim();
        const folder = parts.length > 1 ? parts.slice(0, -1).join(' / ') : '';
        return [
          {
            repositoryId: source.id,
            path,
            name: title || filename,
            category: [source.label, folder].filter(Boolean).join(' / '),
            size: typeof entry.size === 'number' ? entry.size : 0,
            sha: typeof entry.sha === 'string' ? entry.sha : '',
            url: modelRepositoryTreeUrl(source, path),
          },
        ];
      })
      .sort(
        (left, right) =>
          left.category.localeCompare(right.category) ||
          left.name.localeCompare(right.name),
      );

    const updatedAt = Date.now();
    await withStore(CACHE_STORE, 'readwrite', (store) =>
      store.put({ key: cacheKey, updatedAt, models } satisfies CatalogCache),
    );
    return { models, updatedAt, fromCache: false };
  } catch (error) {
    if (cached && !forceRefresh) {
      return {
        models: cached.models.map((model) => ({
          ...model,
          repositoryId: model.repositoryId ?? source.id,
        })),
        updatedAt: cached.updatedAt,
        fromCache: true,
      };
    }
    throw error;
  }
}

async function fetchRepoBytes(
  repositoryId: string,
  path: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const source = getModelRepository(repositoryId);
  const response = await fetch(modelRepositoryRawUrl(source, path));
  if (!response.ok) {
    throw new Error(
      `Could not load ${path} from ${source.label} (HTTP ${response.status}).`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `${path} is larger than the supported ${maxBytes.toLocaleString()} byte limit.`,
    );
  }
  return bytes;
}

function decodeSource(path: string, bytes: Uint8Array): string {
  if (bytes.byteLength > OPENSCAD_MAX_SOURCE_BYTES) {
    throw new Error(`${path} is larger than the supported OpenSCAD source limit.`);
  }
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${path} is not valid UTF-8 OpenSCAD source.`);
  }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  if (source.includes('\0')) {
    throw new Error(`${path} contains binary data, not OpenSCAD source.`);
  }
  return source;
}

function repoProjectPath(sourcePath: string, target: string): string {
  const root = target.replace(/\\/g, '/').split('/', 1)[0];
  if (BUNDLED_LIBRARY_ROOTS.has(root)) {
    throw new Error('Bundled OpenSCAD libraries are resolved by the viewer.');
  }
  return resolveOpenScadProjectReference(sourcePath, target);
}

export async function loadBuiltInProject(entry: BuiltInModel): Promise<{
  project: OpenScadProject;
  assetBlobs: Record<string, Blob>;
}> {
  const files = new Map<string, string>();
  const pending = [entry.path];
  let totalSourceBytes = 0;

  while (pending.length > 0) {
    if (files.size >= OPENSCAD_PROJECT_MAX_FILES) {
      throw new Error(
        `This model uses more than ${OPENSCAD_PROJECT_MAX_FILES} OpenSCAD source files.`,
      );
    }
    const path = pending.shift()!;
    if (files.has(path)) continue;
    const bytes = await fetchRepoBytes(
      entry.repositoryId,
      path,
      OPENSCAD_MAX_SOURCE_BYTES,
    );
    totalSourceBytes += bytes.byteLength;
    if (totalSourceBytes > OPENSCAD_PROJECT_MAX_TOTAL_BYTES) {
      throw new Error('This model exceeds the total OpenSCAD project size limit.');
    }
    const content = decodeSource(path, bytes);
    files.set(path, content);

    const project = normalizeOpenScadProject({
      schemaVersion: 1,
      entrypointPath: entry.path,
      files: [...files].map(([filePath, fileContent]) => ({
        path: filePath,
        content: fileContent,
      })),
    });
    const references = collectOpenScadProjectSourceReferences(project).filter(
      (reference) =>
        reference.sourcePath === path && !reference.bundledLibrary,
    );
    for (const reference of references) {
      const dependencyPath = repoProjectPath(path, reference.target);
      if (/\.(?:bakscad|txt)$/i.test(dependencyPath)) {
        throw new Error(`Unsupported OpenSCAD dependency in ${path}.`);
      }
      if (!files.has(dependencyPath) && !pending.includes(dependencyPath)) {
        pending.push(dependencyPath);
      }
    }
  }

  let project = normalizeOpenScadProject({
    schemaVersion: 1,
    entrypointPath: entry.path,
    files: [...files].map(([path, content]) => ({ path, content })),
  });
  validateOpenScadProjectSourceReferences(project);

  const references = collectOpenScadProjectAssetReferences(project);
  const uniqueAssets = new Set<string>();
  for (const reference of references) {
    if (reference.dynamic || !reference.target || !reference.resolvedPath) {
      throw new Error(
        `${reference.kind}(...) in ${reference.sourcePath} needs a literal file path to load in the browser.`,
      );
    }
    if (
      !isOpenScadProjectAssetPathSupportedForKind(
        reference.resolvedPath,
        reference.kind,
      )
    ) {
      throw new Error(
        `${reference.kind}("${reference.target}") in ${reference.sourcePath} uses an unsupported asset type.`,
      );
    }
    uniqueAssets.add(reference.resolvedPath);
  }
  if (uniqueAssets.size > OPENSCAD_PROJECT_MAX_ASSETS) {
    throw new Error(
      `This model uses more than ${OPENSCAD_PROJECT_MAX_ASSETS} external assets.`,
    );
  }

  const assetBlobs: Record<string, Blob> = {};
  const descriptors: OpenScadProjectAsset[] = [];
  let totalAssetBytes = 0;
  for (const path of uniqueAssets) {
    const bytes = await fetchRepoBytes(
      entry.repositoryId,
      path,
      OPENSCAD_PROJECT_MAX_ASSET_BYTES,
    );
    if (bytes.byteLength === 0) {
      throw new Error(`The built-in asset ${path} is empty.`);
    }
    totalAssetBytes += bytes.byteLength;
    if (totalAssetBytes > OPENSCAD_PROJECT_MAX_TOTAL_ASSET_BYTES) {
      throw new Error('This model exceeds the total external asset size limit.');
    }
    const blob = new Blob([bytes]);
    assetBlobs[path] = blob;
    descriptors.push(
      await createLocalAssetDescriptor({
        path,
        storagePath: `local-models/built-in/${entry.repositoryId}/${entry.path}/${path}`,
        blob,
      }),
    );
  }

  if (descriptors.length > 0) {
    project = normalizeOpenScadProject({ ...project, assets: descriptors });
    validateOpenScadProjectAssetReferences(project);
  }
  return { project, assetBlobs };
}

export async function createUploadedModel(input: {
  name: string;
  project: OpenScadProject;
  assets?: readonly ScadFolderAssetInput[];
}): Promise<LocalModelRecord> {
  const id = `upload:${createUuid()}`;
  const assetBlobs: Record<string, Blob> = {};
  const descriptors: OpenScadProjectAsset[] = [];
  let totalAssetBytes = 0;

  for (const asset of input.assets ?? []) {
    const blob = new Blob([asset.bytes]);
    totalAssetBytes += blob.size;
    if (totalAssetBytes > OPENSCAD_PROJECT_MAX_TOTAL_ASSET_BYTES) {
      throw new Error('The uploaded project exceeds the total asset size limit.');
    }
    assetBlobs[asset.path] = blob;
    descriptors.push(
      await createLocalAssetDescriptor({
        path: asset.path,
        storagePath: `local-models/${id}/${asset.path}`,
        blob,
      }),
    );
  }

  let project = normalizeOpenScadProject(input.project);
  if (descriptors.length > 0) {
    project = normalizeOpenScadProject({ ...project, assets: descriptors });
  }
  validateOpenScadProjectSourceReferences(project);
  if (project.assets?.length) validateOpenScadProjectAssetReferences(project);

  const record: LocalModelRecord = {
    id,
    name: input.name.trim() || 'Uploaded model',
    origin: 'upload',
    project,
    assetBlobs,
    updatedAt: new Date().toISOString(),
  };
  await saveLocalModel(record);
  return record;
}

async function createLocalAssetDescriptor(input: {
  path: string;
  storagePath: string;
  blob: Blob;
}): Promise<OpenScadProjectAsset> {
  const mediaType = openScadProjectAssetMediaTypeForPath(input.path);
  if (
    !mediaType ||
    input.blob.size <= 0 ||
    input.blob.size > OPENSCAD_PROJECT_MAX_ASSET_BYTES
  ) {
    throw new Error(`Unsupported or oversized OpenSCAD asset: ${input.path}`);
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await input.blob.arrayBuffer(),
  );
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return {
    path: input.path,
    storagePath: input.storagePath,
    mediaType,
    byteLength: input.blob.size,
    sha256,
  };
}

export function builtInModelRecordId(
  path: string,
  repositoryId = DEFAULT_REPOSITORY_ID,
): string {
  const encodedPath = encodeURIComponent(path);
  return repositoryId === DEFAULT_REPOSITORY_ID
    ? `built-in:${encodedPath}`
    : `built-in:${encodeURIComponent(repositoryId)}:${encodedPath}`;
}

export async function saveBuiltInWorkingCopy(input: {
  entry: BuiltInModel;
  project: OpenScadProject;
  assetBlobs: Record<string, Blob>;
  baseProject: OpenScadProject;
}): Promise<LocalModelRecord> {
  const id = builtInModelRecordId(
    input.entry.path,
    input.entry.repositoryId,
  );
  const record: LocalModelRecord = {
    id,
    name: input.entry.name,
    origin: 'built-in',
    sourcePath: input.entry.path,
    sourceRepositoryId: input.entry.repositoryId,
    project: input.project,
    assetBlobs: input.assetBlobs,
    baseProject: input.baseProject,
    sourceSha: input.entry.sha,
    updatedAt: new Date().toISOString(),
  };
  await saveLocalModel(record);
  return record;
}
