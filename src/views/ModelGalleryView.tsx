import { ActivityIndicator } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectFilesEditor } from "@/components/parameter/ProjectFilesEditor";
import { ParameterInput } from "@/components/parameter/ParameterInput";
import {
  LocalOpenScadPreview,
  type LocalOpenScadPreviewExportState,
} from "@/components/viewer/LocalOpenScadPreview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportStep } from "@/services/stepExport";
import { downloadFile } from "@/utils/downloadUtils";
import { getSafeFilename } from "@/utils/file-utils";
import { generatePreview, generateColoredPreview } from "@/utils/meshUtils";
import {
  getCachedModelThumbnail,
  saveCachedModelThumbnail,
} from "@/services/localModelLibrary";
import { useOpenSCAD } from "@/hooks/useOpenSCAD";
import { useToast } from "@/hooks/use-toast";
import {
  finalizeScadFolderImport,
  readScadImportFile,
  readScadImportFolder,
  type PendingScadFolderImport,
} from "@/lib/scadImport";
import { updateParameter } from "@/lib/utils";
import {
  getModelRepositories,
  modelRepositoryUrl,
} from "@/lib/modelRepositories";
import {
  BUILT_IN_MODELS_REFRESH_INTERVAL_MS,
  builtInModelRecordId,
  clearLocalModelData,
  createUploadedModel,
  getBuiltInCatalog,
  getLocalModels,
  getStoredModel,
  setLastOpenedLocalModel,
  loadBuiltInProject,
  removeUploadedModel,
  saveBuiltInWorkingCopy,
  saveLocalModel,
  type BuiltInModel,
  type LocalModelRecord,
} from "@/services/localModelLibrary";
import {
  normalizeOpenScadProject,
  replaceOpenScadProjectFileContent,
} from "@shared/openScadProject";
import parseParameters from "@shared/parseParameters";
import type { Parameter } from "@shared/types";
import {
  OPENSCAD_EXPORT_FORMATS,
  type EnabledOpenScadExportFormat,
} from "@/lib/openScadExportFormats";
import {
  ArrowLeft,
  Box,
  Check,
  Clock3,
  Code2,
  Download,
  FileUp,
  FolderOpen,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const supportedSourceFile = /\.scad(?:\.txt)?$/i;
const refreshTime = (updatedAt: number) => new Date(updatedAt).toLocaleString();
type ModelExportFormat = "scad" | "step" | EnabledOpenScadExportFormat;

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const separator = dataUrl.indexOf(",");
  if (separator < 0) throw new Error("Could not decode model preview image.");
  const metadata = dataUrl.slice(0, separator);
  const encoded = dataUrl.slice(separator + 1);
  const mimeType = metadata.match(/^data:([^;,]+)/)?.[1] ?? "image/png";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export function ModelGalleryView() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [builtIns, setBuiltIns] = useState<BuiltInModel[]>([]);
  const [builtInsUpdatedAt, setBuiltInsUpdatedAt] = useState<number | null>(
    null,
  );
  const [isBuiltInCache, setIsBuiltInCache] = useState(false);
  const [localModels, setLocalModels] = useState<LocalModelRecord[]>([]);
  const [isLoadingGallery, setIsLoadingGallery] = useState(true);
  const [isReloading, setIsReloading] = useState(false);
  const [search, setSearch] = useState("");
  const [activeRecord, setActiveRecord] = useState<LocalModelRecord | null>(
    null,
  );
  const [previewExportState, setPreviewExportState] =
    useState<LocalOpenScadPreviewExportState | null>(null);
  const [exportingFormat, setExportingFormat] =
    useState<ModelExportFormat | null>(null);
  const [isOpeningModel, setIsOpeningModel] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingFolder, setPendingFolder] =
    useState<PendingScadFolderImport | null>(null);
  const [folderEntrypoint, setFolderEntrypoint] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [thumbnails, setThumbnails] = useState<
    Record<string, { revision: string; url: string }>
  >({});
  const thumbnailUrlsRef = useRef(new Map<string, string>());
  const thumbnailInFlightRef = useRef(new Set<string>());
  const thumbnailQueueRef = useRef<Promise<void>>(Promise.resolve());
  const { previewProjectColored, writeFile } = useOpenSCAD();

  const refreshLocalModels = useCallback(async () => {
    setLocalModels(await getLocalModels());
  }, []);

  const handlePreviewExportStateChange = useCallback(
    (state: LocalOpenScadPreviewExportState) => setPreviewExportState(state),
    [],
  );

  const reloadBuiltIns = useCallback(
    async (force = false) => {
      setIsReloading(true);
      setErrorMessage(null);
      try {
        const result = await getBuiltInCatalog(force);
        setBuiltIns(result.models);
        setBuiltInsUpdatedAt(result.updatedAt);
        setIsBuiltInCache(result.fromCache);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not load built-in models.";
        setErrorMessage(message);
        toast({
          title: "Built-in models could not be loaded",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsReloading(false);
        setIsLoadingGallery(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void Promise.all([reloadBuiltIns(), refreshLocalModels()]).catch(
      (error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : "Could not load the local model gallery.";
        setErrorMessage(message);
        setIsLoadingGallery(false);
      },
    );
    const refreshTimer = window.setInterval(() => {
      void reloadBuiltIns();
    }, BUILT_IN_MODELS_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(refreshTimer);
  }, [refreshLocalModels, reloadBuiltIns]);

  const filteredBuiltIns = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return builtIns;
    return builtIns.filter((model) =>
      `${model.name} ${model.category} ${model.path}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [builtIns, search]);
  const filteredUploads = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return localModels;
    return localModels.filter((model) =>
      `${model.name} ${model.project.entrypointPath}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [localModels, search]);

  const getModelRevision = useCallback(
    async (record: LocalModelRecord): Promise<string> => {
      const assetDigests = await Promise.all(
        Object.entries(record.assetBlobs)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(async ([path, blob]) => {
            const digest = await crypto.subtle.digest(
              "SHA-256",
              await blob.arrayBuffer(),
            );
            return [
              path,
              Array.from(new Uint8Array(digest), (byte) =>
                byte.toString(16).padStart(2, "0"),
              ).join(""),
            ];
          }),
      );
      const source = JSON.stringify({
        entrypointPath: record.project.entrypointPath,
        files: [...record.project.files]
          .sort((left, right) => left.path.localeCompare(right.path))
          .map(({ path, content }) => [path, content]),
        assets: assetDigests,
      });
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(source),
      );
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
    [],
  );

  const createModelThumbnail = useCallback(
    async (record: LocalModelRecord): Promise<Blob> => {
      for (const asset of record.project.assets ?? []) {
        const blob = record.assetBlobs[asset.path];
        if (!blob) throw new Error(`Missing local model asset: ${asset.path}`);
        await writeFile(asset.path, blob);
      }
      let render: Awaited<ReturnType<typeof previewProjectColored>>;
      try {
        render = await previewProjectColored(record.project);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("OpenSCAD output exceeds")
        ) {
          throw error;
        }
        console.warn(
          `[Model gallery] Color data exceeded the output limit for ${record.name}; retrying as STL:`,
          error,
        );
        render = await previewProjectColored(record.project, {
          includeColorData: false,
        });
      }
      const { stl, off } = render;
      if (off) {
        try {
          const colorData = await generateColoredPreview(off);
          if (colorData) return dataUrlToBlob(colorData);
        } catch (error) {
          console.warn(
            `[Model gallery] Could not render colored preview for ${record.name}; using STL instead:`,
            error,
          );
        }
      }
      return dataUrlToBlob(await generatePreview(stl, "stl"));
    },
    [previewProjectColored, writeFile],
  );

  const ensureModelThumbnail = useCallback(
    async (
      record: LocalModelRecord,
      revision: string,
      displayRevision = revision,
    ) => {
      const cacheKey = `${record.id}:${revision}`;
      if (thumbnailInFlightRef.current.has(cacheKey)) return;
      thumbnailInFlightRef.current.add(cacheKey);
      try {
        let cached: Blob | undefined;
        try {
          cached = await getCachedModelThumbnail(record.id, revision);
        } catch (error) {
          console.warn(
            `[Model gallery] Could not read cached thumbnail for ${record.name}; rendering a fresh one:`,
            error,
          );
        }
        let blob = cached;
        if (!blob) {
          const renderJob = thumbnailQueueRef.current.then(() =>
            createModelThumbnail(record),
          );
          thumbnailQueueRef.current = renderJob.then(
            () => undefined,
            () => undefined,
          );
          blob = await renderJob;
          try {
            await saveCachedModelThumbnail(record.id, revision, blob);
          } catch (error) {
            console.warn(
              `[Model gallery] Could not cache thumbnail for ${record.name}:`,
              error,
            );
          }
        }
        const url = URL.createObjectURL(blob);
        const previousUrl = thumbnailUrlsRef.current.get(record.id);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        thumbnailUrlsRef.current.set(record.id, url);
        setThumbnails((current) => ({
          ...current,
          [record.id]: { revision: displayRevision, url },
        }));
      } catch (error) {
        console.warn(`[Model gallery] Could not render ${record.name}:`, error);
      } finally {
        thumbnailInFlightRef.current.delete(cacheKey);
      }
    },
    [createModelThumbnail],
  );

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.galleryModelId;
          if (!id) continue;
          observer.unobserve(entry.target);
          const uploaded = localModels.find((model) => model.id === id);
          if (uploaded) {
            void getModelRevision(uploaded)
              .then((revision) =>
                ensureModelThumbnail(uploaded, revision, uploaded.updatedAt),
              )
              .catch((error: unknown) => {
                console.warn(
                  `[Model gallery] Could not fingerprint ${uploaded.name}:`,
                  error,
                );
              });
            continue;
          }
          const builtIn = builtIns.find(
            (model) =>
              builtInModelRecordId(model.path, model.repositoryId) === id,
          );
          if (builtIn) {
            void loadBuiltInProject(builtIn)
              .then(async ({ project, assetBlobs }) => {
                const record: LocalModelRecord = {
                  id,
                  name: builtIn.name,
                  origin: "built-in",
                  project,
                  assetBlobs,
                  updatedAt: builtIn.sha,
                  sourcePath: builtIn.path,
                  sourceRepositoryId: builtIn.repositoryId,
                  sourceSha: builtIn.sha,
                };
                const revision = await getModelRevision(record);
                await ensureModelThumbnail(record, revision, builtIn.sha);
              })
              .catch((error: unknown) => {
                console.warn(
                  `[Model gallery] Could not load ${builtIn.name} for its thumbnail:`,
                  error,
                );
              });
          }
        }
      },
      { rootMargin: "160px" },
    );
    document
      .querySelectorAll<HTMLElement>("[data-gallery-model-id]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [builtIns, ensureModelThumbnail, getModelRevision, localModels]);

  useEffect(
    () => () => {
      for (const url of thumbnailUrlsRef.current.values())
        URL.revokeObjectURL(url);
      thumbnailUrlsRef.current.clear();
    },
    [],
  );

  const openBuiltIn = async (entry: BuiltInModel) => {
    setIsOpeningModel(true);
    setErrorMessage(null);
    try {
      const id = builtInModelRecordId(entry.path, entry.repositoryId);
      const saved = await getStoredModel(id);
      let record = saved;
      if (
        !saved ||
        saved.origin !== "built-in" ||
        saved.sourceSha !== entry.sha
      ) {
        const loaded = await loadBuiltInProject(entry);
        if (saved?.origin === "built-in" && saved.baseProject) {
          const oldBaseline = new Map(
            saved.baseProject.files.map((file) => [file.path, file.content]),
          );
          const oldWorking = new Map(
            saved.project.files.map((file) => [file.path, file.content]),
          );
          const nextFiles = loaded.project.files.map((file) => ({
            ...file,
            content:
              oldWorking.get(file.path) !== undefined &&
              oldWorking.get(file.path) !== oldBaseline.get(file.path)
                ? oldWorking.get(file.path)!
                : file.content,
          }));
          const latestProject = normalizeOpenScadProject({
            ...loaded.project,
            files: nextFiles,
          });
          record = await saveBuiltInWorkingCopy({
            entry,
            ...loaded,
            project: latestProject,
            baseProject: loaded.project,
          });
        } else {
          record = await saveBuiltInWorkingCopy({
            entry,
            ...loaded,
            baseProject: loaded.project,
          });
        }
      }
      if (!record)
        throw new Error("Could not create a local copy of this model.");
      setActiveRecord(record);
      void setLastOpenedLocalModel(record.id);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not open the built-in model.";
      setErrorMessage(message);
      toast({
        title: "Could not open model",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsOpeningModel(false);
    }
  };

  const openUploadedModel = (record: LocalModelRecord) => {
    setErrorMessage(null);
    setActiveRecord(record);
    void setLastOpenedLocalModel(record.id);
  };

  const persistRecord = async (next: LocalModelRecord) => {
    const saved = { ...next, updatedAt: new Date().toISOString() };
    await saveLocalModel(saved);
    await setLastOpenedLocalModel(saved.id);
    setActiveRecord(saved);
    if (next.origin === "upload") await refreshLocalModels();
  };

  const exportFormatAvailable = (format: ModelExportFormat): boolean => {
    if (
      !activeRecord ||
      !previewExportState ||
      previewExportState.project !== activeRecord.project ||
      previewExportState.isCompiling
    ) {
      return false;
    }
    if (format === "scad" || format === "dxf") return true;
    if (format === "step") {
      return (activeRecord.project.assets?.length ?? 0) === 0;
    }
    if (format === "stl" || format === "3mf")
      return Boolean(previewExportState.output);
    return OPENSCAD_EXPORT_FORMATS.some(
      (candidate) => candidate.id === format && candidate.enabled,
    );
  };

  const exportModel = async (format: ModelExportFormat) => {
    if (
      !activeRecord ||
      !previewExportState ||
      !exportFormatAvailable(format)
    ) {
      return;
    }
    setExportingFormat(format);
    try {
      const filename = getSafeFilename(activeRecord.name, "model");
      if (format === "scad") {
        const entrypoint = previewExportState.project.files.find(
          (file) => file.path === previewExportState.project.entrypointPath,
        );
        if (!entrypoint) throw new Error("The OpenSCAD entrypoint is missing.");
        downloadFile({
          content: entrypoint.content,
          filename: `${filename}.scad`,
          mimeType: "text/plain",
        });
      } else if (format === "dxf") {
        const dxf = await previewExportState.exportDxf();
        downloadFile({
          content: dxf,
          filename: `${filename}.dxf`,
          mimeType: "application/dxf",
        });
      } else if (format === "step") {
        const result = await exportStep(activeRecord.project);
        downloadFile({
          content: result.file,
          filename: `${filename}.step`,
          mimeType: "model/step",
        });
        if (result.warningCount > 0) {
          toast({
            title: "STEP exported with fallbacks",
            description:
              "Some OpenSCAD operations were converted using mesh fallback geometry.",
          });
        }
      } else {
        const metadata = OPENSCAD_EXPORT_FORMATS.find(
          (candidate) => candidate.id === format && candidate.enabled,
        );
        if (!metadata) throw new Error(`Unsupported export format: ${format}`);
        const exported = await previewExportState.exportFormat(format);
        downloadFile({
          content: exported,
          filename: `${filename}.${format}`,
          mimeType: metadata.mimeType,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `Could not export ${format.toUpperCase()}.`;
      toast({
        title: `${format.toUpperCase()} export failed`,
        description: message,
        variant: "destructive",
      });
    } finally {
      setExportingFormat(null);
    }
  };

  const saveActiveRecord = async () => {
    if (!activeRecord) return;
    try {
      const saved = { ...activeRecord, updatedAt: new Date().toISOString() };
      await saveLocalModel(saved);
      await setLastOpenedLocalModel(saved.id);
      setActiveRecord(saved);
      if (saved.origin === "upload") await refreshLocalModels();
      toast({
        title: "Saved locally",
        description: `${saved.name} and its files are now stored in this browser.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not save locally.";
      setErrorMessage(message);
      toast({
        title: "Could not save",
        description: message,
        variant: "destructive",
      });
    }
  };

  const clearViewerData = async () => {
    if (
      !window.confirm(
        "Clear all locally saved models, uploaded files, and changes from this browser?",
      )
    )
      return;
    try {
      await clearLocalModelData();
      setActiveRecord(null);
      setLocalModels([]);
      setBuiltIns([]);
      setBuiltInsUpdatedAt(null);
      setErrorMessage(null);
      toast({
        title: "Local data cleared",
        description:
          "Saved models, files, and changes have been removed from this browser.",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not clear local data.";
      setErrorMessage(message);
      toast({
        title: "Could not clear local data",
        description: message,
        variant: "destructive",
      });
    }
  };

  const saveProjectFile = async (path: string, content: string) => {
    if (!activeRecord) throw new Error("No model is selected.");
    const project = replaceOpenScadProjectFileContent(
      activeRecord.project,
      path,
      content,
    );
    await persistRecord({ ...activeRecord, project });
  };

  const changeParameter = async (
    parameter: Parameter,
    value: Parameter["value"],
  ) => {
    if (!activeRecord) return;
    const entrypoint = activeRecord.project.files.find(
      (file) => file.path === activeRecord.project.entrypointPath,
    );
    if (!entrypoint) return;
    const code = updateParameter(entrypoint.content, { ...parameter, value });
    const project = replaceOpenScadProjectFileContent(
      activeRecord.project,
      activeRecord.project.entrypointPath,
      code,
    );
    await persistRecord({ ...activeRecord, project });
  };

  const uploadSourceFile = async (file: File) => {
    if (!supportedSourceFile.test(file.name)) {
      throw new Error(
        "Choose an OpenSCAD .scad file, or upload a project folder with its dependencies.",
      );
    }
    const code = await readScadImportFile(file);
    return createUploadedModel({
      name: file.name.replace(/\.scad(?:\.txt)?$/i, "").trim(),
      project: normalizeOpenScadProject({
        schemaVersion: 1,
        entrypointPath: file.name.replace(/\.scad\.txt$/i, ".scad"),
        files: [
          { path: file.name.replace(/\.scad\.txt$/i, ".scad"), content: code },
        ],
      }),
    });
  };

  const uploadFolder = async (files: File[]) => {
    const result = await readScadImportFolder(files);
    if (result.kind === "entrypoint-required") {
      setPendingFolder(result.pending);
      setFolderEntrypoint(result.pending.entrypointCandidates[0] ?? "");
      return;
    }
    const record = await createUploadedModel({
      name: result.title,
      project: result.project,
      assets: result.assets,
    });
    await refreshLocalModels();
    openUploadedModel(record);
    toast({
      title: "Model uploaded",
      description: `${record.name} is saved in this browser.`,
    });
  };

  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  const onChooseFiles = async (files: File[]) => {
    if (!files.length) return;
    setIsUploading(true);
    setErrorMessage(null);
    try {
      if (files.length === 1 && supportedSourceFile.test(files[0].name)) {
        const record = await uploadSourceFile(files[0]);
        await refreshLocalModels();
        openUploadedModel(record);
        toast({
          title: "Model uploaded",
          description: `${record.name} is saved in this browser.`,
        });
      } else {
        await uploadFolder(files);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not upload this model.";
      setErrorMessage(message);
      toast({
        title: "Upload failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const finishFolderUpload = async () => {
    if (!pendingFolder || !folderEntrypoint) return;
    setIsUploading(true);
    try {
      const project = finalizeScadFolderImport(pendingFolder, folderEntrypoint);
      const record = await createUploadedModel({
        name: pendingFolder.title,
        project,
        assets: pendingFolder.assets,
      });
      setPendingFolder(null);
      setFolderEntrypoint("");
      await refreshLocalModels();
      openUploadedModel(record);
      toast({
        title: "Model uploaded",
        description: `${record.name} is saved in this browser.`,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not upload this model folder.";
      setErrorMessage(message);
      toast({
        title: "Upload failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const deleteUpload = async (record: LocalModelRecord) => {
    if (!window.confirm(`Remove “${record.name}” from this browser?`)) return;
    try {
      await removeUploadedModel(record.id);
      setLocalModels((models) =>
        models.filter((model) => model.id !== record.id),
      );
      if (activeRecord?.id === record.id) setActiveRecord(null);
      toast({
        title: "Model removed",
        description: `${record.name} was removed from this browser.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not remove this model.";
      toast({
        title: "Could not remove model",
        description: message,
        variant: "destructive",
      });
    }
  };

  const backToGallery = () => {
    setActiveRecord(null);
    setErrorMessage(null);
  };

  const parameters = useMemo(() => {
    if (!activeRecord) return [];
    const entrypoint = activeRecord.project.files.find(
      (file) => file.path === activeRecord.project.entrypointPath,
    );
    return entrypoint ? parseParameters(entrypoint.content) : [];
  }, [activeRecord]);

  if (activeRecord) {
    return (
      <main className="flex h-full min-h-0 flex-col bg-[#191a1a] text-adam-text-primary">
        <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-adam-neutral-700 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Back to model gallery"
              onClick={backToGallery}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {activeRecord.name}
              </p>
              <p className="truncate font-mono text-[10px] text-adam-neutral-400">
                {activeRecord.project.entrypointPath}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <span className="hidden items-center gap-1.5 text-[11px] text-adam-neutral-400 sm:flex">
              <Check className="h-3.5 w-3.5 text-emerald-400" /> Saved locally
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    exportingFormat !== null ||
                    !(
                      ["stl", "scad", "dxf", "step"] as const
                    ).some(exportFormatAvailable) &&
                    !OPENSCAD_EXPORT_FORMATS.some(
                      (format) => format.enabled && exportFormatAvailable(format.id),
                    )
                  }
                  className="gap-2"
                  aria-label="Export model"
                >
                  {exportingFormat ? (
                    <ActivityIndicator
                      label={`Exporting ${exportingFormat.toUpperCase()}`}
                      size="sm"
                    />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[min(80vh,36rem)] w-64 overflow-y-auto">
                {OPENSCAD_EXPORT_FORMATS.filter((format) => format.enabled).map((format) => (
                  <DropdownMenuItem
                    key={format.id}
                    disabled={
                      !exportFormatAvailable(format.id) || exportingFormat !== null
                    }
                    onSelect={() => void exportModel(format.id)}
                  >
                    <span>{format.label}</span>
                    <span className="ml-auto truncate pl-3 text-xs text-adam-neutral-400">
                      {format.description}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  disabled
                  title="The vendored OpenSCAD WASM build does not include the PDF exporter."
                >
                  <span>.PDF</span>
                  <span className="ml-auto text-xs text-adam-neutral-500">Unavailable</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled
                  title="The vendored OpenSCAD WASM build does not include the PNG exporter."
                >
                  <span>.PNG</span>
                  <span className="ml-auto text-xs text-adam-neutral-500">Unavailable</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!exportFormatAvailable("scad") || exportingFormat !== null}
                  onSelect={() => void exportModel("scad")}
                >
                  <span>.SCAD</span>
                  <span className="ml-auto text-xs text-adam-neutral-400">Source code</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={
                    !exportFormatAvailable("step") || exportingFormat !== null
                  }
                  onSelect={() => void exportModel("step")}
                  title={
                    activeRecord.project.assets?.length
                      ? "STEP export is unavailable for projects with external assets."
                      : undefined
                  }
                >
                  <span>.STEP</span>
                  <span className="ml-auto text-xs text-adam-neutral-400">
                    {activeRecord.project.assets?.length
                      ? "No external assets"
                      : "3D CAD exchange"}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              size="sm"
              onClick={() => void saveActiveRecord()}
              className="gap-2"
            >
              <Check className="h-4 w-4" /> Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void clearViewerData()}
              className="gap-2 text-adam-neutral-300"
            >
              <Trash2 className="h-4 w-4" /> Clear local data
            </Button>
          </div>
        </header>

        {errorMessage && (
          <div
            role="alert"
            className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-200 sm:mx-6"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {errorMessage}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(350px,0.8fr)] lg:overflow-hidden lg:p-6">
          <LocalOpenScadPreview
            key={activeRecord.id}
            project={activeRecord.project}
            assets={activeRecord.assetBlobs}
            onExportStateChange={handlePreviewExportStateChange}
          />
          <aside className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-xl border border-adam-neutral-700 bg-adam-bg-secondary-dark lg:min-h-0">
            <div className="flex shrink-0 items-center gap-2 border-b border-adam-neutral-700 px-4 py-3 text-xs font-semibold">
              <Code2 className="h-4 w-4 text-adam-neutral-300" /> Source and
              parameters
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <ProjectFilesEditor
                key={`local:${activeRecord.id}:${activeRecord.project.files.length}`}
                project={activeRecord.project}
                onSaveFile={saveProjectFile}
              />
              <section className="p-4">
                <h2 className="mb-3 text-xs font-semibold text-adam-text-primary">
                  Model parameters
                </h2>
                {parameters.length > 0 ? (
                  <div className="flex flex-col gap-4">
                    {parameters.map((parameter) => (
                      <ParameterInput
                        key={`${activeRecord.id}:${parameter.name}`}
                        param={parameter}
                        handleCommit={(next, value) => {
                          void changeParameter(next, value);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-adam-neutral-400">
                    This model has no exposed parameters. Open a source file
                    above to edit its OpenSCAD code.
                  </p>
                )}
              </section>
            </div>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="h-full min-h-0 overflow-auto bg-[#191a1a] text-adam-text-primary">
      <section className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-8 sm:pt-10">
        <header className="flex flex-col justify-between gap-6 border-b border-adam-neutral-700 pb-7 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-adam-neutral-400">
              Brepia-viewer / model library
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Model gallery
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-adam-neutral-400">
              View and edit OpenSCAD models directly in your browser. No sign-in
              required; uploaded models are saved locally on this device.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void clearViewerData()}
              disabled={isLoadingGallery}
              className="gap-2 border-adam-neutral-700"
            >
              <Trash2 className="h-4 w-4" /> Clear local data
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".scad,.scad.txt"
              className="hidden"
              disabled={isUploading}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void onChooseFiles(files);
              }}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              accept=".scad,.scad.txt,.stl,.off,.dxf,.svg,.dat"
              className="hidden"
              disabled={isUploading}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void onChooseFiles(files);
              }}
            />
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="gap-2 bg-adam-neutral-50 text-adam-neutral-800 hover:bg-adam-neutral-200"
            >
              {isUploading ? (
                <ActivityIndicator label="Uploading model" size="sm" />
              ) : (
                <FileUp className="h-4 w-4" />
              )}
              Upload model
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => folderInputRef.current?.click()}
              disabled={isUploading}
              className="gap-2 border-adam-neutral-700"
            >
              <FolderOpen className="h-4 w-4" /> Upload folder
            </Button>
          </div>
        </header>

        {errorMessage && !pendingFolder && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-200"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {errorMessage}
          </div>
        )}

        {pendingFolder && (
          <section
            className="mt-5 flex flex-col gap-3 rounded-lg border border-adam-neutral-700 bg-adam-background-1 p-4 sm:flex-row sm:items-end sm:justify-between"
            aria-label="Choose OpenSCAD entrypoint"
          >
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">
                Choose the project entrypoint
              </h2>
              <p className="mt-1 text-xs text-adam-neutral-400">
                This folder contains multiple possible models. Choose which
                .scad file to preview.
              </p>
              <select
                value={folderEntrypoint}
                onChange={(event) => setFolderEntrypoint(event.target.value)}
                className="mt-3 w-full rounded-md border border-adam-neutral-700 bg-adam-bg-dark px-3 py-2 text-xs sm:w-96"
              >
                {pendingFolder.entrypointCandidates.map((path) => (
                  <option key={path} value={path}>
                    {path}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPendingFolder(null);
                  setFolderEntrypoint("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void finishFolderUpload()}
                disabled={isUploading || !folderEntrypoint}
              >
                {isUploading ? "Saving…" : "Upload project"}
              </Button>
            </div>
          </section>
        )}

        <div className="mt-6 flex flex-col gap-3 border-b border-adam-neutral-700 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-adam-neutral-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models or categories"
              className="h-10 border-adam-neutral-700 bg-adam-background-1 pl-9 text-sm"
              aria-label="Search models"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-adam-neutral-400">
            {builtInsUpdatedAt !== null && (
              <span
                className="inline-flex items-center gap-1.5"
                title={isBuiltInCache ? "Visar cachelagrad katalog" : undefined}
              >
                <Clock3 className="h-3.5 w-3.5" />
                {isBuiltInCache
                  ? "Catalog last updated"
                  : "Models fetched"}: {refreshTime(builtInsUpdatedAt)}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void reloadBuiltIns(true)}
              disabled={isReloading}
              className="h-8 gap-2 px-2 text-xs text-adam-neutral-300"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isReloading ? "animate-spin" : ""}`}
              />
              reload built in models
            </Button>
          </div>
        </div>

        {isLoadingGallery ? (
          <div className="flex min-h-64 items-center justify-center">
            <ActivityIndicator label="Loading model gallery" size="lg" />
          </div>
        ) : (
          <>
            {filteredUploads.length > 0 && (
              <section className="mt-7" aria-labelledby="uploads-title">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 id="uploads-title" className="text-sm font-semibold">
                    Uploaded models{" "}
                    <span className="ml-1 font-mono text-xs text-adam-neutral-400">
                      {filteredUploads.length}
                    </span>
                  </h2>
                  <span className="text-[10px] text-adam-neutral-500">
                    Saved in this browser
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredUploads.map((record) => (
                    <article
                      key={record.id}
                      data-gallery-model-id={record.id}
                      className="group relative flex min-h-36 flex-col justify-between border border-adam-neutral-700 bg-adam-background-1 p-4 transition-colors hover:border-adam-neutral-500"
                    >
                      <button
                        type="button"
                        onClick={() => openUploadedModel(record)}
                        className="absolute inset-0 z-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue"
                        aria-label={`Open ${record.name}`}
                      />
                      <div className="pointer-events-none relative z-[1] mb-4 flex aspect-[16/9] items-center justify-center overflow-hidden border border-adam-neutral-700/70 bg-adam-neutral-900/50">
                        {thumbnails[record.id]?.revision ===
                        record.updatedAt ? (
                          <img
                            src={thumbnails[record.id].url}
                            alt={`Preview of ${record.name}`}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Box
                            className="h-8 w-8 text-adam-neutral-600"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                      <div className="pointer-events-none relative z-[1] flex items-start justify-between gap-3">
                        <div className="flex min-w-0 gap-3">
                          <Box className="mt-0.5 h-4 w-4 shrink-0 text-adam-neutral-300" />
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-medium">
                              {record.name}
                            </h3>
                            <p className="mt-1 truncate font-mono text-[10px] text-adam-neutral-500">
                              {record.project.entrypointPath}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="pointer-events-auto relative z-20 -mr-2 -mt-2 rounded p-2 text-adam-neutral-400 transition-colors hover:bg-red-950/50 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                          aria-label={`Remove ${record.name}`}
                          title="Remove uploaded model"
                          onClick={() => void deleteUpload(record)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="relative z-[1] mt-5 flex items-center justify-between text-[10px] text-adam-neutral-500 pointer-events-none">
                        <span>
                          {record.project.files.length} source{" "}
                          {record.project.files.length === 1 ? "file" : "files"}
                          {record.project.assets?.length
                            ? ` · ${record.project.assets.length} assets`
                            : ""}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Code2 className="h-3 w-3" /> Open editor
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-8" aria-labelledby="builtins-title">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 id="builtins-title" className="text-sm font-semibold">
                  Built-in models{" "}
                  <span className="ml-1 font-mono text-xs text-adam-neutral-400">
                    {filteredBuiltIns.length}
                  </span>
                </h2>
                <div className="flex flex-wrap gap-3 text-[10px]">
                  {getModelRepositories().map((repository) => (
                    <a
                      key={repository.id}
                      href={modelRepositoryUrl(repository)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-adam-neutral-400 underline decoration-adam-neutral-600 underline-offset-4 hover:text-adam-text-primary"
                    >
                      {repository.label} · GitHub
                    </a>
                  ))}
                </div>
              </div>
              {filteredBuiltIns.length ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredBuiltIns.map((entry) => {
                    return (
                      <button
                        key={entry.path}
                        type="button"
                        onClick={() => void openBuiltIn(entry)}
                        disabled={isOpeningModel}
                        data-gallery-model-id={builtInModelRecordId(
                          entry.path,
                          entry.repositoryId,
                        )}
                        className="group flex min-h-64 flex-col justify-between border border-adam-neutral-700 bg-adam-background-1 p-4 text-left transition-colors hover:border-adam-neutral-500 hover:bg-adam-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue disabled:opacity-60"
                      >
                        <div className="mb-4 flex aspect-[16/9] items-center justify-center overflow-hidden border border-adam-neutral-700/70 bg-adam-neutral-900/50">
                          {thumbnails[
                            builtInModelRecordId(entry.path, entry.repositoryId)
                          ]?.revision === entry.sha ? (
                            <img
                              src={
                                thumbnails[
                                  builtInModelRecordId(
                                    entry.path,
                                    entry.repositoryId,
                                  )
                                ].url
                              }
                              alt={`Preview of ${entry.name}`}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Box
                              className="h-8 w-8 text-adam-neutral-600"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 gap-3">
                            <Box className="mt-0.5 h-4 w-4 shrink-0 text-adam-neutral-300" />
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-medium">
                                {entry.name}
                              </h3>
                              <p className="mt-1 truncate text-[10px] text-adam-neutral-400">
                                {entry.category}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="mt-5 flex items-center justify-between text-[10px] text-adam-neutral-500">
                          <span className="truncate font-mono">
                            {entry.path}
                          </span>
                          <span className="ml-3 shrink-0 group-hover:text-adam-text-primary">
                            View →
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-48 flex-col items-center justify-center border border-dashed border-adam-neutral-700 px-6 text-center">
                  <Box className="h-6 w-6 text-adam-neutral-500" />
                  <p className="mt-3 text-sm text-adam-neutral-300">
                    {builtIns.length
                      ? "No models match your search."
                      : "No built-in OpenSCAD models found."}
                  </p>
                  {builtIns.length === 0 && (
                    <div className="mt-2 flex flex-wrap justify-center gap-3">
                      {getModelRepositories().map((repository) => (
                        <a
                          key={repository.id}
                          className="text-xs text-adam-neutral-400 underline underline-offset-4"
                          href={modelRepositoryUrl(repository)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open {repository.label} on GitHub
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {!filteredUploads.length && !search && (
              <p className="mt-8 text-center text-xs text-adam-neutral-500">
                Upload a .scad file or an entire OpenSCAD project folder to add
                your own model.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
