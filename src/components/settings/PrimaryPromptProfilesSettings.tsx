import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Check,
  Copy,
  Loader2,
  Pencil,
  Plus,
  Save,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiJson } from '@/services/api';

type PromptScope = 'parametric' | 'creative';
type PromptMode = 'overlay' | 'fork';

type PromptProfile = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  promptTemplate?: string;
  mode: PromptMode;
  scope: PromptScope;
  fingerprint: string | null;
  editable: boolean;
  deletable: boolean;
  baseRevision: string | null;
  archived: boolean;
};

type Preferences = {
  defaultPromptProfileId: string | null;
  defaultCreativePromptProfileId: string | null;
};

type Draft = {
  id: string | null;
  name: string;
  description: string;
  promptTemplate: string;
  mode: PromptMode;
  baseRevision: string | null;
};

type Props = {
  scope: PromptScope;
};

const CONFIG = {
  parametric: {
    title: 'Generative prompt',
    description:
      'Instructions used by the Generative/Parametric CAD agent. The bundled Brepia template is stored in the repository and can be copied into an editable profile.',
    bundledId: 'builtin:parametric',
    defaultField: 'defaultPromptProfileId' as const,
    newName: 'My Generative prompt',
  },
  creative: {
    title: 'Creative prompt',
    description:
      'Instructions used by the Creative mesh agent. The bundled template is stored in the repository and can be copied into an editable profile.',
    bundledId: 'builtin:creative',
    defaultField: 'defaultCreativePromptProfileId' as const,
    newName: 'My Creative prompt',
  },
};

async function fetchProfiles(scope: PromptScope): Promise<PromptProfile[]> {
  return apiJson(
    `ai-settings/profiles?scope=${encodeURIComponent(scope)}`,
  ) as Promise<PromptProfile[]>;
}

async function fetchProfile(id: string): Promise<PromptProfile> {
  return apiJson(`ai-settings/profiles/${id}`) as Promise<PromptProfile>;
}

async function fetchPreferences(): Promise<Preferences> {
  return apiJson('ai-settings/preferences') as Promise<Preferences>;
}

function modeLabel(profile: PromptProfile): string {
  if (!profile.editable) return 'Bundled template';
  return profile.mode === 'fork' ? 'Replace' : 'Overlay';
}

function effectivePrompt(
  selected: PromptProfile,
  bundled: PromptProfile | null,
): string {
  if (!selected.promptTemplate) return '';
  if (!selected.editable || selected.mode === 'fork') {
    return selected.promptTemplate;
  }
  if (!bundled?.promptTemplate) return selected.promptTemplate;
  return `${bundled.promptTemplate}\n\n--- User Custom Instructions ---\n\n${selected.promptTemplate}`;
}

export function PrimaryPromptProfilesSettings({ scope }: Props) {
  const config = CONFIG[scope];
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(config.bundledId);
  const [draft, setDraft] = useState<Draft | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['prompt-profiles', scope],
    queryFn: () => fetchProfiles(scope),
    staleTime: 0,
  });
  const preferencesQuery = useQuery({
    queryKey: ['ai-preferences'],
    queryFn: fetchPreferences,
    staleTime: 0,
  });
  const selectedQuery = useQuery({
    queryKey: ['prompt-profile', scope, selectedId],
    queryFn: () => fetchProfile(selectedId),
    enabled: Boolean(selectedId),
    staleTime: 0,
  });
  const bundledQuery = useQuery({
    queryKey: ['prompt-profile', scope, config.bundledId],
    queryFn: () => fetchProfile(config.bundledId),
    staleTime: 0,
  });

  const profiles = useMemo(
    () => profilesQuery.data ?? [],
    [profilesQuery.data],
  );
  const selected = selectedQuery.data ?? null;
  const bundled = bundledQuery.data ?? null;
  const defaultId = preferencesQuery.data?.[config.defaultField] ?? null;

  useEffect(() => {
    if (profiles.length === 0) return;
    if (!profiles.some((profile) => profile.id === selectedId)) {
      setSelectedId(config.bundledId);
      setDraft(null);
    }
  }, [config.bundledId, profiles, selectedId]);

  const selectedIsDefault = selected
    ? selected.editable
      ? selected.id === defaultId
      : defaultId === null
    : false;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['prompt-profiles', scope] }),
      queryClient.invalidateQueries({ queryKey: ['prompt-profile', scope] }),
      queryClient.invalidateQueries({ queryKey: ['ai-preferences'] }),
    ]);
  };

  const defaultMutation = useMutation({
    mutationFn: (profileId: string) =>
      apiJson('ai-settings/preferences', {
        method: 'PUT',
        body: JSON.stringify({ [config.defaultField]: profileId }),
      }),
    onSuccess: async () => {
      await invalidate();
      toast({
        title: 'Prompt default updated',
        description: 'New conversations will use this profile.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to set prompt default.',
        variant: 'destructive',
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (next: Draft) => {
      if (!next.name.trim() || !next.promptTemplate.trim()) {
        throw new Error('Name and prompt are required.');
      }

      if (next.id) {
        return apiJson(`ai-settings/profiles/${next.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: next.name.trim(),
            description: next.description.trim() || null,
            promptTemplate: next.promptTemplate,
          }),
        }) as Promise<PromptProfile>;
      }

      return apiJson('ai-settings/profiles', {
        method: 'POST',
        body: JSON.stringify({
          name: next.name.trim(),
          description: next.description.trim() || null,
          promptTemplate: next.promptTemplate,
          mode: next.mode,
          scope,
          baseRevision: next.baseRevision,
        }),
      }) as Promise<PromptProfile>;
    },
    onSuccess: async (profile) => {
      setSelectedId(profile.id);
      setDraft(null);
      await invalidate();
      toast({
        title: 'Prompt saved',
        description: 'The profile is ready to use.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to save prompt.',
        variant: 'destructive',
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (profile: PromptProfile) => {
      await apiJson(`ai-settings/profiles/${profile.id}`, { method: 'DELETE' });
    },
    onSuccess: async () => {
      setSelectedId(config.bundledId);
      setDraft(null);
      await invalidate();
      toast({ title: 'Profile archived' });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to archive prompt.',
        variant: 'destructive',
      });
    },
  });

  const beginNew = (mode: PromptMode) => {
    setDraft({
      id: null,
      name: config.newName,
      description: '',
      promptTemplate: '',
      mode,
      baseRevision: mode === 'fork' ? (bundled?.fingerprint ?? null) : null,
    });
  };

  const beginEdit = () => {
    if (!selected?.editable || !selected.promptTemplate) return;
    setDraft({
      id: selected.id,
      name: selected.name,
      description: selected.description ?? '',
      promptTemplate: selected.promptTemplate,
      mode: selected.mode,
      baseRevision: selected.baseRevision,
    });
  };

  const beginCopy = () => {
    if (!selected) return;
    const promptTemplate = effectivePrompt(selected, bundled);
    if (!promptTemplate) return;
    setDraft({
      id: null,
      name: `${selected.name} copy`,
      description: selected.description ?? '',
      promptTemplate,
      mode: 'fork',
      baseRevision: bundled?.fingerprint ?? null,
    });
  };

  const isLoading =
    profilesQuery.isLoading ||
    preferencesQuery.isLoading ||
    selectedQuery.isLoading ||
    bundledQuery.isLoading;

  const selectedPromptLabel = useMemo(() => {
    if (!selected) return 'Prompt';
    if (!selected.editable) return 'Bundled repository template';
    return selected.mode === 'fork'
      ? 'Full replacement prompt'
      : 'Overlay instructions';
  }, [selected]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-adam-neutral-400" />
      </div>
    );
  }

  if (profilesQuery.error || preferencesQuery.error || selectedQuery.error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">
        Failed to load prompt settings.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-adam-neutral-50">
          {config.title}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-adam-neutral-400">
          {config.description}
        </p>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-2 rounded-xl border border-adam-neutral-800 bg-adam-background-1 p-2">
          {profiles.map((profile) => {
            const active = profile.id === selectedId;
            const isDefault = profile.editable
              ? profile.id === defaultId
              : defaultId === null;
            return (
              <button
                type="button"
                key={profile.id}
                onClick={() => {
                  setSelectedId(profile.id);
                  setDraft(null);
                }}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  active
                    ? 'border-adam-blue/40 bg-adam-blue/5'
                    : 'border-transparent hover:bg-adam-neutral-800/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-adam-neutral-100">
                    {profile.name}
                  </span>
                  {isDefault ? (
                    <Badge
                      variant="outline"
                      className="border-adam-blue/30 bg-adam-blue/10 text-[10px] text-adam-blue"
                    >
                      Default
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 text-[11px] text-adam-neutral-400">
                  {modeLabel(profile)}
                </div>
              </button>
            );
          })}

          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => beginNew('fork')}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => beginNew('overlay')}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Overlay
            </Button>
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-adam-neutral-800 bg-adam-background-1 p-4">
          {draft ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-medium text-adam-neutral-50">
                    {draft.id ? 'Edit profile' : 'New profile'}
                  </h4>
                  <p className="mt-1 text-xs text-adam-neutral-400">
                    {draft.mode === 'fork'
                      ? 'Replace uses this prompt as the complete instruction.'
                      : 'Overlay appends these instructions to the bundled template.'}
                  </p>
                </div>
                <Badge variant="outline">
                  {draft.mode === 'fork' ? 'Replace' : 'Overlay'}
                </Badge>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-adam-neutral-300">Name</label>
                <Input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, name: event.target.value }
                        : current,
                    )
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-adam-neutral-300">
                  Description
                </label>
                <Input
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, description: event.target.value }
                        : current,
                    )
                  }
                  placeholder="Optional description"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-adam-neutral-300">
                  {draft.mode === 'fork'
                    ? 'Full replacement prompt'
                    : 'Overlay instructions'}
                </label>
                <Textarea
                  value={draft.promptTemplate}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, promptTemplate: event.target.value }
                        : current,
                    )
                  }
                  className="min-h-72 font-mono text-xs"
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDraft(null)}
                  disabled={saveMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => saveMutation.mutate(draft)}
                  disabled={
                    saveMutation.isPending ||
                    !draft.name.trim() ||
                    !draft.promptTemplate.trim()
                  }
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          ) : selected ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-medium text-adam-neutral-50">
                      {selected.name}
                    </h4>
                    <Badge variant="outline">{modeLabel(selected)}</Badge>
                    {selectedIsDefault ? (
                      <Badge className="bg-adam-blue/10 text-adam-blue">
                        <Check className="mr-1 h-3 w-3" />
                        Default
                      </Badge>
                    ) : null}
                  </div>
                  {selected.description ? (
                    <p className="mt-1 text-xs text-adam-neutral-400">
                      {selected.description}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {selected.editable && !selectedIsDefault ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => defaultMutation.mutate(selected.id)}
                      disabled={defaultMutation.isPending}
                    >
                      Set default
                    </Button>
                  ) : null}
                  {selected.editable ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={beginEdit}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={beginCopy}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    Copy
                  </Button>
                  {selected.deletable && !selectedIsDefault ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => archiveMutation.mutate(selected)}
                      disabled={archiveMutation.isPending}
                    >
                      <Archive className="mr-1 h-3.5 w-3.5" />
                      Archive
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-adam-neutral-300">
                  {selectedPromptLabel}
                </label>
                <Textarea
                  readOnly
                  value={selected.promptTemplate ?? ''}
                  className="min-h-72 font-mono text-xs"
                />
              </div>

              {!selected.editable && defaultId !== null ? (
                <p className="text-xs text-adam-neutral-400">
                  This bundled template is a repository reference. To use its
                  text again, copy it into a profile and set that profile as
                  default.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
