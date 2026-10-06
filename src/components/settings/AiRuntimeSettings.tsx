import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { AI_RUNTIME_LIMIT_DEFINITIONS } from '@shared/aiInstructionCatalog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { apiJson } from '@/services/api';

type Preferences = {
  runtimeOverrides?: Record<string, number | string>;
};

type DraftValues = Record<string, string>;

type RuntimeDefinition = (typeof AI_RUNTIME_LIMIT_DEFINITIONS)[number];

async function fetchPreferences(): Promise<Preferences> {
  return apiJson('ai-settings/preferences') as Promise<Preferences>;
}

function effectiveValue(
  definition: RuntimeDefinition,
  overrides: Record<string, number | string>,
): number | string {
  return overrides[definition.key] ?? definition.defaultValue;
}

function serializeValue(value: number | string): string {
  return String(value);
}

function parseDraftValue(
  definition: RuntimeDefinition,
  raw: string,
): number | string {
  if (definition.kind === 'enum') return raw;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${definition.label} must be a number.`);
  }
  if (definition.kind === 'integer' && !Number.isInteger(parsed)) {
    throw new Error(`${definition.label} must be an integer.`);
  }
  if (definition.min !== undefined && parsed < definition.min) {
    throw new Error(`${definition.label} must be at least ${definition.min}.`);
  }
  if (definition.max !== undefined && parsed > definition.max) {
    throw new Error(`${definition.label} must be at most ${definition.max}.`);
  }
  return parsed;
}

function sectionLabel(key: string): string {
  const section = key.split('.')[0];
  if (section === 'chat') return 'Chat';
  if (section === 'vision') return 'Vision';
  if (section === 'creative') return 'Creative 3D';
  return section;
}

export function AiRuntimeSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const preferencesQuery = useQuery({
    queryKey: ['ai-preferences'],
    queryFn: fetchPreferences,
    staleTime: 0,
  });
  const [drafts, setDrafts] = useState<DraftValues>({});

  const overrides = useMemo(
    () => preferencesQuery.data?.runtimeOverrides ?? {},
    [preferencesQuery.data?.runtimeOverrides],
  );

  useEffect(() => {
    if (!preferencesQuery.data) return;
    setDrafts(
      Object.fromEntries(
        AI_RUNTIME_LIMIT_DEFINITIONS.map((definition) => [
          definition.key,
          serializeValue(effectiveValue(definition, overrides)),
        ]),
      ),
    );
  }, [preferencesQuery.data, overrides]);

  const sections = useMemo(() => {
    const grouped = new Map<string, RuntimeDefinition[]>();
    for (const definition of AI_RUNTIME_LIMIT_DEFINITIONS) {
      const section = sectionLabel(definition.key);
      const entries = grouped.get(section) ?? [];
      entries.push(definition);
      grouped.set(section, entries);
    }
    return Array.from(grouped.entries());
  }, []);

  const isDirty = useMemo(
    () =>
      AI_RUNTIME_LIMIT_DEFINITIONS.some((definition) => {
        const current = serializeValue(effectiveValue(definition, overrides));
        return (
          drafts[definition.key] !== undefined &&
          drafts[definition.key] !== current
        );
      }),
    [drafts, overrides],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const next: Record<string, number | string> = {};
      for (const definition of AI_RUNTIME_LIMIT_DEFINITIONS) {
        const raw = drafts[definition.key];
        if (raw === undefined) continue;
        next[definition.key] = parseDraftValue(definition, raw);
      }
      return apiJson('ai-settings/preferences', {
        method: 'PUT',
        body: JSON.stringify({ runtimeOverrides: next }),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ai-preferences'] });
      toast({
        title: 'Runtime settings saved',
        description: 'New AI requests will use the saved values.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to save runtime settings.',
        variant: 'destructive',
      });
    },
  });

  if (preferencesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-adam-neutral-400" />
      </div>
    );
  }

  if (preferencesQuery.error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">
        Failed to load runtime settings.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-adam-neutral-50">
            AI runtime behavior
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-adam-neutral-400">
            Configure validated execution limits used by the AI and Creative
            runtimes. Repository defaults are shown as reference values; saving
            writes explicit values for this user. Backend capability and
            security constraints are not changed here.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !isDirty}
        >
          {saveMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save runtime settings
        </Button>
      </div>

      {sections.map(([section, definitions]) => (
        <section
          key={section}
          className="rounded-xl border border-adam-neutral-800 bg-adam-background-1 p-4"
        >
          <h4 className="mb-3 text-sm font-medium text-adam-neutral-100">
            {section}
          </h4>
          <div className="grid gap-4 md:grid-cols-2">
            {definitions.map((definition) => {
              const value = drafts[definition.key] ?? '';
              return (
                <div key={definition.key} className="space-y-1.5">
                  <label className="text-xs font-medium text-adam-neutral-200">
                    {definition.label}
                  </label>
                  {definition.kind === 'enum' ? (
                    <select
                      value={value}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [definition.key]: event.target.value,
                        }))
                      }
                      className="h-10 w-full rounded-md border border-adam-neutral-700 bg-adam-background-2 px-3 text-sm text-adam-neutral-100"
                    >
                      {(definition.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      type="number"
                      value={value}
                      min={definition.min}
                      max={definition.max}
                      step={definition.kind === 'integer' ? 1 : 'any'}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [definition.key]: event.target.value,
                        }))
                      }
                    />
                  )}
                  <p className="text-[11px] leading-relaxed text-adam-neutral-400">
                    {definition.description}
                  </p>
                  <p className="text-[11px] text-adam-neutral-500">
                    Repository default: {String(definition.defaultValue)}
                    {definition.min !== undefined &&
                    definition.max !== undefined
                      ? ` · allowed ${definition.min}–${definition.max}`
                      : ''}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
