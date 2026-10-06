import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useFullParametricModelCatalog } from '@/hooks/useParametricModelCatalog';
import { apiJson } from '@/services/api';
import type { CatalogEntry } from '@/server/modelCatalog';
import { ActivityIndicator } from '@/components/brand';

const NONE_VALUE = '__none__';
const SAME_AS_FAST_VALUE = '__same_as_fast__';

interface VisionPreferences {
  visionFastModelId: string | null;
  visionDeepModelId: string | null;
}

async function fetchPreferences(): Promise<VisionPreferences> {
  const data = (await apiJson('ai-settings/preferences')) as VisionPreferences;
  return {
    visionFastModelId: data.visionFastModelId ?? null,
    visionDeepModelId: data.visionDeepModelId ?? null,
  };
}

function useVisionPreferences() {
  return useQuery({
    queryKey: ['vision-preferences'],
    queryFn: fetchPreferences,
    staleTime: 0,
  });
}

function useSaveVisionPreferences() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (input: VisionPreferences) =>
      apiJson('ai-settings/preferences', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vision-preferences'] });
      queryClient.invalidateQueries({ queryKey: ['ai-preferences'] });
      toast({
        title: 'Vision settings saved',
        description: 'Fast and deep vision routing has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not save vision settings',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

function optionLabel(entry: CatalogEntry): string {
  return entry.provider ? `${entry.name} · ${entry.provider}` : entry.name;
}

function SelectedModelSummary({
  entry,
  emptyText,
}: {
  entry: CatalogEntry | undefined;
  emptyText: string;
}) {
  if (!entry) {
    return <p className="mt-2 text-xs text-adam-neutral-400">{emptyText}</p>;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-adam-neutral-400">
      <span>{entry.description || entry.provider || entry.id}</span>
      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
        Vision
      </Badge>
    </div>
  );
}

export function VisionSettings() {
  const {
    models: catalog,
    isLoading: catalogLoading,
    error: catalogError,
  } = useFullParametricModelCatalog();
  const {
    data: preferences,
    isLoading: preferencesLoading,
    error: preferencesError,
  } = useVisionPreferences();
  const saveMutation = useSaveVisionPreferences();

  const visionModels = useMemo(
    () =>
      catalog
        .filter(
          (entry) => entry.supportsVision && entry.enabled && entry.available,
        )
        .sort((a, b) =>
          optionLabel(a).localeCompare(optionLabel(b), undefined, {
            sensitivity: 'base',
          }),
        ),
    [catalog],
  );

  const byId = useMemo(
    () => new Map(visionModels.map((entry) => [entry.id, entry])),
    [visionModels],
  );

  const fastId = preferences?.visionFastModelId ?? null;
  const deepId = preferences?.visionDeepModelId ?? null;
  const isLoading = catalogLoading || preferencesLoading;

  const save = (next: VisionPreferences) => saveMutation.mutate(next);

  if (isLoading) {
    return (
      <div className="py-6 text-sm text-adam-neutral-400">
        <ActivityIndicator label="Loading vision models…" showLabel size="sm" />
      </div>
    );
  }

  if (catalogError || preferencesError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load vision settings.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-medium text-adam-neutral-50">
          Vision fallback
        </h3>
        <p className="mt-1 max-w-3xl text-sm text-adam-neutral-400">
          Native multimodal models receive images directly. These models are
          only used when the selected primary model or transport cannot accept
          images. Models appear here when they are marked with the Vision
          capability in the model catalog.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-adam-neutral-700 bg-adam-background-2 p-4">
          <div className="mb-3">
            <div className="text-sm font-medium text-adam-neutral-50">
              Fast vision model
            </div>
            <div className="mt-1 text-xs text-adam-neutral-400">
              Used for user reference images and normal visual understanding.
            </div>
          </div>
          <Select
            value={fastId ?? NONE_VALUE}
            disabled={saveMutation.isPending}
            onValueChange={(value) =>
              save({
                visionFastModelId: value === NONE_VALUE ? null : value,
                visionDeepModelId: deepId,
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a vision model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>Not configured</SelectItem>
              {visionModels.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {optionLabel(entry)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SelectedModelSummary
            entry={fastId ? byId.get(fastId) : undefined}
            emptyText="Text-only models cannot inspect reference images until a Fast vision model is selected."
          />
        </div>

        <div className="rounded-lg border border-adam-neutral-700 bg-adam-background-2 p-4">
          <div className="mb-3">
            <div className="text-sm font-medium text-adam-neutral-50">
              Deep vision model
            </div>
            <div className="mt-1 text-xs text-adam-neutral-400">
              Used for rendered multi-view CAD inspection. Leave it on Fast to
              reuse the same model for both jobs.
            </div>
          </div>
          <Select
            value={deepId ?? SAME_AS_FAST_VALUE}
            disabled={saveMutation.isPending}
            onValueChange={(value) =>
              save({
                visionFastModelId: fastId,
                visionDeepModelId: value === SAME_AS_FAST_VALUE ? null : value,
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a deep vision model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SAME_AS_FAST_VALUE}>Same as Fast</SelectItem>
              {visionModels.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {optionLabel(entry)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SelectedModelSummary
            entry={
              deepId ? byId.get(deepId) : fastId ? byId.get(fastId) : undefined
            }
            emptyText="Deep inspection also needs a Fast model when no separate Deep model is selected."
          />
        </div>
      </div>

      {visionModels.length === 0 ? (
        <div className="rounded-lg border border-adam-neutral-700 bg-adam-neutral-900/40 p-4 text-sm text-adam-neutral-300">
          No available models are marked as Vision. Add or edit a model under
          Providers, enable its Vision capability, and configure that
          provider&apos;s Base URL and credential there.
        </div>
      ) : (
        <p className="text-xs text-adam-neutral-500">
          Hidden models remain available here, so dedicated vision helper models
          do not need to appear in the normal model picker.
        </p>
      )}
    </div>
  );
}
