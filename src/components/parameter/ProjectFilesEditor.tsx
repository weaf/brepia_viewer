import { FileCode2, Maximize2, Minimize2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OpenScadSourceEditor } from '@/components/parameter/OpenScadSourceEditor';
import type { OpenScadProject } from '@shared/openScadProject';

interface ProjectFilesEditorProps {
  project?: OpenScadProject;
  onSaveFile?: (path: string, content: string) => Promise<void>;
  disabled?: boolean;
  onEditorOpen?: () => void;
}

export function ProjectFilesEditor({ project, onSaveFile, disabled = false, onEditorOpen }: ProjectFilesEditorProps) {
  const files = useMemo(() => project?.files ?? [], [project]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedFile = useMemo(
    () => files.find(file => file.path === selectedPath) ?? null,
    [files, selectedPath],
  );
  const canEdit = !!selectedFile && !!onSaveFile && !disabled;
  const draftContent = selectedFile ? (drafts[selectedFile.path] ?? selectedFile.content) : '';
  const isDirty = !!selectedFile && draftContent !== selectedFile.content;
  const isAnyDirty = files.some(file =>
    drafts[file.path] !== undefined && drafts[file.path] !== file.content,
  );
  const completionProject = useMemo(
    () => project ? {
      ...project,
      files: project.files.map(file => ({
        ...file,
        content: drafts[file.path] ?? file.content,
      })),
    } : undefined,
    [project, drafts],
  );

  if (!project) return null;

  const openFile = (path: string) => {
    if (!files.some(file => file.path === path)) return;
    setDrafts({});
    setSelectedPath(path);
    setIsExpanded(false);
    setSaveError(null);
    // Clear the stale import confirmation before the editor becomes interactive.
    onEditorOpen?.();
    setDialogOpen(true);
  };

  const changeFile = (path: string) => {
    if (isSaving || !files.some(file => file.path === path)) return;
    // Every file keeps its own unsaved draft while the dialog is open.
    setSelectedPath(path);
    setSaveError(null);
  };

  const changeDraft = (content: string) => {
    if (!selectedPath || !canEdit) return;
    setDrafts(previous => ({ ...previous, [selectedPath]: content }));
  };

  const discardDraft = () => {
    if (!selectedFile) return;
    setDrafts(previous => {
      const next = { ...previous };
      delete next[selectedFile.path];
      return next;
    });
    setSaveError(null);
  };

  const closeEditor = () => {
    if (isSaving) return;
    if (isAnyDirty && !window.confirm('Discard unsaved changes in the project editor?')) return;
    setDialogOpen(false);
    setSelectedPath(null);
    setDrafts({});
    setSaveError(null);
    setIsExpanded(false);
  };

  const saveDraft = async () => {
    if (!selectedFile || !canEdit || !isDirty || !onSaveFile || isSaving) return;
    const savedPath = selectedFile.path;
    const content = draftContent;
    const hasOtherDirty = files.some(file =>
      file.path !== savedPath &&
      drafts[file.path] !== undefined &&
      drafts[file.path] !== file.content,
    );

    setIsSaving(true);
    setSaveError(null);
    try {
      await onSaveFile(savedPath, content);
      setDrafts(previous => {
        const next = { ...previous };
        delete next[savedPath];
        return next;
      });
      if (!hasOtherDirty) {
        setDialogOpen(false);
        setSelectedPath(null);
        setDrafts({});
        setIsExpanded(false);
      }
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Brepia could not save this project file.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="border-b border-adam-neutral-700 bg-adam-bg-secondary-dark px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-adam-text-primary">Project files</div>
          <div className="text-[10px] text-adam-neutral-400">
            {files.length} source {files.length === 1 ? 'file' : 'files'}
            {project.assets?.length
              ? ' · ' + project.assets.length + ' ' + (project.assets.length === 1 ? 'asset' : 'assets')
              : ''}
          </div>
        </div>
      </div>

      <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
        {files.map(file => {
          const depth = Math.max(0, file.path.split('/').length - 1);
          return (
            <div key={file.path}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-adam-neutral-300"
              style={{ paddingLeft: 8 + Math.min(depth, 4) * 10 + 'px' }}>
              <FileCode2 className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>{file.path}</span>
              <Button type="button" variant="light" size="default"
                className="h-10 min-h-10 shrink-0 px-4 font-semibold"
                aria-label={'Open ' + file.path} onClick={() => openFile(file.path)}>
                Open
              </Button>
            </div>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={open => { if (open) setDialogOpen(true); else closeEditor(); }}>
        <DialogContent
          className={cn(
            'flex min-w-0 flex-col gap-2 overflow-hidden rounded-lg bg-adam-bg-secondary-dark p-2 sm:gap-3 sm:p-4',
            isExpanded
              ? 'h-[100dvh] max-h-[100dvh] w-screen max-w-none sm:h-[calc(100dvh-0.75rem)] sm:max-h-[calc(100dvh-0.75rem)] sm:w-[calc(100vw-0.75rem)] sm:max-w-none'
              : 'h-[96dvh] max-h-[96dvh] w-[calc(100vw-0.5rem)] max-w-none sm:h-[88dvh] sm:max-h-[88dvh] sm:w-[92vw] sm:max-w-6xl',
          )}
        >
          <DialogHeader className="shrink-0 pr-20">
            <DialogTitle className="flex min-w-0 items-center gap-2 text-adam-text-primary">
              <FileCode2 className="h-4 w-4 shrink-0" />
              <span className="truncate font-mono text-xs sm:text-sm">
                {selectedFile?.path ?? 'Project file'}
              </span>
            </DialogTitle>
            <Button type="button" variant="ghost" size="icon"
              className="absolute right-12 top-2 h-9 w-9 text-adam-neutral-200 hover:bg-adam-neutral-800 sm:top-3"
              aria-label={isExpanded ? 'Restore editor' : 'Expand editor'}
              title={isExpanded ? 'Restore editor' : 'Expand editor'}
              onClick={() => setIsExpanded(current => !current)}>
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <DialogDescription className="sr-only">
              Edit the selected OpenSCAD source file. Save or discard changes.
            </DialogDescription>
          </DialogHeader>

          <OpenScadSourceEditor
            key={selectedPath ?? 'none'}
            ariaLabel={selectedFile ? 'OpenSCAD source for ' + selectedFile.path : 'OpenSCAD source'}
            value={draftContent}
            onChange={changeDraft}
            readOnly={!canEdit || isSaving}
            project={completionProject}
            currentPath={selectedFile?.path}
            onSelectFile={changeFile}
            onSave={() => { void saveDraft(); }}
            onDiscard={discardDraft}
            isDirty={isDirty}
            isSaving={isSaving}
          />
          {saveError && (
            <p className="shrink-0 text-xs text-red-400" role="alert">{saveError}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
