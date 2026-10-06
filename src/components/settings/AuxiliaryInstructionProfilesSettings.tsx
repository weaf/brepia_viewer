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
import { AI_INSTRUCTION_DEFINITIONS } from '@shared/aiInstructionCatalog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiJson } from '@/services/api';

type PromptMode = 'overlay' | 'fork';

type PromptProfile = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  promptTemplate?: string;
  mode: PromptMode;
  scope: string;
  fingerprint: string | null;
  editable: boolean;
  deletable: boolean;
  baseRevision: string | null;
  archived: boolean;
};

type Preferences = {
  instructionProfileDefaults?: Record<string, string | null>;
};

type Draft = {
  id: string | null;
  name: string;
  description: string;
  promptTemplate: string;
  mode: PromptMode;
  baseRevision: string | null;
};

const DEFINITIONS = AI_INSTRUCTION_DEFINITIONS.filter(
  (definition) =>
    definition.key !== 'parametric' && definition.key !== 'creative',
);

function bundledId(key: string) {
  return `builtin:${key}`;
}

async function fetchProfiles(key: string): Promise<PromptProfile[]> {
  return apiJson(
    `ai-settings/profiles?scope=${encodeURIComponent(key)}`,
  ) as Promise<PromptProfile[]>;
}

async function fetchProfile(id: string): Promise<PromptProfile> {
  return apiJson(`ai-settings/profiles/${id}`) as Promise<PromptProfile>;
}

async function fetchPreferences(): Promise<Preferences> {
  return apiJson('ai-settings/preferences') as Promise<Preferences>;
}

function effectivePrompt(
  selected: PromptProfile,
  bundled: PromptProfile | null,
): string {
  if (!selected.promptTemplate) return '';
  if (!selected.editable || selected.mode === 'fork')
    return selected.promptTemplate;
  if (!bundled?.promptTemplate) return selected.promptTemplate;
  return `${bundled.promptTemplate}\n\n--- User Custom Instructions ---\n\n${selected.promptTemplate}`;
}

export function AuxiliaryInstructionProfilesSettings() {
  const firstKey = DEFINITIONS[0]?.key ?? '';
  const [instructionKey, setInstructionKey] = useState(firstKey);
  const [selectedId, setSelectedId] = useState(() => bundledId(firstKey));
  const [draft, setDraft] = useState<Draft | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const definition = useMemo(
    () => DEFINITIONS.find((entry) => entry.key === instructionKey) ?? null,
    [instructionKey],
  );
  const currentBundledId = bundledId(instructionKey);

  useEffect(() => {
    setSelectedId(currentBundledId);
    setDraft(null);
  }, [currentBundledId]);

  const profilesQuery = useQuery({
    queryKey: ['prompt-profiles', instructionKey],
    queryFn: () => fetchProfiles(instructionKey),
    enabled: Boolean(instructionKey),
    staleTime: 0,
  });
  const preferencesQuery = useQuery({
    queryKey: ['ai-preferences'],
    queryFn: fetchPreferences,
    staleTime: 0,
  });
  const selectedQuery = useQuery({
    queryKey: ['prompt-profile', instructionKey, selectedId],
    queryFn: () => fetchProfile(selectedId),
    enabled: Boolean(selectedId),
    staleTime: 0,
  });
  const bundledQuery = useQuery({
    queryKey: ['prompt-profile', instructionKey, currentBundledId],
    queryFn: () => fetchProfile(currentBundledId),
    enabled: Boolean(instructionKey),
    staleTime: 0,
  });

  const profiles = useMemo(
    () => profilesQuery.data ?? [],
    [profilesQuery.data],
  );
  const selected = selectedQuery.data ?? null;
  const bundled = bundledQuery.data ?? null;
  const defaults = preferencesQuery.data?.instructionProfileDefaults ?? {};
  const defaultId = defaults[instructionKey] ?? null;

  useEffect(() => {
    if (profiles.length === 0) return;
    if (!profiles.some((profile) => profile.id === selectedId)) {
      setSelectedId(currentBundledId);
      setDraft(null);
    }
  }, [currentBundledId, profiles, selectedId]);

  const selectedIsDefault = selected
    ? selected.editable
      ? selected.id === defaultId
      : defaultId === null
    : false;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['prompt-profiles', instructionKey],
      }),
      queryClient.invalidateQueries({
        queryKey: ['prompt-profile', instructionKey],
      }),
      queryClient.invalidateQueries({ queryKey: ['ai-preferences'] }),
    ]);
  };

  const saveDefaultMap = async (next: Record<string, string | null>) => {
    await apiJson('ai-settings/preferences', {
      method: 'PUT',
      body: JSON.stringify({ instructionProfileDefaults: next }),
    });
  };

  const defaultMutation = useMutation({
    mutationFn: async (profileId: string) => {
      await saveDefaultMap({ ...defaults, [instructionKey]: profileId });
    },
    onSuccess: async () => {
      await invalidate();
      toast({
        title: 'Instruction profile activated',
        description: 'New requests will use this instruction profile.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to activate instruction profile.',
        variant: 'destructive',
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (next: Draft) => {
      if (!next.name.trim() || !next.promptTemplate.trim()) {
        throw new Error('Name and instruction are required.');
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
          scope: instructionKey,
          baseRevision: next.baseRevision,
        }),
      }) as Promise<PromptProfile>;
    },
    onSuccess: async (profile) => {
      setSelectedId(profile.id);
      setDraft(null);
      await invalidate();
      toast({ title: 'Instruction profile saved' });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to save instruction.',
        variant: 'destructive',
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (profile: PromptProfile) => {
      await apiJson(`ai-settings/profiles/${profile.id}`, { method: 'DELETE' });
    },
    onSuccess: async () => {
      setSelectedId(currentBundledId);
      setDraft(null);
      await invalidate();
      toast({ title: 'Instruction profile archived' });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to archive instruction.',
        variant: 'destructive',
      });
    },
  });

  const beginNew = (mode: PromptMode) => {
    setDraft({
      id: null,
      name: definition ? `${definition.label} custom` : 'Custom instruction',
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

  if (DEFINITIONS.length === 0) return null;

  const loading =
    profilesQuery.isLoading ||
    preferencesQuery.isLoading ||
    selectedQuery.isLoading ||
    bundledQuery.isLoading;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-adam-neutral-50">
          Additional instructions
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-adam-neutral-400">
          Tool, vision, conversation and injected context instructions. Bundled
          templates come from the repository; custom profiles can overlay or
          fully replace them.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-adam-neutral-300">Instruction</label>
        <select
          value={instructionKey}
          onChange={(event) => setInstructionKey(event.target.value)}
          className="h-10 w-full rounded-md border border-adam-neutral-700 bg-adam-background-1 px-3 text-sm text-adam-neutral-100"
        >
          {DEFINITIONS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
        {definition ? (
          <p className="text-xs text-adam-neutral-400">
            {definition.description}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-adam-neutral-400" />
        </div>
      ) : profilesQuery.error ||
        preferencesQuery.error ||
        selectedQuery.error ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">
          Failed to load instruction profiles.
        </div>
      ) : (
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
                    {!profile.editable
                      ? 'Bundled template'
                      : profile.mode === 'fork'
                        ? 'Replace'
                        : 'Overlay'}
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
                      {draft.id
                        ? 'Edit instruction profile'
                        : 'New instruction profile'}
                    </h4>
                    <p className="mt-1 text-xs text-adam-neutral-400">
                      {draft.mode === 'fork'
                        ? 'Replace uses this as the complete instruction.'
                        : 'Overlay appends this text to the bundled instruction.'}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {draft.mode === 'fork' ? 'Replace' : 'Overlay'}
                  </Badge>
                </div>

                <Input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, name: event.target.value }
                        : current,
                    )
                  }
                  placeholder="Profile name"
                />
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
                />

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDraft(null)}
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
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-medium text-adam-neutral-50">
                        {selected.name}
                      </h4>
                      <Badge variant="outline">
                        {!selected.editable
                          ? 'Bundled template'
                          : selected.mode === 'fork'
                            ? 'Replace'
                            : 'Overlay'}
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

                <Textarea
                  readOnly
                  value={selected.promptTemplate ?? ''}
                  className="min-h-64 font-mono text-xs"
                />

                {!selected.editable && defaultId !== null ? (
                  <p className="text-xs text-adam-neutral-400">
                    This is the repository template. Copy it into a profile if
                    you want to use or modify this text again.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
