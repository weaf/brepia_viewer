// P03G: Model settings UI — AiModelsSettings section.
//
// Renders a searchable, filterable model visibility panel in SettingsView.
// Users can show/hide individual models, bulk-edit the current result set,
// group models by their effective runtime/provider, and restore defaults.
// Dynamically discovered OpenCode models are opt-in; other model sources keep
// the existing hidden-model preference semantics.

import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ActivityIndicator } from '@/components/brand';
import {
  ChevronDown,
  EyeOff,
  RotateCcw,
  Search,
  SquareCheck,
  X,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFullParametricModelCatalog } from '@/hooks/useParametricModelCatalog';
import { apiJson } from '@/services/api';
import type { CatalogEntry } from '@/server/modelCatalog';

type VisibilityFilter = 'all' | 'visible' | 'hidden';
type SourceFilter =
  'all' | 'builtin' | 'local' | 'opencode' | 'codex' | 'custom';
type CapabilityFilter = 'tools' | 'thinking' | 'vision';

type ModelGroup = {
  key: string;
  label: string;
  detail?: string;
  models: CatalogEntry[];
};

interface AiPreferences {
  hiddenModelIds: string[];
  enabledOpenCodeModelIds: string[];
}

interface ModelVisibilityUpdate {
  hiddenModelIds?: string[];
  enabledOpenCodeModelIds?: string[];
}

const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'builtin', label: 'Built-in' },
  { value: 'local', label: 'Local' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'codex', label: 'Codex' },
  { value: 'custom', label: 'Custom' },
];

const VISIBILITY_FILTERS: { value: VisibilityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'visible', label: 'Enabled' },
  { value: 'hidden', label: 'Hidden' },
];

const CAPABILITY_FILTERS: { value: CapabilityFilter; label: string }[] = [
  { value: 'tools', label: 'Tools' },
  { value: 'thinking', label: 'Thinking' },
  { value: 'vision', label: 'Vision' },
];

function isCodexEntry(entry: CatalogEntry): boolean {
  return entry.source === 'opencode' && entry.id.startsWith('agent/codex/');
}

function isOpenCodeEntry(entry: CatalogEntry): boolean {
  return entry.source === 'opencode' && !isCodexEntry(entry);
}

function isDynamicOpenCodeModelId(modelId: string): boolean {
  return modelId.startsWith('agent/opencode/');
}

function isDynamicOpenCodeEntry(entry: CatalogEntry): boolean {
  return isDynamicOpenCodeModelId(entry.id);
}

function entrySource(entry: CatalogEntry): Exclude<SourceFilter, 'all'> {
  if (isCodexEntry(entry)) return 'codex';
  if (entry.source === 'opencode') return 'opencode';
  return entry.source;
}

function providerFromModelId(entry: CatalogEntry): string | undefined {
  if (entry.source === 'builtin') {
    const slash = entry.id.indexOf('/');
    if (slash > 0) return entry.id.slice(0, slash);
  }

  if (isOpenCodeEntry(entry)) {
    const prefix = 'agent/opencode/';
    if (entry.id.startsWith(prefix)) {
      const rest = entry.id.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash > 0) return rest.slice(0, slash);
    }
  }

  return undefined;
}

function sentenceCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function openCodeRuntime(entry: CatalogEntry): string {
  const match = /^OpenCode agent via (.+)$/i.exec(entry.description ?? '');
  return match?.[1] ?? providerFromModelId(entry) ?? 'OpenCode';
}

function groupForEntry(entry: CatalogEntry): Omit<ModelGroup, 'models'> {
  if (isCodexEntry(entry)) {
    return {
      key: 'codex',
      label: 'Codex',
      detail: 'Local Codex CLI models',
    };
  }

  if (isOpenCodeEntry(entry)) {
    const runtime = openCodeRuntime(entry);
    return {
      key: `opencode:${runtime.toLowerCase()}`,
      label: `OpenCode · ${runtime}`,
      detail: 'OpenCode agent runtime',
    };
  }

  if (entry.source === 'local') {
    return {
      key: 'local:openai-compatible',
      label: entry.provider || 'Local OpenAI / llama-swap',
      detail: 'Runtime-discovered local models',
    };
  }

  if (entry.source === 'custom') {
    const provider = entry.provider || 'Custom provider';
    return {
      key: `custom:${provider.toLowerCase()}`,
      label: provider,
      detail: 'Custom provider',
    };
  }

  const provider = entry.provider || providerFromModelId(entry) || 'Built-in';
  return {
    key: `builtin:${provider.toLowerCase()}`,
    label: sentenceCase(provider),
    detail: 'Built-in provider',
  };
}

function groupModels(models: CatalogEntry[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();

  for (const entry of models) {
    const meta = groupForEntry(entry);
    const existing = groups.get(meta.key);
    if (existing) existing.models.push(entry);
    else groups.set(meta.key, { ...meta, models: [entry] });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      models: [...group.models].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    );
}

function modelMatchesSearch(entry: CatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const group = groupForEntry(entry);
  const haystack = [
    entry.id,
    entry.name,
    entry.description,
    entry.provider,
    group.label,
    group.detail,
    isOpenCodeEntry(entry) ? openCodeRuntime(entry) : undefined,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(q);
}

function supportsCapability(
  entry: CatalogEntry,
  capability: CapabilityFilter,
): boolean {
  if (capability === 'tools') return Boolean(entry.supportsTools);
  if (capability === 'thinking') return Boolean(entry.supportsThinking);
  return Boolean(entry.supportsVision);
}

function displayModelName(entry: CatalogEntry): string {
  if (isOpenCodeEntry(entry)) return entry.name.replace(/^OpenCode · /, '');
  return entry.name;
}

function sourceBadgeLabel(entry: CatalogEntry): string {
  if (isCodexEntry(entry)) return 'Codex';
  if (isOpenCodeEntry(entry)) return 'OpenCode';
  if (entry.source === 'local') return 'Local';
  return entry.source === 'builtin' ? 'Built-in' : 'Custom';
}

function modelOriginText(entry: CatalogEntry): string | undefined {
  if (isOpenCodeEntry(entry)) return `via ${openCodeRuntime(entry)}`;
  if (isCodexEntry(entry)) return entry.description || 'Codex CLI';
  return entry.provider || entry.description || undefined;
}

async function fetchPreferences(): Promise<AiPreferences> {
  const data = (await apiJson('ai-settings/preferences')) as Partial<AiPreferences>;
  return {
    hiddenModelIds: data.hiddenModelIds ?? [],
    enabledOpenCodeModelIds: data.enabledOpenCodeModelIds ?? [],
  };
}

function useAiPreferences() {
  return useQuery({
    queryKey: ['ai-preferences'],
    queryFn: fetchPreferences,
    staleTime: 0,
  });
}

function useUpdateModelVisibility() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (update: ModelVisibilityUpdate) =>
      apiJson('ai-settings/preferences', {
        method: 'PUT',
        body: JSON.stringify(update),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-preferences'] });
      toast({
        title: 'Model preferences saved',
        description: 'Your model visibility settings have been updated.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save model preferences.',
        variant: 'destructive',
      });
    },
  });
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'light' : 'dark'}
      aria-pressed={active}
      onClick={onClick}
      className="h-7 rounded-full px-2.5 text-xs"
    >
      {children}
    </Button>
  );
}

function ModelRow({
  entry,
  isHidden,
  onToggle,
  isUpdating,
}: {
  entry: CatalogEntry;
  isHidden: boolean;
  onToggle: () => void;
  isUpdating: boolean;
}) {
  const source = entrySource(entry);
  const origin = modelOriginText(entry);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-lg px-3 py-3 transition-colors hover:bg-adam-neutral-800/40">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
          <span
            className={`min-w-0 break-words text-sm leading-snug sm:truncate ${
              isHidden
                ? 'text-adam-neutral-400 line-through'
                : 'text-adam-neutral-50'
            }`}
          >
            {displayModelName(entry)}
          </span>
          <Badge
            variant={
              source === 'builtin'
                ? 'default'
                : source === 'custom'
                  ? 'outline'
                  : 'secondary'
            }
            className={
              source === 'builtin'
                ? 'shrink-0 bg-adam-blue/15 text-adam-blue hover:bg-adam-blue/20'
                : source === 'local'
                  ? 'bg-adam-emerald/15 text-adam-emerald hover:bg-adam-emerald/20 shrink-0'
                  : source === 'opencode'
                    ? 'bg-adam-amber/15 text-adam-amber hover:bg-adam-amber/20 shrink-0'
                    : source === 'codex'
                      ? 'shrink-0 bg-adam-neutral-700 text-adam-neutral-200 hover:bg-adam-neutral-700'
                      : 'shrink-0'
            }
          >
            {sourceBadgeLabel(entry)}
          </Badge>
        </div>

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          {origin ? (
            <span className="min-w-0 break-words text-xs text-adam-neutral-400">
              {origin}
            </span>
          ) : null}
          {entry.supportsTools && (
            <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
              Tools
            </Badge>
          )}
          {entry.supportsThinking && (
            <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
              Thinking
            </Badge>
          )}
          {entry.supportsVision && (
            <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
              Vision
            </Badge>
          )}
        </div>

        {isHidden && entry.unavailableReason && (
          <div className="mt-1 break-words text-xs text-adam-neutral-500">
            {entry.unavailableReason}
          </div>
        )}
      </div>

      <Switch
        className="mt-0.5 shrink-0"
        checked={!isHidden}
        onCheckedChange={onToggle}
        disabled={isUpdating || !entry.enabled}
      />
    </div>
  );
}

export function AiModelsSettings() {
  const {
    models: allEntries = [],
    isLoading: isCatalogLoading,
    error: catalogError,
  } = useFullParametricModelCatalog();
  const {
    data: prefs,
    isLoading: isPrefsLoading,
    error: prefsError,
  } = useAiPreferences();

  const hiddenIds = useMemo(
    () => prefs?.hiddenModelIds ?? [],
    [prefs?.hiddenModelIds],
  );
  const enabledOpenCodeIds = useMemo(
    () => prefs?.enabledOpenCodeModelIds ?? [],
    [prefs?.enabledOpenCodeModelIds],
  );
  const enabledOpenCodeSet = useMemo(
    () => new Set(enabledOpenCodeIds),
    [enabledOpenCodeIds],
  );
  const hiddenSet = useMemo(() => {
    const effective = new Set(
      hiddenIds.filter((modelId) => !isDynamicOpenCodeModelId(modelId)),
    );
    for (const entry of allEntries) {
      if (
        isDynamicOpenCodeEntry(entry) &&
        !enabledOpenCodeSet.has(entry.id)
      ) {
        effective.add(entry.id);
      }
    }
    return effective;
  }, [allEntries, enabledOpenCodeSet, hiddenIds]);
  const updateMutation = useUpdateModelVisibility();

  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] =
    useState<VisibilityFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [capabilityFilters, setCapabilityFilters] = useState<
    CapabilityFilter[]
  >([]);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);

  const filteredEntries = useMemo(
    () =>
      allEntries.filter((entry) => {
        if (!modelMatchesSearch(entry, searchQuery)) return false;
        if (sourceFilter !== 'all' && entrySource(entry) !== sourceFilter)
          return false;

        const hidden = hiddenSet.has(entry.id);
        if (visibilityFilter === 'visible' && hidden) return false;
        if (visibilityFilter === 'hidden' && !hidden) return false;

        return capabilityFilters.every((capability) =>
          supportsCapability(entry, capability),
        );
      }),
    [
      allEntries,
      searchQuery,
      sourceFilter,
      visibilityFilter,
      capabilityFilters,
      hiddenSet,
    ],
  );

  const groups = useMemo(() => groupModels(filteredEntries), [filteredEntries]);
  const totalModels = allEntries.length;
  const hiddenKnownModels = allEntries.filter((entry) =>
    hiddenSet.has(entry.id),
  ).length;
  const visibleModels = Math.max(0, totalModels - hiddenKnownModels);
  const shownVisibleModels = filteredEntries.filter(
    (entry) => !hiddenSet.has(entry.id),
  ).length;
  const shownHiddenModels = filteredEntries.length - shownVisibleModels;

  const sourceCounts = useMemo(() => {
    const counts: Record<Exclude<SourceFilter, 'all'>, number> = {
      builtin: 0,
      local: 0,
      opencode: 0,
      codex: 0,
      custom: 0,
    };
    for (const entry of allEntries) counts[entrySource(entry)] += 1;
    return counts;
  }, [allEntries]);

  const activeFilterCount =
    (sourceFilter === 'all' ? 0 : 1) +
    (visibilityFilter === 'all' ? 0 : 1) +
    capabilityFilters.length;
  const hasResultFilter = Boolean(searchQuery.trim()) || activeFilterCount > 0;

  const handleToggle = useCallback(
    (entry: CatalogEntry) => {
      if (isDynamicOpenCodeEntry(entry)) {
        const isEnabled = enabledOpenCodeSet.has(entry.id);
        updateMutation.mutate({
          hiddenModelIds: hiddenIds.filter((id) => id !== entry.id),
          enabledOpenCodeModelIds: isEnabled
            ? enabledOpenCodeIds.filter((id) => id !== entry.id)
            : [...new Set([...enabledOpenCodeIds, entry.id])],
        });
        return;
      }

      const isCurrentlyHidden = hiddenIds.includes(entry.id);
      updateMutation.mutate({
        hiddenModelIds: isCurrentlyHidden
          ? hiddenIds.filter((id) => id !== entry.id)
          : [...new Set([...hiddenIds, entry.id])],
      });
    },
    [
      enabledOpenCodeIds,
      enabledOpenCodeSet,
      hiddenIds,
      updateMutation,
    ],
  );

  const setEntriesVisible = useCallback(
    (entries: CatalogEntry[], visible: boolean) => {
      const openCodeIds = new Set(
        entries.filter(isDynamicOpenCodeEntry).map((entry) => entry.id),
      );
      const regularIds = new Set(
        entries
          .filter((entry) => !isDynamicOpenCodeEntry(entry))
          .map((entry) => entry.id),
      );

      const cleanedHidden = hiddenIds.filter(
        (id) => !isDynamicOpenCodeModelId(id),
      );
      const nextHidden = visible
        ? cleanedHidden.filter((id) => !regularIds.has(id))
        : [...new Set([...cleanedHidden, ...regularIds])];
      const nextEnabledOpenCode = visible
        ? [...new Set([...enabledOpenCodeIds, ...openCodeIds])]
        : enabledOpenCodeIds.filter((id) => !openCodeIds.has(id));

      updateMutation.mutate({
        hiddenModelIds: nextHidden,
        enabledOpenCodeModelIds: nextEnabledOpenCode,
      });
    },
    [enabledOpenCodeIds, hiddenIds, updateMutation],
  );

  const handleRestoreDefaults = useCallback(() => {
    updateMutation.mutate({
      hiddenModelIds: [],
      enabledOpenCodeModelIds: [],
    });
  }, [updateMutation]);

  const handleClearFilters = useCallback(() => {
    setSearchQuery('');
    setVisibilityFilter('all');
    setSourceFilter('all');
    setCapabilityFilters([]);
    setExpandedGroupKey(null);
  }, []);

  const toggleCapability = useCallback((capability: CapabilityFilter) => {
    setCapabilityFilters((current) =>
      current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability],
    );
  }, []);

  const toggleGroup = useCallback((groupKey: string) => {
    setExpandedGroupKey((current) => (current === groupKey ? null : groupKey));
  }, []);

  const isLoading = isCatalogLoading || isPrefsLoading;
  const error =
    catalogError ?? (prefsError instanceof Error ? prefsError.message : null);

  if (error) {
    return (
      <section className="rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-4 sm:p-6">
        <h2 className="mb-5 text-sm font-medium text-adam-neutral-50">
          Models
        </h2>
        <div className="text-adam-red-400 text-sm">
          Failed to load model settings: {error}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-adam-neutral-50">Models</h2>
          <p className="mt-1 text-xs text-adam-neutral-400">
            Choose which models appear in the model picker. Newly discovered
            OpenCode models stay disabled until you enable them here.
          </p>
        </div>
        <span className="text-xs text-adam-neutral-300">
          {visibleModels} of {totalModels} enabled
        </span>
      </div>

      <div className="mb-4 space-y-3 rounded-xl border border-adam-neutral-800 bg-adam-background-1/40 p-3">
        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-adam-neutral-300">
            Free-text filter
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-adam-neutral-400" />
            <Input
              placeholder="Search model, provider, runtime or ID..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-9 pl-9 pr-9 text-adam-neutral-50 placeholder:text-adam-neutral-500"
            />
            {searchQuery ? (
              <button
                type="button"
                aria-label="Clear model search"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-adam-neutral-400 transition-colors hover:bg-adam-neutral-800 hover:text-adam-neutral-100"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-adam-neutral-300">
            Source
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_FILTERS.map((filter) => {
              const count =
                filter.value === 'all'
                  ? totalModels
                  : sourceCounts[filter.value];
              return (
                <FilterButton
                  key={filter.value}
                  active={sourceFilter === filter.value}
                  onClick={() => setSourceFilter(filter.value)}
                >
                  {filter.label}
                  <span className="ml-1 text-[10px] opacity-70">{count}</span>
                </FilterButton>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-adam-neutral-300">
              Visibility
            </div>
            <div className="flex flex-wrap gap-1.5">
              {VISIBILITY_FILTERS.map((filter) => (
                <FilterButton
                  key={filter.value}
                  active={visibilityFilter === filter.value}
                  onClick={() => setVisibilityFilter(filter.value)}
                >
                  {filter.label}
                  <span className="ml-1 text-[10px] opacity-70">
                    {filter.value === 'all'
                      ? totalModels
                      : filter.value === 'visible'
                        ? visibleModels
                        : hiddenKnownModels}
                  </span>
                </FilterButton>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-adam-neutral-300">
              Capabilities
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CAPABILITY_FILTERS.map((filter) => (
                <FilterButton
                  key={filter.value}
                  active={capabilityFilters.includes(filter.value)}
                  onClick={() => toggleCapability(filter.value)}
                >
                  {filter.label}
                </FilterButton>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-adam-neutral-800 pt-3">
          <span className="text-xs text-adam-neutral-300">
            {filteredEntries.length} shown · {shownVisibleModels} enabled ·{' '}
            {shownHiddenModels} hidden · {groups.length} groups
          </span>
          {hasResultFilter ? (
            <Button
              type="button"
              size="sm"
              variant="dark"
              onClick={handleClearFilters}
              className="h-7 rounded-full px-2.5 text-xs"
            >
              <X className="mr-1 h-3 w-3" />
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="light"
          onClick={() => setEntriesVisible(filteredEntries, true)}
          disabled={
            updateMutation.isPending ||
            filteredEntries.length === 0 ||
            shownHiddenModels === 0
          }
          className="h-7 rounded-full px-2 text-xs"
        >
          <SquareCheck className="mr-1 h-3 w-3" />
          {hasResultFilter ? 'Enable shown' : 'Enable all'}
        </Button>
        <Button
          size="sm"
          variant="dark"
          onClick={() => setEntriesVisible(filteredEntries, false)}
          disabled={
            updateMutation.isPending ||
            filteredEntries.length === 0 ||
            shownVisibleModels === 0
          }
          className="h-7 rounded-full px-2 text-xs"
        >
          <EyeOff className="mr-1 h-3 w-3" />
          {hasResultFilter ? 'Hide shown' : 'Hide all'}
        </Button>
        <Button
          size="sm"
          variant="dark"
          onClick={handleRestoreDefaults}
          disabled={
            updateMutation.isPending ||
            (hiddenIds.length === 0 && enabledOpenCodeIds.length === 0)
          }
          className="h-7 rounded-full px-2 text-xs"
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          Restore defaults
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <ActivityIndicator label="Loading model settings" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-adam-neutral-800 py-8 text-center text-sm text-adam-neutral-300">
          No models match the current filters.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((group) => {
            const groupVisible = group.models.filter(
              (entry) => !hiddenSet.has(entry.id),
            ).length;
            const groupHidden = group.models.length - groupVisible;
            const isExpanded = expandedGroupKey === group.key;

            return (
              <div
                key={group.key}
                className="overflow-hidden rounded-xl border border-adam-neutral-800 bg-adam-background-2"
              >
                <div
                  className={`flex items-center gap-2 bg-adam-background-1/40 p-2 ${
                    isExpanded ? 'border-b border-adam-neutral-800' : ''
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={`model-group-${group.key}`}
                    onClick={() => toggleGroup(group.key)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-adam-neutral-800/40"
                  >
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-adam-neutral-300 transition-transform ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-words text-sm font-medium text-adam-neutral-50">
                          {group.label}
                        </span>
                        <Badge
                          variant="outline"
                          className="h-5 shrink-0 px-1.5 text-[10px] text-adam-neutral-200"
                        >
                          {groupVisible}/{group.models.length} enabled
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-[11px] text-adam-neutral-300">
                        {group.models.length} model
                        {group.models.length === 1 ? '' : 's'}
                        {group.detail ? ` · ${group.detail}` : ''}
                      </div>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="dark"
                      onClick={() => setEntriesVisible(group.models, true)}
                      disabled={updateMutation.isPending || groupHidden === 0}
                      className="h-7 rounded-full px-2 text-[10px]"
                    >
                      Enable
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="dark"
                      onClick={() => setEntriesVisible(group.models, false)}
                      disabled={updateMutation.isPending || groupVisible === 0}
                      className="h-7 rounded-full px-2 text-[10px]"
                    >
                      Hide
                    </Button>
                  </div>
                </div>

                {isExpanded ? (
                  <div
                    id={`model-group-${group.key}`}
                    className="flex flex-col divide-y divide-adam-neutral-800/60"
                  >
                    {group.models.map((entry) => (
                      <ModelRow
                        key={entry.id}
                        entry={entry}
                        isHidden={hiddenSet.has(entry.id)}
                        onToggle={() => handleToggle(entry)}
                        isUpdating={updateMutation.isPending}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
