import { useEffect, useRef, useState } from 'react';
import { FileUp, FolderOpen } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import * as Sentry from '@sentry/react';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GithubScadImportButton } from '@/components/GithubScadImportButton';
import { ActivityIndicator } from '@/components/brand';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  finalizeScadFolderImport,
  readScadImportFile,
  readScadImportFolder,
  type PendingScadFolderImport,
  type ScadFolderAssetInput,
} from '@/lib/scadImport';
import { createImportedScadProject } from '@/services/scadProjectImportService';
import type { OpenScadProject } from '@shared/openScadProject';
import type { Model } from '@shared/types';

type LocalImportMutationInput =
  | { kind: 'file'; file: File }
  | {
      kind: 'folder';
      filename: string;
      title: string;
      project: OpenScadProject;
      assets: ScadFolderAssetInput[];
    };

export function ScadImportButton({
  model,
  executionMode,
  disabled = false,
}: {
  model: Model;
  executionMode: 'cli' | 'streaming';
  disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isPreparingFolder, setIsPreparingFolder] = useState(false);
  const [pendingFolder, setPendingFolder] =
    useState<PendingScadFolderImport | null>(null);
  const [selectedEntrypoint, setSelectedEntrypoint] = useState('');

  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) return;
    // React's input typings do not consistently expose the non-standard but
    // widely supported directory-picker attributes. Set both spellings on the
    // DOM node so Chromium/WebKit can preserve File.webkitRelativePath.
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }, []);

  const reportImportError = (error: unknown) => {
    Sentry.captureException(error, { extra: { hook: 'SCAD import' } });
    toast({
      title: 'Could not import OpenSCAD project',
      description:
        error instanceof Error ? error.message : 'The SCAD import failed.',
      variant: 'destructive',
    });
  };

  const importMutation = useMutation({
    mutationFn: async (input: LocalImportMutationInput) => {
      if (!user?.id) throw new Error('User must be authenticated');

      const filename = input.kind === 'file' ? input.file.name : input.filename;
      const result =
        input.kind === 'file'
          ? await createImportedScadProject({
              userId: user.id,
              model,
              executionMode,
              filename,
              code: await readScadImportFile(input.file),
              origin: { source: 'upload' },
            })
          : await createImportedScadProject({
              userId: user.id,
              model,
              executionMode,
              filename,
              title: input.title,
              project: input.project,
              assets: input.assets,
              origin: { source: 'upload' },
            });

      posthog.capture('openscad_imported', {
        conversation_id: result.conversationId,
        filename,
        source: 'upload',
        import_kind: input.kind,
        file_count: input.kind === 'file' ? 1 : input.project.files.length,
        asset_count: input.kind === 'file' ? 0 : input.assets.length,
        compile_status: result.baseline.status,
      });

      return result;
    },
    onSuccess: async ({ conversationId }) => {
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      navigate({ to: '/editor/$id', params: { id: conversationId } });
    },
    onError: reportImportError,
  });

  const chooseFile = () => {
    if (!user?.id) return;
    fileInputRef.current?.click();
  };

  const chooseFolder = () => {
    if (!user?.id) return;
    folderInputRef.current?.click();
  };

  const prepareFolder = async (files: File[]) => {
    if (files.length === 0) return;
    setIsPreparingFolder(true);
    try {
      const result = await readScadImportFolder(files);
      if (result.kind === 'entrypoint-required') {
        setPendingFolder(result.pending);
        setSelectedEntrypoint(result.pending.entrypointCandidates[0] ?? '');
        return;
      }

      importMutation.mutate({
        kind: 'folder',
        filename: result.filename,
        title: result.title,
        project: result.project,
        assets: result.assets,
      });
    } catch (error) {
      reportImportError(error);
    } finally {
      setIsPreparingFolder(false);
    }
  };

  const importPendingFolder = () => {
    if (!pendingFolder || !selectedEntrypoint) return;
    try {
      const project = finalizeScadFolderImport(
        pendingFolder,
        selectedEntrypoint,
      );
      const { filename, title, assets } = pendingFolder;
      setPendingFolder(null);
      setSelectedEntrypoint('');
      importMutation.mutate({
        kind: 'folder',
        filename,
        title,
        project,
        assets,
      });
    } catch (error) {
      reportImportError(error);
    }
  };

  const isBusy = disabled || importMutation.isPending || isPreparingFolder;

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".scad,.scad.txt"
          className="hidden"
          disabled={isBusy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = '';
            if (file) importMutation.mutate({ kind: 'file', file });
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          accept=".scad,.scad.txt,.stl,.off,.dxf,.svg,.dat"
          multiple
          className="hidden"
          disabled={isBusy}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.currentTarget.value = '';
            void prepareFolder(files);
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={chooseFile}
          disabled={isBusy || !user?.id}
          className="gap-2 border-adam-neutral-700 bg-adam-background-2 text-adam-text-secondary hover:bg-adam-bg-secondary-dark"
        >
          {importMutation.isPending ? (
            <ActivityIndicator label="Importing SCAD" size="sm" />
          ) : (
            <FileUp className="h-4 w-4" />
          )}
          {importMutation.isPending ? 'Importing SCAD…' : 'Import SCAD'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={chooseFolder}
          disabled={isBusy || !user?.id}
          className="gap-2 border-adam-neutral-700 bg-adam-background-2 text-adam-text-secondary hover:bg-adam-bg-secondary-dark"
        >
          {isPreparingFolder ? (
            <ActivityIndicator label="Reading OpenSCAD folder" size="sm" />
          ) : (
            <FolderOpen className="h-4 w-4" />
          )}
          {isPreparingFolder ? 'Reading folder…' : 'Import folder'}
        </Button>
        <GithubScadImportButton
          model={model}
          executionMode={executionMode}
          disabled={isBusy}
        />
      </div>

      <Dialog
        open={pendingFolder !== null}
        onOpenChange={(open) => {
          if (!open && !importMutation.isPending) {
            setPendingFolder(null);
            setSelectedEntrypoint('');
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>Choose OpenSCAD entrypoint</DialogTitle>
            <DialogDescription>
              This folder has several possible top-level models. Choose the
              .scad file Brepia should execute as the project entrypoint.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              htmlFor="scad-folder-entrypoint"
              className="text-sm font-medium text-adam-text-secondary"
            >
              Entrypoint
            </label>
            <select
              id="scad-folder-entrypoint"
              value={selectedEntrypoint}
              onChange={(event) => setSelectedEntrypoint(event.target.value)}
              className="w-full rounded-md border border-adam-neutral-700 bg-adam-background-2 px-3 py-2 text-sm text-adam-text-primary outline-none focus:border-adam-neutral-500"
            >
              {pendingFolder?.entrypointCandidates.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
            <p className="text-xs text-adam-text-secondary">
              All .scad files and referenced relative assets keep their project
              paths in the imported project.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="secondary"
              disabled={importMutation.isPending}
              onClick={() => {
                setPendingFolder(null);
                setSelectedEntrypoint('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selectedEntrypoint || importMutation.isPending}
              onClick={importPendingFolder}
            >
              Import project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
