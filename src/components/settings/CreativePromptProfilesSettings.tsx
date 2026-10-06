import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Check, Copy, Loader2, Plus, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiJson } from '@/services/api';

const BUILTIN_ID = 'builtin:creative';

type PromptMode = 'overlay' | 'fork';

type CreativeProfile = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  promptTemplate?: string;
  mode: PromptMode;
  scope: 'creative';
  fingerprint: string | null;
  editable: boolean;
  deletable: boolean;
  baseRevision: string | null;
  archived: boolean;
};

type Preferences = {
  defaultCreativePromptProfileId: string | null;
};

type EditorDraft = {
  id: string | null;
  name: string;
  description: string;
  promptTemplate: string;
  mode: PromptMode;
  baseRevision: string | null;
};

async function fetchProfiles(): Promise<CreativeProfile[]> {
  return apiJson('ai-settings/profiles?scope=creative') as Promise<
    CreativeProfile[]
  >;
}

async function fetchProfile(id: string): Promise<CreativeProfile> {
  return apiJson(`ai-settings/profiles/${id}`) as Promise<CreativeProfile>;
}

async function fetchPreferences(): Promise<Preferences> {
  return apiJson('ai-settings/preferences') as Promise<Preferences>;
}

export function CreativePromptProfilesSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(BUILTIN_ID);
  const [draft, setDraft] = useState<EditorDraft | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['prompt-profiles', 'creative'],
    queryFn: fetchProfiles,
    staleTime: 0,
  });
  const preferencesQuery = useQuery({
    queryKey: ['ai-preferences'],
    queryFn: fetchPreferences,
    staleTime: 0,
  });
  const selectedQuery = useQuery({
    queryKey: ['prompt-profile', 'creative', selectedId],
    queryFn: () => fetchProfile(selectedId),
    enabled: Boolean(selectedId),
    staleTime: 0,
  });
  const builtinQuery = useQuery({
    queryKey: ['prompt-profile', 'creative', BUILTIN_ID],
    queryFn: () => fetchProfile(BUILTIN_ID),
    staleTime: 0,
  });

  const profiles = useMemo(
    () => profilesQuery.data ?? [],
    [profilesQuery.data],
  );
  const selected = selectedQuery.data ?? null;
  const builtin = builtinQuery.data ?? null;
  const defaultId =
    preferencesQuery.data?.defaultCreativePromptProfileId ?? null;

  useEffect(() => {
    if (profiles.length === 0) return;
    if (!profiles.some((profile) => profile.id === selectedId)) {
      setSelectedId(BUILTIN_ID);
    }
  }, [profiles, selectedId]);

  const selectedIsDefault =
    selectedId === BUILTIN_ID ? defaultId === null : selectedId === defaultId;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['prompt-profiles'] }),
      queryClient.invalidateQueries({ queryKey: ['prompt-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['ai-preferences'] }),
    ]);
  };

  const defaultMutation = useMutation({
    mutationFn: (profileId: string | null) =>
      apiJson('ai-settings/preferences', {
        method: 'PUT',
        body: JSON.stringify({ defaultCreativePromptProfileId: profileId }),
      }),
    onSuccess: async () => {
      await invalidate();
      toast({
        title: 'Creative prompt updated',
        description: 'New Creative conversations will use this prompt profile.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update the Creative prompt default.',
        variant: 'destructive',
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (next: EditorDraft) => {
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
        }) as Promise<CreativeProfile>;
      }

      return apiJson('ai-settings/profiles', {
        method: 'POST',
        body: JSON.stringify({
          name: next.name.trim(),
          description: next.description.trim() || null,
          promptTemplate: next.promptTemplate,
          mode: next.mode,
          scope: 'creative',
          baseRevision: next.baseRevision,
        }),
      }) as Promise<CreativeProfile>;
    },
    onSuccess: async (profile) => {
      setDraft(null);
      setSelectedId(profile.id);
      await invalidate();
      toast({
        title: 'Creative prompt saved',
        description: 'The prompt profile is ready to use.',
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
    mutationFn: (profileId: string) =>
      apiJson(`ai-settings/profiles/${profileId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      if (selectedId === defaultId) {
        await apiJson('ai-settings/preferences', {
          method: 'PUT',
          body: JSON.stringify({ defaultCreativePromptProfileId: null }),
        });
      }
      setSelectedId(BUILTIN_ID);
      setDraft(null);
      await invalidate();
      toast({
        title: 'Profile archived',
        description: 'Creative Original will be used if it was the default.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to archive the Creative prompt profile.',
        variant: 'destructive',
      });
    },
  });

  const startNew = (mode: PromptMode) => {
    setDraft({
      id: null,
      name: '',
      description: '',
      promptTemplate: mode === 'fork' ? (builtin?.promptTemplate ?? '') : '',
      mode,
      baseRevision: mode === 'fork' ? (builtin?.fingerprint ?? null) : null,
    });
  };

  const startEdit = () => {
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

  const duplicateSelected = () => {
    if (!selected?.promptTemplate) return;
    setDraft({
      id: null,
      name: `${selected.name} copy`,
      description: selected.description ?? '',
      promptTemplate: selected.promptTemplate,
      mode: selected.id === BUILTIN_ID ? 'fork' : selected.mode,
      baseRevision:
        selected.id === BUILTIN_ID
          ? (builtin?.fingerprint ?? null)
          : selected.baseRevision,
    });
  };

  const forkIsStale = useMemo(
    () =>
      selected?.mode === 'fork' &&
      Boolean(selected.baseRevision) &&
      Boolean(builtin?.fingerprint) &&
      selected.baseRevision !== builtin?.fingerprint,
    [builtin?.fingerprint, selected],
  );

  const isLoading =
    profilesQuery.isLoading ||
    preferencesQuery.isLoading ||
    selectedQuery.isLoading ||
    builtinQuery.isLoading;

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
        Failed to load Creative prompt settings.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-adam-neutral-50">
          Creative prompt
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-adam-neutral-400">
          Customize the agent instructions used before TRELLIS.2 mesh
          generation. Creative profiles are separate from Generative/Brepia
          profiles.
        </p>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-2 rounded-xl border border-adam-neutral-800 bg-adam-background-1 p-2">
          {profiles.map((profile) => {
            const isActive = profile.id === selectedId;
            const isDefault =
              profile.id === BUILTIN_ID
                ? defaultId === null
                : profile.id === defaultId;
            return (
              <button
                type="button"
                key={profile.id}
                onClick={() => {
                  setSelectedId(profile.id);
                  setDraft(null);
                }}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  isActive
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
                <div className="mt-1 flex items-center gap-2 text-[11px] text-adam-neutral-400">
                  <span>{profile.editable ? profile.mode : 'Built-in'}</span>
                </div>
              </button>
            );
          })}

          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => startNew('overlay')}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Overlay
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => startNew('fork')}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              Fork
            </Button>
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-adam-neutral-800 bg-adam-background-1 p-4">
          {draft ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-medium text-adam-neutral-50">
                    {draft.id
                      ? 'Edit Creative profile'
                      : 'New Creative profile'}
                  </h4>
                  <p className="mt-1 text-xs text-adam-neutral-400">
                    {draft.mode === 'overlay'
                      ? 'Overlay adds these instructions to the current Creative Original prompt.'
                      : 'Fork is a complete independent copy and does not inherit future prompt updates.'}
                  </p>
                </div>
                <Badge variant="outline">{draft.mode}</Badge>
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
                  placeholder="My Creative prompt"
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
                  {draft.mode === 'overlay'
                    ? 'Additional instructions'
                    : 'Full Creative prompt'}
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
                  className="min-h-64 font-mono text-xs"
                  placeholder="Describe how the Creative agent should behave..."
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
                    <Badge variant="outline">
                      {selected.editable ? selected.mode : 'Creative Original'}
                    </Badge>
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
                  {!selectedIsDefault ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        defaultMutation.mutate(
                          selected.id === BUILTIN_ID ? null : selected.id,
                        )
                      }
                      disabled={defaultMutation.isPending}
                    >
                      Set as default
                    </Button>
                  ) : null}
                  {selected.editable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={startEdit}
                    >
                      Edit
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={duplicateSelected}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    Duplicate
                  </Button>
                  {selected.deletable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => archiveMutation.mutate(selected.id)}
                      disabled={archiveMutation.isPending}
                    >
                      <Archive className="mr-1 h-3.5 w-3.5" />
                      Archive
                    </Button>
                  ) : null}
                </div>
              </div>

              {forkIsStale ? (
                <div className="border-adam-amber/30 bg-adam-amber/5 text-adam-amber rounded-lg border p-3 text-xs">
                  This fork was created from an older Creative Original
                  revision. It remains unchanged until you edit it.
                </div>
              ) : null}

              <div className="rounded-lg border border-adam-neutral-800 bg-adam-neutral-950 p-3">
                <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-adam-neutral-300">
                  {selected.promptTemplate ?? ''}
                </pre>
              </div>

              {defaultId !== null && selected.id === BUILTIN_ID ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => defaultMutation.mutate(null)}
                  disabled={defaultMutation.isPending}
                >
                  Restore Creative Original
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
