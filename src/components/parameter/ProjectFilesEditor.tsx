import { FileCode2, Save, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { OpenScadSourceEditor } from '@/components/parameter/OpenScadSourceEditor';
import type { OpenScadProject } from '@shared/openScadProject';

interface ProjectFilesEditorProps {
  project?: OpenScadProject;
  onSaveFile?: (path: string, content: string) => Promise<void>;
  disabled?: boolean;
}

export function ProjectFilesEditor({
  project,
  onSaveFile,
  disabled = false,
}: ProjectFilesEditorProps) {
  const files = useMemo(() => project?.files ?? [], [project]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedPath) ?? null,
    [files, selectedPath],
  );
  const isEntrypoint = selectedPath === project?.entrypointPath;
  const canEdit = !!selectedFile && !!onSaveFile && !disabled;
  const isDirty = !!selectedFile && draftContent !== selectedFile.content;

  useEffect(() => {
    if (!selectedFile) return;
    setDraftContent(selectedFile.content);
    setSaveError(null);
  }, [selectedFile]);

  if (!project) return null;

  const openFile = (path: string) => {
    const file = files.find((candidate) => candidate.path === path);
    if (!file) return;
    setSelectedPath(path);
    setDraftContent(file.content);
    setSaveError(null);
    setDialogOpen(true);
  };

  const discardDraft = () => {
    if (!selectedFile) return;
    setDraftContent(selectedFile.content);
    setSaveError(null);
  };

  const saveDraft = async () => {
    if (!selectedFile || !canEdit || !isDirty || !onSaveFile) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSaveFile(selectedFile.path, draftContent);
      setDialogOpen(false);
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
          <div className="text-xs font-semibold text-adam-text-primary">
            Project files
          </div>
          <div className="text-[10px] text-adam-neutral-400">
            {files.length} source {files.length === 1 ? 'file' : 'files'}
            {project.assets?.length
              ? ` · ${project.assets.length} ${project.assets.length === 1 ? 'asset' : 'assets'}`
              : ''}
          </div>
        </div>
      </div>

      <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
        {files.map((file) => {
          const entrypoint = file.path === project.entrypointPath;
          const depth = Math.max(0, file.path.split('/').length - 1);
          return (
            <button
              key={file.path}
              type="button"
              onClick={() => openFile(file.path)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-adam-neutral-300 transition-colors hover:bg-adam-neutral-800 hover:text-adam-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-adam-neutral-500"
              style={{ paddingLeft: `${8 + Math.min(depth, 4) * 10}px` }}
            >
              <FileCode2 className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-mono">
                {file.path}
              </span>
              {entrypoint && (
                <span className="shrink-0 rounded-full border border-adam-neutral-600 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-adam-neutral-300">
                  Entrypoint
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-4 bg-adam-bg-secondary-dark p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex min-w-0 items-center gap-2 text-adam-text-primary">
              <FileCode2 className="h-4 w-4 shrink-0" />
              <span className="truncate font-mono text-sm sm:text-base">
                {selectedFile?.path ?? 'Project file'}
              </span>
            </DialogTitle>
            <DialogDescription className="text-adam-neutral-400">
              {disabled
                ? 'Project file editing is disabled while the current AI turn is streaming.'
                : isEntrypoint
                  ? 'Edit the project entrypoint inside the current project snapshot. Saving preserves support files, assets and the entrypoint path, then refreshes parameters and preview from the saved source.'
                  : 'Edit this support file inside the current project snapshot. Saving preserves the entrypoint, other source files and asset manifest.'}
            </DialogDescription>
          </DialogHeader>

          <OpenScadSourceEditor
            ariaLabel={
              selectedFile
                ? `OpenSCAD source for ${selectedFile.path}`
                : 'OpenSCAD source'
            }
            value={draftContent}
            onChange={setDraftContent}
            readOnly={!canEdit}
            project={project}
            currentPath={selectedFile?.path}
          />

          {saveError && (
            <p className="text-xs text-red-400" role="alert">
              {saveError}
            </p>
          )}

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="ghost"
              onClick={discardDraft}
              disabled={!isDirty || isSaving}
              className="text-adam-text-primary"
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Discard
            </Button>
            <Button
              type="button"
              onClick={() => void saveDraft()}
              disabled={!canEdit || !isDirty || isSaving}
            >
              <Save className="mr-2 h-4 w-4" />
              {isSaving
                ? 'Saving…'
                : isEntrypoint
                  ? 'Save entrypoint'
                  : 'Save support file'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
