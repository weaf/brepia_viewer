import { useCallback, useEffect, useRef, useState } from 'react';
import OpenSCADError from '@/lib/OpenSCADError';
import { assertOpenScadOutputWithinLimit, OPENSCAD_EXPORT_TIMEOUT_MS, OPENSCAD_DEFAULT_OUTPUT_LIMIT_MIB, type OpenScadOutputLimitMiB } from '@/lib/openScadLimits';
import { requestPreviewWithOutputFallback } from '@/lib/openScadPreviewFallback';
import { normalizeOpenSCADDxf } from '@/utils/dxfUtils';
import { getOpenScadExportFormat, isOpenScadExportFormat } from '@/lib/openScadExportFormats';
import { OpenScadWorkerClient } from '@/worker/openScadWorkerClient';
import type { OpenSCADWorkerResponseData, OpenScadCompilePhases, WorkerMessage } from '@/worker/types';
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

export function useOpenSCAD(outputLimitMiB: OpenScadOutputLimitMiB = OPENSCAD_DEFAULT_OUTPUT_LIMIT_MIB) {
  const [previewColorFallback, setPreviewColorFallback] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isPreviewCancelled, setIsPreviewCancelled] = useState(false);
  const [previewCompileDurationMs, setPreviewCompileDurationMs] = useState<number | null>(null);
  const [previewRoundTripMs, setPreviewRoundTripMs] = useState<number | null>(null);
  const [previewCompilePhases, setPreviewCompilePhases] = useState<OpenScadCompilePhases | null>(null);
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
    async (
      project: OpenScadProject,
      options: { includeColorData?: boolean } = {},
    ): Promise<void> => {
      setIsCompiling(true);
      setPreviewColorFallback(false);
      setIsPreviewCancelled(false);
      setPreviewCompileDurationMs(null);
      setPreviewRoundTripMs(null);
      setPreviewCompilePhases(null);
      setError(undefined);
      setIsError(false);

      const id = requestId('preview');
      activeCompileRef.current = id;

      try {
        const normalizedProject = normalizeOpenScadProject(project);
        await ensureCachedFiles();
        const requestStartedAt = performance.now();
        const { response, usedFallback } = await requestPreviewWithOutputFallback(
          async (includeColorData) => {
            const result = await getClient().request<OpenSCADWorkerResponseData>({
              id: requestId('preview-request'),
              type: WorkerMessageType.PREVIEW,
              data: {
                project: normalizedProject,
                params: [],
                fileType: 'stl',
                includeColorData,
                outputLimitMiB,
              },
            });
            assertOpenScadOutputWithinLimit(result, outputLimitMiB);
            return result;
          },
          options.includeColorData,
          () => activeCompileRef.current === id,
        );
        const roundTripMs = performance.now() - requestStartedAt;

        if (activeCompileRef.current !== id) return;

        if (!response.output) {
          throw new Error('OpenSCAD did not return a preview output');
        }

        setPreviewColorFallback(usedFallback);
        setPreviewRoundTripMs(roundTripMs);
        setPreviewCompilePhases(response.compilePhases ?? null);
        setPreviewCompileDurationMs(
          Number.isFinite(response.duration) && response.duration >= 0
            ? response.duration
            : null,
        );
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
        setPreviewCompileDurationMs(null);
        setPreviewRoundTripMs(null);
        setPreviewCompilePhases(null);
        setOutput(undefined);
        setOffOutput(undefined);
      } finally {
        if (activeCompileRef.current === id) {
          activeCompileRef.current = null;
          setIsCompiling(false);
        }
      }
    },
    [ensureCachedFiles, getClient, outputLimitMiB],
  );

  const cancelPreview = useCallback((): void => {
    // Invalidate the request ID before rejecting the worker's pending requests.
    // A late response or rejection from the previous worker must never update
    // the currently displayed preview.
    if (activeCompileRef.current === null) return;
    activeCompileRef.current = null;
    clientRef.current?.reset(new Error('OpenSCAD preview cancelled'));
    setIsCompiling(false);
    setIsPreviewCancelled(true);
    setPreviewColorFallback(false);
    setPreviewCompileDurationMs(null);
    setPreviewRoundTripMs(null);
    setPreviewCompilePhases(null);
    setIsError(false);
    setError(undefined);
    setOutput(undefined);
    setOffOutput(undefined);
  }, []);

  const previewProjectColored = useCallback(
    async (
      project: OpenScadProject,
      options: { includeColorData?: boolean } = {},
    ): Promise<{ stl: Blob; off: Blob | undefined }> => {
      const normalizedProject = normalizeOpenScadProject(project);
      await ensureCachedFiles();
      const id = requestId('preview');
      const message: WorkerMessage & { id: string } = {
        id,
        type: WorkerMessageType.PREVIEW,
        data: {
          project: normalizedProject,
          params: [],
          fileType: 'stl',
          includeColorData: options.includeColorData,
          outputLimitMiB,
        },
      };
      const response =
        await getClient().request<OpenSCADWorkerResponseData>(message);
      assertOpenScadOutputWithinLimit(response, outputLimitMiB);

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
    [ensureCachedFiles, getClient, outputLimitMiB],
  );

  const exportProject = useCallback(
    async (project: OpenScadProject, fileType: string): Promise<Blob> => {
      if (!isOpenScadExportFormat(fileType)) {
        throw new Error(`Unsupported OpenSCAD export format: ${fileType}`);
      }
      const format = getOpenScadExportFormat(fileType);
      const normalizedProject = normalizeOpenScadProject(project);
      await ensureCachedFiles();
      const id = requestId('export');
      const message: WorkerMessage & { id: string } = {
        id,
        type: WorkerMessageType.EXPORT,
        data: { project: normalizedProject, params: [], fileType, outputLimitMiB },
      };
      const response =
        await getClient().request<OpenSCADWorkerResponseData>(
          message,
          [],
          OPENSCAD_EXPORT_TIMEOUT_MS,
        );
      assertOpenScadOutputWithinLimit(response, outputLimitMiB);

      if (!response.output) {
        throw new Error('OpenSCAD did not return an export output');
      }

      const outputBytes = new Uint8Array(response.output);
      const mimeType = format.mimeType;

      if (response.fileType === 'dxf') {
        const dxf = new TextDecoder().decode(outputBytes);
        return new Blob([normalizeOpenSCADDxf(dxf)], { type: mimeType });
      }

      return new Blob([outputBytes], { type: mimeType });
    },
    [ensureCachedFiles, getClient, outputLimitMiB],
  );

  return {
    compileProject,
    cancelPreview,
    isPreviewCancelled,
    previewColorFallback,
    previewCompileDurationMs,
    previewRoundTripMs,
    previewCompilePhases,
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
