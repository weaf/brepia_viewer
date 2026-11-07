import { FileCode2, Maximize2, Minimize2, Save, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedPath) ?? null,
    [files, selectedPath],
  );
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
    setIsExpanded(false);
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
          const depth = Math.max(0, file.path.split('/').length - 1);
          return (
            <div
              key={file.path}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-adam-neutral-300"
              style={{ paddingLeft: `${8 + Math.min(depth, 4) * 10}px` }}
            >
              <FileCode2 className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
                {file.path}
              </span>
              <Button
                type="button"
                variant="light"
                size="sm"
                className="shrink-0 font-semibold"
                aria-label={`Open ${file.path}`}
                onClick={() => openFile(file.path)}
              >
                Open
              </Button>
            </div>
          );
        })}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setIsExpanded(false);
        }}
      >
        <DialogContent
          className={cn(
            'flex h-[calc(100dvh-0.5rem)] max-h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-w-none min-w-0 flex-col gap-3 overflow-hidden rounded-lg bg-adam-bg-secondary-dark p-3 sm:gap-4 sm:p-5',
            isExpanded
              ? 'sm:h-[calc(100dvh-0.75rem)] sm:max-h-[calc(100dvh-0.75rem)] sm:w-[calc(100vw-0.75rem)] sm:max-w-none'
              : 'sm:h-[88dvh] sm:max-h-[88dvh] sm:w-[92vw] sm:max-w-6xl',
          )}
        >
          <DialogHeader className="shrink-0 pr-20">
            <DialogTitle className="flex min-w-0 items-center gap-2 text-adam-text-primary">
              <FileCode2 className="h-4 w-4 shrink-0" />
              <span className="truncate font-mono text-sm sm:text-base">
                {selectedFile?.path ?? 'Project file'}
              </span>
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-12 top-2 h-9 w-9 text-adam-neutral-200 hover:bg-adam-neutral-800 sm:top-3"
              aria-label={isExpanded ? 'Restore editor' : 'Expand editor'}
              title={isExpanded ? 'Restore editor' : 'Expand editor'}
              onClick={() => setIsExpanded((current) => !current)}
            >
              {isExpanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            <DialogDescription className="sr-only">
              Edit the selected OpenSCAD source file. Save your changes or discard them.
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

          <DialogFooter className="flex shrink-0 flex-row items-center justify-end gap-2 sm:space-x-0">
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
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
