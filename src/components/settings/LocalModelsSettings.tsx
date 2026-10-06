import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Server } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { apiJson } from '@/services/api';
import { ActivityIndicator } from '@/components/brand';

type LocalModel = {
  id: string;
  modelId: string;
  displayName: string;
  provider: 'Local OpenAI / llama-swap';
  supportsTools: boolean;
  supportsThinking: boolean;
  supportsVision: boolean;
  contextLimit: number | null;
  outputLimit: number | null;
  isVisible: boolean;
  metadataConfigured: boolean;
};

type RuntimePayload = {
  integrations: Array<{
    integrationId: 'opencode' | 'codex' | 'local-openai';
    label: string;
    status: 'connected' | 'available' | 'unavailable' | 'not-configured';
    baseUrl: string | null;
    modelCount: number;
    explanation: string;
  }>;
  localModels: LocalModel[];
};

type LocalModelUpdate = Pick<
  LocalModel,
  | 'modelId'
  | 'displayName'
  | 'supportsTools'
  | 'supportsThinking'
  | 'supportsVision'
  | 'contextLimit'
  | 'outputLimit'
  | 'isVisible'
>;

async function fetchLocalModels(): Promise<RuntimePayload> {
  return apiJson(
    'settings/runtimeIntegrations?includeModels=1',
  ) as Promise<RuntimePayload>;
}

async function saveLocalModel(input: LocalModelUpdate): Promise<LocalModel> {
  return apiJson('settings/runtimeIntegrations', {
    method: 'PUT',
    body: JSON.stringify(input),
  }) as Promise<LocalModel>;
}

function LocalModelRow({
  model,
  busy,
  onSave,
}: {
  model: LocalModel;
  busy: boolean;
  onSave: (input: LocalModelUpdate) => void;
}) {
  const update = (patch: Partial<LocalModelUpdate>) =>
    onSave({
      modelId: model.modelId,
      displayName: model.displayName,
      supportsTools: model.supportsTools,
      supportsThinking: model.supportsThinking,
      supportsVision: model.supportsVision,
      contextLimit: model.contextLimit,
      outputLimit: model.outputLimit,
      isVisible: model.isVisible,
      ...patch,
    });

  return (
    <div className="rounded-lg border border-adam-neutral-800 bg-adam-background-1/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-all font-mono text-xs text-adam-neutral-100">
            {model.modelId}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="outline">Dynamic</Badge>
            {model.metadataConfigured ? (
              <Badge variant="outline">Metadata saved</Badge>
            ) : (
              <Badge variant="outline">Defaults</Badge>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-adam-neutral-200">
          Enabled
          <Switch
            checked={model.isVisible}
            disabled={busy}
            onCheckedChange={(isVisible) => update({ isVisible })}
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-adam-neutral-300">
            Display name
          </label>
          <Input
            defaultValue={model.displayName}
            disabled={busy}
            className="h-8 text-xs text-adam-neutral-50"
            onBlur={(event) => {
              const displayName =
                event.currentTarget.value.trim() || model.modelId;
              if (displayName !== model.displayName) update({ displayName });
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-adam-neutral-300">
              Context limit
            </label>
            <Input
              type="number"
              min={1}
              defaultValue={model.contextLimit ?? ''}
              disabled={busy}
              className="h-8 text-xs text-adam-neutral-50"
              onBlur={(event) => {
                const value = event.currentTarget.value.trim();
                const contextLimit = value ? Number(value) : null;
                if (contextLimit !== model.contextLimit)
                  update({ contextLimit });
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-adam-neutral-300">
              Output limit
            </label>
            <Input
              type="number"
              min={1}
              defaultValue={model.outputLimit ?? ''}
              disabled={busy}
              className="h-8 text-xs text-adam-neutral-50"
              onBlur={(event) => {
                const value = event.currentTarget.value.trim();
                const outputLimit = value ? Number(value) : null;
                if (outputLimit !== model.outputLimit) update({ outputLimit });
              }}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {[
          ['Tools', model.supportsTools, 'supportsTools'],
          ['Thinking', model.supportsThinking, 'supportsThinking'],
          ['Vision', model.supportsVision, 'supportsVision'],
        ].map(([label, checked, key]) => (
          <label
            key={key as string}
            className="flex items-center justify-between gap-2 rounded-md border border-adam-neutral-800 px-3 py-2 text-xs text-adam-neutral-200"
          >
            {label as string}
            <Switch
              checked={checked as boolean}
              disabled={busy}
              onCheckedChange={(value) =>
                update({ [key as string]: value } as Partial<LocalModelUpdate>)
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function LocalModelsSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const query = useQuery({
    queryKey: ['local-models'],
    queryFn: fetchLocalModels,
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: saveLocalModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-models'] });
      queryClient.invalidateQueries({ queryKey: ['vision-model-catalog'] });
      toast({ title: 'Local model metadata saved' });
    },
    onError: (error: Error) =>
      toast({
        title: 'Could not save local model metadata',
        description: error.message,
        variant: 'destructive',
      }),
  });

  const localRuntime = query.data?.integrations.find(
    (item) => item.integrationId === 'local-openai',
  );
  const models = query.data?.localModels ?? [];

  return (
    <section className="rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-adam-blue" />
            <h2 className="text-sm font-medium text-adam-neutral-50">
              Local models
            </h2>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-adam-neutral-300">
            Models are discovered live from the built-in Local OpenAI /
            llama-swap provider via /v1/models. Only capability and display
            metadata is saved; model IDs are never hardcoded in Brepia.
          </p>
        </div>
        <Button
          size="sm"
          variant="dark"
          disabled={query.isFetching}
          onClick={() => query.refetch()}
          className="h-8 rounded-full px-3 text-xs"
        >
          {query.isFetching ? (
            <ActivityIndicator label="Refreshing model discovery" size="sm" />
          ) : (
            <RefreshCw className="mr-1 h-3 w-3" />
          )}
          Refresh discovery
        </Button>
      </div>

      {localRuntime && (
        <div className="mb-4 rounded-lg border border-adam-neutral-800 bg-adam-background-1/50 px-3 py-2 text-xs text-adam-neutral-300">
          <span className="font-medium text-adam-neutral-100">
            {localRuntime.label}
          </span>
          {' · '}
          {localRuntime.status}
          {localRuntime.baseUrl ? ` · ${localRuntime.baseUrl}` : ''}
        </div>
      )}

      {query.isLoading ? (
        <div className="flex justify-center py-8">
          <ActivityIndicator label="Discovering local models" />
        </div>
      ) : query.isError ? (
        <div className="border-adam-red-400/30 text-adam-red-300 rounded-lg border px-3 py-3 text-xs">
          Local model discovery failed: {query.error.message}
        </div>
      ) : models.length === 0 ? (
        <div className="rounded-lg border border-dashed border-adam-neutral-700 px-4 py-7 text-center text-xs text-adam-neutral-300">
          No models were returned by the configured Local OpenAI / llama-swap
          /v1/models endpoint.
        </div>
      ) : (
        <div className="space-y-2">
          {models.map((model) => (
            <LocalModelRow
              key={model.modelId}
              model={model}
              busy={mutation.isPending}
              onSave={(input) => mutation.mutate(input)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
