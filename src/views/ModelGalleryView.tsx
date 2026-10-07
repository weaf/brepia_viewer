import { ActivityIndicator } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProjectFilesEditor } from '@/components/parameter/ProjectFilesEditor';
import { ParameterInput } from '@/components/parameter/ParameterInput';
import { LocalOpenScadPreview } from '@/components/viewer/LocalOpenScadPreview';
import { useToast } from '@/hooks/use-toast';
import {
  finalizeScadFolderImport,
  readScadImportFile,
  readScadImportFolder,
  type PendingScadFolderImport,
  type ScadFolderAssetInput,
} from '@/lib/scadImport';
import { updateParameter } from '@/lib/utils';
import {
  BUILT_IN_MODELS_REPOSITORY,
  BUILT_IN_MODELS_REFRESH_INTERVAL_MS,
  builtInModelRecordId,
  clearLocalModelData,
  createUploadedModel,
  getBuiltInCatalog,
  getLastOpenedLocalModel,
  getLocalModels,
  getStoredModel,
  setLastOpenedLocalModel,
  loadBuiltInProject,
  removeUploadedModel,
  saveBuiltInWorkingCopy,
  saveLocalModel,
  type BuiltInModel,
  type LocalModelRecord,
} from '@/services/localModelLibrary';
import {
  normalizeOpenScadProject,
  replaceOpenScadProjectFileContent,
} from '@shared/openScadProject';
import parseParameters from '@shared/parseParameters';
import type { Parameter } from '@shared/types';
import {
  ArrowLeft,
  Box,
  Check,
  Clock3,
  Code2,
  FileUp,
  FolderOpen,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const supportedSourceFile = /\.scad(?:\.txt)?$/i;
const refreshTime = (updatedAt: number) => new Date(updatedAt).toLocaleString();

export function ModelGalleryView() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [builtIns, setBuiltIns] = useState<BuiltInModel[]>([]);
  const [builtInsUpdatedAt, setBuiltInsUpdatedAt] = useState<number | null>(null);
  const [isBuiltInCache, setIsBuiltInCache] = useState(false);
  const [localModels, setLocalModels] = useState<LocalModelRecord[]>([]);
  const [isLoadingGallery, setIsLoadingGallery] = useState(true);
  const [isReloading, setIsReloading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeRecord, setActiveRecord] = useState<LocalModelRecord | null>(null);
  const [isOpeningModel, setIsOpeningModel] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingFolder, setPendingFolder] = useState<PendingScadFolderImport | null>(null);
  const [folderEntrypoint, setFolderEntrypoint] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const refreshLocalModels = useCallback(async () => {
    setLocalModels(await getLocalModels());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getLastOpenedLocalModel()
      .then((record) => {
        if (!cancelled && record) setActiveRecord(record);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Could not restore the last local model.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadBuiltIns = useCallback(async (force = false) => {
    setIsReloading(true);
    setErrorMessage(null);
    try {
      const result = await getBuiltInCatalog(force);
      setBuiltIns(result.models);
      setBuiltInsUpdatedAt(result.updatedAt);
      setIsBuiltInCache(result.fromCache);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load built-in models.';
      setErrorMessage(message);
      toast({ title: 'Built-in models could not be loaded', description: message, variant: 'destructive' });
    } finally {
      setIsReloading(false);
      setIsLoadingGallery(false);
    }
  }, [toast]);

  useEffect(() => {
    void Promise.all([reloadBuiltIns(), refreshLocalModels()]).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Could not load the local model gallery.';
      setErrorMessage(message);
      setIsLoadingGallery(false);
    });
    const refreshTimer = window.setInterval(() => {
      void reloadBuiltIns();
    }, BUILT_IN_MODELS_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(refreshTimer);
  }, [refreshLocalModels, reloadBuiltIns]);

  const filteredBuiltIns = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return builtIns;
    return builtIns.filter((model) =>
      `${model.name} ${model.category} ${model.path}`.toLocaleLowerCase().includes(needle),
    );
  }, [builtIns, search]);
  const filteredUploads = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return localModels;
    return localModels.filter((model) => `${model.name} ${model.project.entrypointPath}`.toLocaleLowerCase().includes(needle));
  }, [localModels, search]);

  const openBuiltIn = async (entry: BuiltInModel) => {
    setIsOpeningModel(true);
    setErrorMessage(null);
    try {
      const id = builtInModelRecordId(entry.path);
      const saved = await getStoredModel(id);
      let record = saved;
      if (!saved || saved.origin !== 'built-in' || saved.sourceSha !== entry.sha) {
        const loaded = await loadBuiltInProject(entry);
        if (saved?.origin === 'built-in' && saved.baseProject) {
          const oldBaseline = new Map(saved.baseProject.files.map((file) => [file.path, file.content]));
          const oldWorking = new Map(saved.project.files.map((file) => [file.path, file.content]));
          const nextFiles = loaded.project.files.map((file) => ({
            ...file,
            content: oldWorking.get(file.path) !== undefined && oldWorking.get(file.path) !== oldBaseline.get(file.path)
              ? oldWorking.get(file.path)!
              : file.content,
          }));
          const latestProject = normalizeOpenScadProject({ ...loaded.project, files: nextFiles });
          record = await saveBuiltInWorkingCopy({ entry, ...loaded, project: latestProject, baseProject: loaded.project });
        } else {
          record = await saveBuiltInWorkingCopy({ entry, ...loaded, baseProject: loaded.project });
        }
      }
      if (!record) throw new Error('Could not create a local copy of this model.');
      setActiveRecord(record);
      void setLastOpenedLocalModel(record.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open the built-in model.';
      setErrorMessage(message);
      toast({ title: 'Could not open model', description: message, variant: 'destructive' });
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
    if (next.origin === 'upload') await refreshLocalModels();
  };

  const saveActiveRecord = async () => {
    if (!activeRecord) return;
    try {
      const saved = { ...activeRecord, updatedAt: new Date().toISOString() };
      await saveLocalModel(saved);
      await setLastOpenedLocalModel(saved.id);
      setActiveRecord(saved);
      if (saved.origin === 'upload') await refreshLocalModels();
      toast({ title: 'Sparat lokalt', description: `${saved.name} och dess filer finns kvar i den här webbläsaren.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kunde inte spara lokalt.';
      setErrorMessage(message);
      toast({ title: 'Kunde inte spara', description: message, variant: 'destructive' });
    }
  };

  const clearViewerData = async () => {
    if (!window.confirm('Rensa alla lokalt sparade modeller, uppladdade filer och ändringar i den här webbläsaren?')) return;
    try {
      await clearLocalModelData();
      setActiveRecord(null);
      setLocalModels([]);
      setBuiltIns([]);
      setBuiltInsUpdatedAt(null);
      setErrorMessage(null);
      toast({ title: 'Lokal data rensad', description: 'Sparade modeller, filer och ändringar har tagits bort från den här webbläsaren.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kunde inte rensa lokal data.';
      setErrorMessage(message);
      toast({ title: 'Kunde inte rensa lokal data', description: message, variant: 'destructive' });
    }
  };

  const saveProjectFile = async (path: string, content: string) => {
    if (!activeRecord) throw new Error('No model is selected.');
    const project = replaceOpenScadProjectFileContent(activeRecord.project, path, content);
    await persistRecord({ ...activeRecord, project });
  };

  const changeParameter = async (parameter: Parameter, value: Parameter['value']) => {
    if (!activeRecord) return;
    const entrypoint = activeRecord.project.files.find((file) => file.path === activeRecord.project.entrypointPath);
    if (!entrypoint) return;
    const code = updateParameter(entrypoint.content, { ...parameter, value });
    const project = replaceOpenScadProjectFileContent(activeRecord.project, activeRecord.project.entrypointPath, code);
    await persistRecord({ ...activeRecord, project });
  };

  const uploadSourceFile = async (file: File) => {
    if (!supportedSourceFile.test(file.name)) {
      throw new Error('Choose an OpenSCAD .scad file, or upload a project folder with its dependencies.');
    }
    const code = await readScadImportFile(file);
    return createUploadedModel({
      name: file.name.replace(/\.scad(?:\.txt)?$/i, '').trim(),
      project: normalizeOpenScadProject({
        schemaVersion: 1,
        entrypointPath: file.name.replace(/\.scad\.txt$/i, '.scad'),
        files: [{ path: file.name.replace(/\.scad\.txt$/i, '.scad'), content: code }],
      }),
    });
  };

  const uploadFolder = async (files: File[]) => {
    const result = await readScadImportFolder(files);
    if (result.kind === 'entrypoint-required') {
      setPendingFolder(result.pending);
      setFolderEntrypoint(result.pending.entrypointCandidates[0] ?? '');
      return;
    }
    const record = await createUploadedModel({
      name: result.title,
      project: result.project,
      assets: result.assets,
    });
    await refreshLocalModels();
    openUploadedModel(record);
    toast({ title: 'Model uploaded', description: `${record.name} is saved in this browser.` });
  };

  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
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
        toast({ title: 'Model uploaded', description: `${record.name} is saved in this browser.` });
      } else {
        await uploadFolder(files);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not upload this model.';
      setErrorMessage(message);
      toast({ title: 'Upload failed', description: message, variant: 'destructive' });
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
      setFolderEntrypoint('');
      await refreshLocalModels();
      openUploadedModel(record);
      toast({ title: 'Model uploaded', description: `${record.name} is saved in this browser.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not upload this model folder.';
      setErrorMessage(message);
      toast({ title: 'Upload failed', description: message, variant: 'destructive' });
    } finally {
      setIsUploading(false);
    }
  };

  const deleteUpload = async (record: LocalModelRecord) => {
    if (!window.confirm(`Remove “${record.name}” from this browser?`)) return;
    try {
      await removeUploadedModel(record.id);
      setLocalModels((models) => models.filter((model) => model.id !== record.id));
      if (activeRecord?.id === record.id) setActiveRecord(null);
      toast({ title: 'Model removed', description: `${record.name} was removed from this browser.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not remove this model.';
      toast({ title: 'Could not remove model', description: message, variant: 'destructive' });
    }
  };

  const backToGallery = () => {
    setActiveRecord(null);
    setErrorMessage(null);
  };

  const parameters = useMemo(() => {
    if (!activeRecord) return [];
    const entrypoint = activeRecord.project.files.find((file) => file.path === activeRecord.project.entrypointPath);
    return entrypoint ? parseParameters(entrypoint.content) : [];
  }, [activeRecord]);

  if (activeRecord) {
    return (
      <main className="flex h-full min-h-0 flex-col bg-[#191a1a] text-adam-text-primary">
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-adam-neutral-700 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button type="button" variant="ghost" size="icon" aria-label="Back to model gallery" onClick={backToGallery}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{activeRecord.name}</p>
              <p className="truncate font-mono text-[10px] text-adam-neutral-400">{activeRecord.project.entrypointPath}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[11px] text-adam-neutral-400 sm:flex">
              <Check className="h-3.5 w-3.5 text-emerald-400" /> Sparas lokalt
            </span>
            <Button type="button" size="sm" onClick={() => void saveActiveRecord()} className="gap-2">
              <Check className="h-4 w-4" /> Spara
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void clearViewerData()} className="gap-2 text-adam-neutral-300">
              <Trash2 className="h-4 w-4" /> Rensa lokalt
            </Button>
          </div>
        </header>

        {errorMessage && (
          <div role="alert" className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-200 sm:mx-6">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{errorMessage}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(350px,0.8fr)] lg:overflow-hidden lg:p-6">
          <LocalOpenScadPreview key={activeRecord.id} project={activeRecord.project} assets={activeRecord.assetBlobs} />
          <aside className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-xl border border-adam-neutral-700 bg-adam-bg-secondary-dark lg:min-h-0">
            <div className="flex shrink-0 items-center gap-2 border-b border-adam-neutral-700 px-4 py-3 text-xs font-semibold">
              <Code2 className="h-4 w-4 text-adam-neutral-300" /> Source and parameters
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <ProjectFilesEditor
                key={`local:${activeRecord.id}:${activeRecord.project.files.length}`}
                project={activeRecord.project}
                onSaveFile={saveProjectFile}
              />
              <section className="p-4">
                <h2 className="mb-3 text-xs font-semibold text-adam-text-primary">Model parameters</h2>
                {parameters.length > 0 ? (
                  <div className="flex flex-col gap-4">
                    {parameters.map((parameter) => (
                      <ParameterInput
                        key={`${activeRecord.id}:${parameter.name}`}
                        param={parameter}
                        handleCommit={(next, value) => { void changeParameter(next, value); }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-adam-neutral-400">
                    This model has no exposed parameters. Open a source file above to edit its OpenSCAD code.
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
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-adam-neutral-400">Brepia / model library</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Modellgalleri</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-adam-neutral-400">
              Visa och redigera OpenSCAD-modeller direkt i webbläsaren. Inloggning behövs inte; uppladdade modeller sparas lokalt på den här enheten.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void clearViewerData()} disabled={isLoadingGallery} className="gap-2 border-adam-neutral-700">
              <Trash2 className="h-4 w-4" /> Rensa lokal data
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".scad,.scad.txt"
              className="hidden"
              disabled={isUploading}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
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
                event.currentTarget.value = '';
                void onChooseFiles(files);
              }}
            />
            <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="gap-2 bg-adam-neutral-50 text-adam-neutral-800 hover:bg-adam-neutral-200">
              {isUploading ? <ActivityIndicator label="Uploading model" size="sm" /> : <FileUp className="h-4 w-4" />}
              Upload model
            </Button>
            <Button type="button" variant="outline" onClick={() => folderInputRef.current?.click()} disabled={isUploading} className="gap-2 border-adam-neutral-700">
              <FolderOpen className="h-4 w-4" /> Upload folder
            </Button>
          </div>
        </header>

        {errorMessage && !pendingFolder && (
          <div role="alert" className="mt-5 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{errorMessage}
          </div>
        )}

        {pendingFolder && (
          <section className="mt-5 flex flex-col gap-3 rounded-lg border border-adam-neutral-700 bg-adam-background-1 p-4 sm:flex-row sm:items-end sm:justify-between" aria-label="Choose OpenSCAD entrypoint">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Välj projektets startfil</h2>
              <p className="mt-1 text-xs text-adam-neutral-400">Mappen innehåller flera möjliga modeller. Välj vilken .scad-fil som ska visas.</p>
              <select value={folderEntrypoint} onChange={(event) => setFolderEntrypoint(event.target.value)} className="mt-3 w-full rounded-md border border-adam-neutral-700 bg-adam-bg-dark px-3 py-2 text-xs sm:w-96">
                {pendingFolder.entrypointCandidates.map((path) => <option key={path} value={path}>{path}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => { setPendingFolder(null); setFolderEntrypoint(''); }}>Avbryt</Button>
              <Button type="button" onClick={() => void finishFolderUpload()} disabled={isUploading || !folderEntrypoint}>{isUploading ? 'Sparar…' : 'Ladda upp projekt'}</Button>
            </div>
          </section>
        )}

        <div className="mt-6 flex flex-col gap-3 border-b border-adam-neutral-700 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-adam-neutral-400" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Sök modeller eller kategorier" className="h-10 border-adam-neutral-700 bg-adam-background-1 pl-9 text-sm" aria-label="Search models" />
          </label>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-adam-neutral-400">
            {builtInsUpdatedAt !== null && (
              <span className="inline-flex items-center gap-1.5" title={isBuiltInCache ? 'Visar cachelagrad katalog' : undefined}>
                <Clock3 className="h-3.5 w-3.5" />
                {isBuiltInCache ? 'Katalogens senaste uppdatering' : 'Modeller hämtade'}: {refreshTime(builtInsUpdatedAt)}
              </span>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => void reloadBuiltIns(true)} disabled={isReloading} className="h-8 gap-2 px-2 text-xs text-adam-neutral-300">
              <RefreshCw className={`h-3.5 w-3.5 ${isReloading ? 'animate-spin' : ''}`} />
              reload built in models
            </Button>
          </div>
        </div>

        {isLoadingGallery ? (
          <div className="flex min-h-64 items-center justify-center"><ActivityIndicator label="Loading model gallery" size="lg" /></div>
        ) : (
          <>
            {filteredUploads.length > 0 && (
              <section className="mt-7" aria-labelledby="uploads-title">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 id="uploads-title" className="text-sm font-semibold">Uppladdade modeller <span className="ml-1 font-mono text-xs text-adam-neutral-400">{filteredUploads.length}</span></h2>
                  <span className="text-[10px] text-adam-neutral-500">Sparade i den här webbläsaren</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredUploads.map((record) => (
                    <article key={record.id} className="group relative flex min-h-36 flex-col justify-between border border-adam-neutral-700 bg-adam-background-1 p-4 transition-colors hover:border-adam-neutral-500">
                      <button type="button" onClick={() => openUploadedModel(record)} className="absolute inset-0 z-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue" aria-label={`Open ${record.name}`} />
                      <div className="relative z-[1] flex items-start justify-between gap-3 pointer-events-none">
                        <div className="flex min-w-0 gap-3"><Box className="mt-0.5 h-4 w-4 shrink-0 text-adam-neutral-300" /><div className="min-w-0"><h3 className="truncate text-sm font-medium">{record.name}</h3><p className="mt-1 truncate font-mono text-[10px] text-adam-neutral-500">{record.project.entrypointPath}</p></div></div>
                        <button type="button" className="pointer-events-auto relative z-20 -mr-2 -mt-2 rounded p-2 text-adam-neutral-400 transition-colors hover:bg-red-950/50 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" aria-label={`Remove ${record.name}`} title="Poista ladattu malli" onClick={() => void deleteUpload(record)}><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <div className="relative z-[1] mt-5 flex items-center justify-between text-[10px] text-adam-neutral-500 pointer-events-none"><span>{record.project.files.length} source {record.project.files.length === 1 ? 'file' : 'files'}{record.project.assets?.length ? ` · ${record.project.assets.length} assets` : ''}</span><span className="inline-flex items-center gap-1"><Code2 className="h-3 w-3" /> Open editor</span></div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-8" aria-labelledby="builtins-title">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 id="builtins-title" className="text-sm font-semibold">Inbyggda modeller <span className="ml-1 font-mono text-xs text-adam-neutral-400">{filteredBuiltIns.length}</span></h2>
                <a href={BUILT_IN_MODELS_REPOSITORY} target="_blank" rel="noreferrer" className="text-[10px] text-adam-neutral-400 underline decoration-adam-neutral-600 underline-offset-4 hover:text-adam-text-primary">GitHub-källa</a>
              </div>
              {filteredBuiltIns.length ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredBuiltIns.map((entry) => {
                    return (
                      <button key={entry.path} type="button" onClick={() => void openBuiltIn(entry)} disabled={isOpeningModel} className="group flex min-h-36 flex-col justify-between border border-adam-neutral-700 bg-adam-background-1 p-4 text-left transition-colors hover:border-adam-neutral-500 hover:bg-adam-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue disabled:opacity-60">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 gap-3"><Box className="mt-0.5 h-4 w-4 shrink-0 text-adam-neutral-300" /><div className="min-w-0"><h3 className="truncate text-sm font-medium">{entry.name}</h3><p className="mt-1 truncate text-[10px] text-adam-neutral-400">{entry.category}</p></div></div>
                        </div>
                        <div className="mt-5 flex items-center justify-between text-[10px] text-adam-neutral-500"><span className="truncate font-mono">{entry.path}</span><span className="ml-3 shrink-0 group-hover:text-adam-text-primary">View →</span></div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-48 flex-col items-center justify-center border border-dashed border-adam-neutral-700 px-6 text-center">
                  <Box className="h-6 w-6 text-adam-neutral-500" />
                  <p className="mt-3 text-sm text-adam-neutral-300">{builtIns.length ? 'Inga modeller matchar sökningen.' : 'Inga inbyggda OpenSCAD-modeller hittades.'}</p>
                  {builtIns.length === 0 && <a className="mt-2 text-xs text-adam-neutral-400 underline underline-offset-4" href={BUILT_IN_MODELS_REPOSITORY} target="_blank" rel="noreferrer">Öppna modellkällan på GitHub</a>}
                </div>
              )}
            </section>

            {!filteredUploads.length && !search && (
              <p className="mt-8 text-center text-xs text-adam-neutral-500">Ladda upp en .scad-fil eller en hel OpenSCAD-projektmapp för att lägga till en egen modell.</p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
