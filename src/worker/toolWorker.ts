// Module-singleton OpenSCAD worker for client-side tool execution.
//
// This worker intentionally survives ChatSession unmount/navigation, but each
// request is bounded. A timeout/crash terminates the singleton and rejects all
// in-flight callers; the next request lazily creates a fresh worker.

import { assertOpenScadOutputWithinLimit } from '@/lib/openScadLimits';
import {
  hydrateOpenScadProjectAssets,
  type OpenScadProjectAssetScope,
} from '@/lib/openScadProjectAssetStorage';
import { OpenScadWorkerClient } from '@/worker/openScadWorkerClient';
import type { OpenScadProject } from '@shared/openScadProject';
import { normalizeOpenScadProject } from '@shared/openScadProject';
import type { OpenSCADWorkerResponseData, WorkerMessage } from '@/worker/types';
import { WorkerMessageType } from '@/worker/types';

let client: OpenScadWorkerClient | null = null;

function getToolWorkerClient(): OpenScadWorkerClient {
  if (client) return client;

  client = new OpenScadWorkerClient(
    () =>
      new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      }),
  );
  return client;
}

async function writeProjectAssetToToolWorker(
  path: string,
  blob: Blob,
): Promise<void> {
  const requestId = `tool-asset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const content = await blob.arrayBuffer();
  const message: WorkerMessage & { id: string } = {
    id: requestId,
    type: WorkerMessageType.FS_WRITE,
    data: {
      path,
      content,
      type: blob.type || 'application/octet-stream',
    },
  };

  const written = await getToolWorkerClient().request<boolean>(message, [content]);
  if (!written) {
    throw new Error(`Could not hydrate OpenSCAD project asset ${path}.`);
  }
}

export async function previewScadColoredViaToolWorker(
  project: OpenScadProject,
  assetScope?: OpenScadProjectAssetScope,
): Promise<{ stl: Blob; off: Blob | undefined }> {
  const normalizedProject = normalizeOpenScadProject(project);

  if (normalizedProject.assets?.length) {
    if (!assetScope) {
      throw new Error(
        'OpenSCAD project assets require an active conversation storage scope.',
      );
    }
    await hydrateOpenScadProjectAssets(
      normalizedProject,
      assetScope,
      writeProjectAssetToToolWorker,
    );
  }

  const requestId = `tool-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const message: WorkerMessage & { id: string } = {
    id: requestId,
    type: WorkerMessageType.PREVIEW,
    data: { project: normalizedProject, params: [], fileType: 'stl' },
  };

  const response =
    await getToolWorkerClient().request<OpenSCADWorkerResponseData>(message);
  assertOpenScadOutputWithinLimit(response);

  if (!response.output) {
    throw new Error('OpenSCAD did not return a preview output');
  }

  const stl = new Blob([new Uint8Array(response.output)], {
    type: 'model/stl',
  });
  const offBytes = response.extraOutputs?.off;
  const off = offBytes
    ? new Blob([new Uint8Array(offBytes)], { type: 'text/plain' })
    : undefined;

  return { stl, off };
}
