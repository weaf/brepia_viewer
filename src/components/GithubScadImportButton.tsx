import { useState } from 'react';
import { Github } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import * as Sentry from '@sentry/react';
import posthog from 'posthog-js';
import { z } from 'zod';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ActivityIndicator } from '@/components/brand';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  scadImportTitle,
  type ScadFolderAssetInput,
} from '@/lib/scadImport';
import { apiJson } from '@/services/api';
import { createImportedScadProject } from '@/services/scadProjectImportService';
import type { Model } from '@shared/types';

const githubScadResponseSchema = z.object({
  filename: z.string().min(1),
  project: z.object({
    schemaVersion: z.literal(1),
    entrypointPath: z.string().min(1),
    files: z
      .array(
        z.object({
          path: z.string().min(1),
          content: z.string(),
        }),
      )
      .min(1),
  }),
  assets: z.array(
    z.object({
      path: z.string().min(1),
      contentBase64: z.string().min(1),
    }),
  ),
  canonicalUrl: z.string().url(),
});

function decodeBase64Asset(input: {
  path: string;
  contentBase64: string;
}): ScadFolderAssetInput {
  let binary: string;
  try {
    binary = atob(input.contentBase64);
  } catch {
    throw new Error(`GitHub returned invalid asset data for ${input.path}.`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { path: input.path, bytes };
}

export function GithubScadImportButton({
  model,
  executionMode,
  disabled = false,
}: {
  model: Model;
  executionMode: 'cli' | 'streaming';
  disabled?: boolean;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState('');

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('User must be authenticated');

      const resolved = await apiJson(
        'scad-import/github',
        {
          method: 'POST',
          body: JSON.stringify({ url: url.trim() }),
        },
        githubScadResponseSchema,
      );
      const assets = resolved.assets.map(decodeBase64Asset);
      const result = await createImportedScadProject({
        userId: user.id,
        model,
        executionMode,
        filename: resolved.filename,
        title: scadImportTitle(resolved.filename),
        project: resolved.project,
        assets,
        origin: {
          source: 'github',
          canonicalUrl: resolved.canonicalUrl,
        },
      });

      posthog.capture('openscad_imported', {
        conversation_id: result.conversationId,
        filename: resolved.filename,
        source: 'github',
        canonical_url: resolved.canonicalUrl,
        import_kind: resolved.project.files.length > 1 ? 'project' : 'file',
        file_count: resolved.project.files.length,
        asset_count: assets.length,
        compile_status: result.baseline.status,
      });

      return result;
    },
    onSuccess: async ({ conversationId }) => {
      setIsOpen(false);
      setUrl('');
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      navigate({ to: '/editor/$id', params: { id: conversationId } });
    },
    onError: (error) => {
      Sentry.captureException(error, { extra: { hook: 'GitHub SCAD import' } });
      toast({
        title: 'Could not import from GitHub',
        description:
          error instanceof Error
            ? error.message
            : 'The GitHub SCAD import failed.',
        variant: 'destructive',
      });
    },
  });

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || importMutation.isPending || !user?.id}
          className="gap-2 border-adam-neutral-700 bg-adam-background-2 text-adam-text-secondary hover:bg-adam-bg-secondary-dark"
        >
          <Github className="h-4 w-4" />
          Import GitHub
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-lg rounded-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Import OpenSCAD from GitHub</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-adam-text-secondary">
            Paste a GitHub blob/raw URL to the OpenSCAD entrypoint. Brepia will
            resolve bounded repository-local include/use dependencies and
            statically referenced relative assets at the same Git ref. Gists
            still require exactly one .scad file.
          </p>
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/owner/repo/blob/main/model.scad"
            disabled={importMutation.isPending}
            autoFocus
          />
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={importMutation.isPending}
              onClick={() => {
                setIsOpen(false);
                setUrl('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!url.trim() || importMutation.isPending}
              onClick={() => importMutation.mutate()}
              className="gap-2"
            >
              {importMutation.isPending && (
                <ActivityIndicator label="Importing from GitHub" size="sm" />
              )}
              {importMutation.isPending ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
