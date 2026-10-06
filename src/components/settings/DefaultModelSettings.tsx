import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator } from '@/components/brand';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useParametricModelCatalog } from '@/hooks/useParametricModelCatalog';
import { CREATIVE_MODELS } from '@/lib/utils';
import {
  getAiPreferences,
  updateDefaultModelPreferences,
  updateModelRoutingPreferences,
} from '@/services/aiPreferencesService';
import { NATIVE_CREATIVE_MESH_MODEL_ID } from '@shared/creativeMeshModels';
import { getUsableLocalCreativeProfiles } from '@shared/modelRouting';

const AUTOMATIC_VALUE = '__automatic__';

export function DefaultModelSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const {
    models: parametricModels,
    isLoading: isCatalogLoading,
    error: catalogError,
  } = useParametricModelCatalog();
  const {
    data: preferences,
    isLoading: isPreferencesLoading,
    error: preferencesError,
  } = useQuery({
    queryKey: ['ai-preferences', 'defaults'],
    queryFn: getAiPreferences,
    staleTime: 0,
  });

  const mutation = useMutation({
    mutationFn: updateDefaultModelPreferences,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-preferences'] });
      toast({
        title: 'Default model saved',
        description: 'New conversations will use your selected default model.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save the default model.',
        variant: 'destructive',
      });
    },
  });

  const localProfileMutation = useMutation({
    mutationFn: updateModelRoutingPreferences,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-preferences'] });
      toast({
        title: 'Default Creative profile saved',
        description: 'The selected local runtime profile is now active.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not save Creative profile',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const selectableParametricIds = useMemo(
    () => new Set(parametricModels.map((model) => model.id)),
    [parametricModels],
  );

  const savedParametricId = preferences?.defaultParametricModelId ?? null;
  const parametricDefaultUnavailable = Boolean(
    savedParametricId && !selectableParametricIds.has(savedParametricId),
  );
  const parametricValue =
    savedParametricId && selectableParametricIds.has(savedParametricId)
      ? savedParametricId
      : AUTOMATIC_VALUE;

  const creativeIds = useMemo(
    () => new Set<string>(CREATIVE_MODELS.map((model) => model.id)),
    [],
  );
  const savedCreativeId = preferences?.defaultCreativeModelId ?? null;
  const creativeDefaultUnavailable = Boolean(
    savedCreativeId && !creativeIds.has(savedCreativeId),
  );
  const creativeValue =
    savedCreativeId && creativeIds.has(savedCreativeId)
      ? savedCreativeId
      : AUTOMATIC_VALUE;

  const resolvedCreativeBackend =
    creativeValue === AUTOMATIC_VALUE ? CREATIVE_MODELS[0]?.id : creativeValue;
  const localCreativeProfiles = useMemo(
    () =>
      preferences
        ? getUsableLocalCreativeProfiles(preferences.modelRouting)
        : [],
    [preferences],
  );
  const savedLocalProfileId =
    preferences?.modelRouting.defaultLocalCreativeProfileId ?? null;
  const selectedLocalProfile = savedLocalProfileId
    ? localCreativeProfiles.find(
        (profile) => profile.id === savedLocalProfileId,
      )
    : undefined;

  const isLoading = isCatalogLoading || isPreferencesLoading;
  const error =
    catalogError ??
    (preferencesError instanceof Error ? preferencesError.message : null);

  return (
    <section className="mb-4 rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-4 sm:p-6">
      <div className="mb-5">
        <h2 className="text-sm font-medium text-adam-neutral-50">
          Default models
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-adam-neutral-400">
          Choose which model is preselected when you start a new Parametric or
          Creative conversation. Local Creative uses a named runtime profile so
          its concrete models stay visible and editable.
        </p>
      </div>

      {error ? (
        <div className="text-adam-red-400 text-sm">
          Failed to load default model settings: {error}
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-6">
          <ActivityIndicator label="Loading default models" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <div>
              <div className="text-sm text-adam-neutral-50">Parametric</div>
              <div className="mt-0.5 text-xs text-adam-neutral-400">
                OpenSCAD / CAD generation model
              </div>
            </div>
            <Select
              value={parametricValue}
              disabled={mutation.isPending || parametricModels.length === 0}
              onValueChange={(value) =>
                mutation.mutate({
                  defaultParametricModelId:
                    value === AUTOMATIC_VALUE ? null : value,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select default model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTOMATIC_VALUE}>
                  Automatic first available
                </SelectItem>
                {parametricModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {parametricDefaultUnavailable ? (
              <p className="text-adam-amber text-xs leading-relaxed">
                The saved Parametric default is currently hidden or unavailable.
                Brepia will use the first available model until you select
                another one.
              </p>
            ) : null}
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-sm text-adam-neutral-50">Creative</div>
              <div className="mt-0.5 text-xs text-adam-neutral-400">
                Mesh generation backend
              </div>
            </div>
            <Select
              value={creativeValue}
              disabled={mutation.isPending || CREATIVE_MODELS.length === 0}
              onValueChange={(value) =>
                mutation.mutate({
                  defaultCreativeModelId:
                    value === AUTOMATIC_VALUE ? null : value,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select default model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTOMATIC_VALUE}>
                  Automatic first available
                </SelectItem>
                {CREATIVE_MODELS.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name} · {model.provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {creativeDefaultUnavailable ? (
              <p className="text-adam-amber text-xs leading-relaxed">
                The saved Creative default is currently unavailable. Brepia will
                use the first available Creative backend until you select
                another one.
              </p>
            ) : null}

            {resolvedCreativeBackend === NATIVE_CREATIVE_MESH_MODEL_ID ? (
              <div className="rounded-lg border border-adam-neutral-800 bg-adam-background-1/40 p-3">
                <div className="text-xs font-medium text-adam-neutral-100">
                  Local Creative profile
                </div>
                <p className="mt-1 text-xs leading-relaxed text-adam-neutral-400">
                  Select the concrete local image/mesh runtime profile used by
                  Local Creative.
                </p>
                {localCreativeProfiles.length > 0 ? (
                  <>
                    <Select
                      value={selectedLocalProfile?.id}
                      disabled={localProfileMutation.isPending}
                      onValueChange={(profileId) => {
                        const profile = localCreativeProfiles.find(
                          (item) => item.id === profileId,
                        );
                        if (!profile) return;
                        localProfileMutation.mutate({
                          defaultLocalCreativeProfileId: profile.id,
                          nativeImageModelId: profile.imageModelId,
                          nativeMeshModelId: profile.meshModelId,
                        });
                      }}
                    >
                      <SelectTrigger className="mt-2 w-full">
                        <SelectValue placeholder="Select Local Creative profile" />
                      </SelectTrigger>
                      <SelectContent>
                        {localCreativeProfiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.name} · {profile.meshModelId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!selectedLocalProfile ? (
                      <p className="text-adam-amber mt-2 text-xs">
                        Choose a Local Creative profile to activate its runtime
                        models and per-profile generation settings.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-adam-amber mt-2 text-xs">
                    No usable Local Creative profile is configured. Add one
                    under Advanced → Creative models.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
