import { useCallback, useEffect, useRef, useState } from 'react';
import OpenSCADError from '@/lib/OpenSCADError';
import { assertOpenScadOutputWithinLimit } from '@/lib/openScadLimits';
import { normalizeOpenSCADDxf } from '@/utils/dxfUtils';
import { OpenScadWorkerClient } from '@/worker/openScadWorkerClient';
import type { OpenSCADWorkerResponseData, WorkerMessage } from '@/worker/types';
import { WorkerMessageType } from '@/worker/types';
import {
  normalizeOpenScadProject,
  type OpenScadProject,
} from '@shared/openScadProject';

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type CachedWorkerFile = {
  content: Blob | File;
  type: string;
};

export function useOpenSCAD() {
  const [isCompiling, setIsCompiling] = useState(false);
  const [error, setError] = useState<OpenSCADError | Error | undefined>();
  const [isError, setIsError] = useState(false);
  const [output, setOutput] = useState<Blob | undefined>();
  const [offOutput, setOffOutput] = useState<Blob | undefined>();

  const clientRef = useRef<OpenScadWorkerClient | null>(null);
  const activeCompileRef = useRef<string | null>(null);
  const cachedFilesRef = useRef<Map<string, CachedWorkerFile>>(new Map());
  const filesGenerationRef = useRef(0);
  const teardownTimeoutRef = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null);

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new OpenScadWorkerClient(
        () =>
          new Worker(new URL('../worker/worker.ts', import.meta.url), {
            type: 'module',
          }),
      );
    }
    return clientRef.current;
  }, []);

  useEffect(() => {
    if (teardownTimeoutRef.current !== null) {
      globalThis.clearTimeout(teardownTimeoutRef.current);
      teardownTimeoutRef.current = null;
    }

    const cachedFiles = cachedFilesRef.current;

    return () => {
      teardownTimeoutRef.current = globalThis.setTimeout(() => {
        clientRef.current?.reset();
        clientRef.current = null;
        activeCompileRef.current = null;
        cachedFiles.clear();
        filesGenerationRef.current = 0;
        teardownTimeoutRef.current = null;
      }, 0);
    };
  }, []);

  const writeWorkerFile = useCallback(
    async (path: string, content: Blob | File): Promise<void> => {
      const arrayBuffer = await content.arrayBuffer();
      const id = requestId('fs-write');
      const message: WorkerMessage & { id: string } = {
        id,
        type: WorkerMessageType.FS_WRITE,
        data: {
          path,
          content: arrayBuffer,
          type: content.type,
        },
      };
      await getClient().request(message, [arrayBuffer]);
    },
    [getClient],
  );

  const ensureCachedFiles = useCallback(async (): Promise<void> => {
    const client = getClient();
    const generation = client.getGeneration();
    if (filesGenerationRef.current === generation) return;

    for (const [path, cached] of cachedFilesRef.current) {
      await writeWorkerFile(path, cached.content);
    }
    filesGenerationRef.current = client.getGeneration();
  }, [getClient, writeWorkerFile]);

  const writeFile = useCallback(
    async (path: string, content: Blob | File): Promise<void> => {
      await ensureCachedFiles();
      await writeWorkerFile(path, content);
      cachedFilesRef.current.set(path, { content, type: content.type });
      filesGenerationRef.current = getClient().getGeneration();
    },
    [ensureCachedFiles, getClient, writeWorkerFile],
  );

  const compileProject = useCallback(
    async (project: OpenScadProject): Promise<void> => {
      setIsCompiling(true);
      setError(undefined);
      setIsError(false);

      const id = requestId('preview');
      activeCompileRef.current = id;

      try {
        const normalizedProject = normalizeOpenScadProject(project);
        await ensureCachedFiles();
        const response = await getClient().request<OpenSCADWorkerResponseData>({
          id,
          type: WorkerMessageType.PREVIEW,
          data: { project: normalizedProject, params: [], fileType: 'stl' },
        });
        assertOpenScadOutputWithinLimit(response);

        if (activeCompileRef.current !== id) return;

        if (!response.output) {
          throw new Error('OpenSCAD did not return a preview output');
        }

        setOutput(
          new Blob([new Uint8Array(response.output)], { type: 'model/stl' }),
        );
        const offBytes = response.extraOutputs?.off;
        setOffOutput(
          offBytes
            ? new Blob([new Uint8Array(offBytes)], { type: 'text/plain' })
            : undefined,
        );
      } catch (caught) {
        if (activeCompileRef.current !== id) return;
        const nextError =
          caught instanceof Error
            ? caught
            : new Error('OpenSCAD compilation failed');
        setError(nextError);
        setIsError(true);
        setOutput(undefined);
        setOffOutput(undefined);
      } finally {
        if (activeCompileRef.current === id) {
          activeCompileRef.current = null;
          setIsCompiling(false);
        }
      }
    },
    [ensureCachedFiles, getClient],
  );

  const previewProjectColored = useCallback(
    async (
      project: OpenScadProject,
    ): Promise<{ stl: Blob; off: Blob | undefined }> => {
      const normalizedProject = normalizeOpenScadProject(project);
      await ensureCachedFiles();
      const id = requestId('preview');
      const message: WorkerMessage & { id: string } = {
        id,
        type: WorkerMessageType.PREVIEW,
        data: { project: normalizedProject, params: [], fileType: 'stl' },
      };
      const response =
        await getClient().request<OpenSCADWorkerResponseData>(message);
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
    },
    [ensureCachedFiles, getClient],
  );

  const exportProject = useCallback(
    async (project: OpenScadProject, fileType: string): Promise<Blob> => {
      const normalizedProject = normalizeOpenScadProject(project);
      await ensureCachedFiles();
      const id = requestId('export');
      const message: WorkerMessage & { id: string } = {
        id,
        type: WorkerMessageType.EXPORT,
        data: { project: normalizedProject, params: [], fileType },
      };
      const response =
        await getClient().request<OpenSCADWorkerResponseData>(message);
      assertOpenScadOutputWithinLimit(response);

      if (!response.output) {
        throw new Error('OpenSCAD did not return an export output');
      }

      const outputBytes = new Uint8Array(response.output);
      const mimeType =
        response.fileType === 'stl'
          ? 'model/stl'
          : response.fileType === 'dxf'
            ? 'application/dxf'
            : 'application/octet-stream';

      if (response.fileType === 'dxf') {
        const dxf = new TextDecoder().decode(outputBytes);
        return new Blob([normalizeOpenSCADDxf(dxf)], { type: mimeType });
      }

      return new Blob([outputBytes], { type: mimeType });
    },
    [ensureCachedFiles, getClient],
  );

  return {
    compileProject,
    exportProject,
    previewProjectColored,
    writeFile,
    isCompiling,
    output,
    offOutput,
    error,
    isError,
  };
}
