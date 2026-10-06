import { Box, FileUp, Image as ImageIcon, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  createBrepProjectConversationFromTemplate,
  importBrepProjectConversation,
} from '@/services/brepProjectService';
import {
  BREP_PROJECT_PACKAGE_MAX_BYTES,
  parseBrepProjectPackageJson,
} from '@shared/brepProjectPackage';
import { builtinProductTemplateCatalog } from '@shared/productTemplateCatalog';
import {
  listBuiltinProductTemplateDiscovery,
  type ProductTemplateDiscoveryItem,
} from '@shared/productTemplateDiscovery';
import type { Conversation } from '@shared/types';

const builtInTemplateDiscovery = listBuiltinProductTemplateDiscovery(
  builtinProductTemplateCatalog,
);

function updatedLabel(conversation: Conversation): string {
  const value = conversation.updated_at ?? conversation.created_at;
  if (!value) return 'Saved BRep model';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Saved BRep model';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function BrepModelLibrary() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const importInputRef = useRef<HTMLInputElement>(null);
  const templateCreationInFlightRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [creatingTemplateKey, setCreatingTemplateKey] = useState<string | null>(
    null,
  );
  const [templateCreationError, setTemplateCreationError] = useState<
    string | null
  >(null);

  const { data: models = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ['brep-model-library', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', user?.id ?? '')
        .eq('type', 'parametric')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data as Conversation[]).filter(
        (conversation) =>
          conversation.settings?.parametricSourceKind === 'brep',
      );
    },
  });

  const createFromTemplate = async (template: ProductTemplateDiscoveryItem) => {
    if (!user?.id || templateCreationInFlightRef.current) return;

    templateCreationInFlightRef.current = true;
    const templateKey = `${template.templateId}@${template.templateVersion}`;
    setCreatingTemplateKey(templateKey);
    setTemplateCreationError(null);
    try {
      const conversationId = await createBrepProjectConversationFromTemplate({
        userId: user.id,
        templateId: template.templateId,
        templateVersion: template.templateVersion,
      });
      await navigate({ to: '/brep/$id', params: { id: conversationId } });
    } catch (reason) {
      setTemplateCreationError(
        reason instanceof Error
          ? reason.message
          : 'Could not create a BRep project from this template.',
      );
    } finally {
      templateCreationInFlightRef.current = false;
      setCreatingTemplateKey(null);
    }
  };

  const importPackage = async (file: File) => {
    if (!user?.id || importing) return;
    setImportError(null);
    if (file.size > BREP_PROJECT_PACKAGE_MAX_BYTES) {
      setImportError(
        `BRep project package exceeds ${BREP_PROJECT_PACKAGE_MAX_BYTES} bytes.`,
      );
      return;
    }

    setImporting(true);
    try {
      const projectPackage = parseBrepProjectPackageJson(await file.text());
      const conversationId = await importBrepProjectConversation({
        userId: user.id,
        projectPackage,
      });
      await navigate({ to: '/brep/$id', params: { id: conversationId } });
    } catch (reason) {
      setImportError(
        reason instanceof Error
          ? reason.message
          : 'Could not import BRep project.',
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <main className="h-full overflow-auto bg-adam-background-1 text-adam-text-primary">
      <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 lg:px-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Box className="h-6 w-6 text-adam-blue" />
              <h1 className="text-2xl font-semibold">BRep Models</h1>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-adam-text-tertiary">
              Discover built-in product templates or open a saved native BRep
              model and continue from its immutable revision history.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json,.brepia-brep.json"
              className="hidden"
              aria-label="Import saved BRep model"
              disabled={importing}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = '';
                if (file) void importPackage(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={importing || !user?.id}
              onClick={() => importInputRef.current?.click()}
            >
              <FileUp className="mr-2 h-4 w-4" />
              {importing ? 'Importing…' : 'Import model'}
            </Button>
            <Button type="button" onClick={() => void navigate({ to: '/app' })}>
              <Plus className="mr-2 h-4 w-4" />
              New Creation
            </Button>
          </div>
        </div>

        {importError ? (
          <p className="mt-5 rounded-lg border border-destructive p-3 text-sm text-destructive">
            {importError}
          </p>
        ) : null}

        <section className="mt-8" aria-label="Built-in product templates">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Product templates</h2>
              <p className="mt-1 text-sm text-adam-text-tertiary">
                Repository-owned product definitions. Creating a project copies
                the exact discovered template version into an independent BRep
                revision lineage.
              </p>
            </div>
          </div>

          {templateCreationError ? (
            <p className="mt-4 rounded-lg border border-destructive p-3 text-sm text-destructive">
              {templateCreationError}
            </p>
          ) : null}

          {builtInTemplateDiscovery.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-adam-neutral-700 bg-adam-bg-secondary-dark/70 p-6">
              <div className="flex items-start gap-3">
                <ImageIcon className="mt-0.5 h-5 w-5 shrink-0 text-adam-neutral-500" />
                <div>
                  <h3 className="text-sm font-medium">
                    No built-in product templates yet
                  </h3>
                  <p className="mt-1 max-w-2xl text-sm text-adam-text-tertiary">
                    The template foundation and discovery surface are ready.
                    Product packs will appear here when their canonical BRep
                    definitions are accepted.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {builtInTemplateDiscovery.map((template) => (
                <article
                  key={template.templateId}
                  className="flex min-h-64 flex-col overflow-hidden rounded-xl border border-adam-neutral-700 bg-adam-bg-secondary-dark"
                >
                  <div className="aspect-[16/9] w-full overflow-hidden border-b border-adam-neutral-700 bg-adam-neutral-900">
                    {template.previewUrl ? (
                      <img
                        src={template.previewUrl}
                        alt={`Preview of ${template.name}`}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-adam-neutral-500">
                        <ImageIcon className="h-8 w-8" aria-hidden="true" />
                        <span className="sr-only">
                          No preview image available
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs font-medium text-adam-blue">
                        {template.category}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-adam-neutral-500">
                        v{template.templateVersion}
                      </span>
                    </div>
                    <h3 className="mt-3 font-medium">{template.name}</h3>
                    {template.description ? (
                      <p className="mt-2 text-sm text-adam-text-tertiary">
                        {template.description}
                      </p>
                    ) : null}
                    {template.supportedUse ? (
                      <div className="mt-3">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-adam-neutral-500">
                          Supported use
                        </p>
                        <p className="mt-1 text-xs text-adam-text-tertiary">
                          {template.supportedUse}
                        </p>
                      </div>
                    ) : null}
                    {template.importantParameters.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {template.importantParameters.map((parameter) => {
                          const unit = parameter.unitLabel ?? parameter.unit;
                          return (
                            <span
                              key={parameter.id}
                              className="rounded-full border border-adam-neutral-700 px-2 py-1 text-[11px] text-adam-text-tertiary"
                            >
                              {parameter.label}
                              {unit ? ` · ${unit}` : ''}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                    <div className="mt-auto pt-4">
                      <Button
                        type="button"
                        className="w-full"
                        disabled={Boolean(creatingTemplateKey) || !user?.id}
                        onClick={() => void createFromTemplate(template)}
                      >
                        {creatingTemplateKey ===
                        `${template.templateId}@${template.templateVersion}`
                          ? 'Creating…'
                          : 'Create project'}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mt-10" aria-label="Saved BRep models">
          <h2 className="text-lg font-semibold">Saved models</h2>
          {isLoading ? (
            <div className="mt-4 rounded-xl border border-adam-neutral-700 bg-adam-bg-secondary-dark p-6 text-sm text-adam-text-tertiary">
              Loading saved BRep models…
            </div>
          ) : models.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-adam-neutral-700 bg-adam-bg-secondary-dark/70 p-8 text-center">
              <Box className="mx-auto h-8 w-8 text-adam-neutral-500" />
              <h3 className="mt-3 text-base font-medium">
                No saved BRep models yet
              </h3>
              <p className="mx-auto mt-2 max-w-lg text-sm text-adam-text-tertiary">
                Start a Native BRep creation from the home prompt, or import an
                existing Brepia BRep package. The resulting model will appear
                here automatically.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {models.map((conversation) => (
                <button
                  type="button"
                  key={conversation.id}
                  onClick={() =>
                    void navigate({
                      to: '/brep/$id',
                      params: { id: conversation.id },
                    })
                  }
                  className="hover:border-adam-neutral-600 group flex min-h-32 flex-col rounded-xl border border-adam-neutral-700 bg-adam-bg-secondary-dark p-4 text-left transition-colors hover:bg-adam-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue"
                >
                  <div className="flex w-full items-start justify-between gap-3">
                    <Box className="mt-0.5 h-5 w-5 shrink-0 text-adam-blue" />
                    <span className="text-[10px] uppercase tracking-wide text-adam-neutral-500">
                      Native BRep
                    </span>
                  </div>
                  <span className="mt-4 line-clamp-2 font-medium text-adam-text-primary">
                    {conversation.title || 'Untitled BRep model'}
                  </span>
                  <span className="mt-auto pt-3 text-xs text-adam-text-tertiary">
                    {updatedLabel(conversation)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
