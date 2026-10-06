import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  Code2,
  Edit2,
  Key,
  MessageSquare,
  Network,
  Plug,
  Plus,
  RotateCcw,
  Server,
  Settings2,
  Terminal,
  TestTubes,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import { ActivityIndicator } from '@/components/brand';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiJson } from '@/services/api';
import { cn } from '@/lib/utils';
import type { TestProviderResultDto } from '@shared/aiSettings';

type ProviderDriver =
  'openai-compatible' | 'anthropic' | 'google' | 'openrouter';

interface ProviderSummary {
  id: string;
  userId: string;
  slug: string;
  name: string;
  driver: ProviderDriver;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProviderDetail extends ProviderSummary {
  baseUrl: string | null;
  hasCredential: boolean;
}

interface CreateProviderInput {
  slug: string;
  name: string;
  driver: ProviderDriver;
  baseUrl?: string;
  credential?: string;
}

interface UpdateProviderInput {
  name?: string;
  driver?: ProviderDriver;
  baseUrl?: string;
  credential?: string | null;
  enabled?: boolean;
}

interface BuiltinProviderSettings {
  driver: ProviderDriver;
  label: string;
  overrideId: string | null;
  customized: boolean;
  enabled: boolean;
  baseUrl: string;
  hasCredential: boolean;
  credentialSource: 'override' | 'server' | 'none';
}

interface RuntimeIntegrationStatus {
  integrationId: 'opencode' | 'codex' | 'local-openai';
  label: string;
  status: 'connected' | 'available' | 'unavailable' | 'not-configured';
  baseUrl: string | null;
  modelCount: number;
  explanation: string;
}

interface ProviderModelSummary {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  description: string | null;
  supportsTools: boolean;
  supportsThinking: boolean;
  supportsVision: boolean;
  contextLimit: number | null;
  outputLimit: number | null;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

type ProviderModelDetail = ProviderModelSummary;

interface CreateProviderModelInput {
  modelId: string;
  displayName: string;
  description?: string;
  supportsTools?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  contextLimit?: number;
  outputLimit?: number;
  isVisible?: boolean;
}

interface UpdateProviderModelInput {
  displayName?: string;
  description?: string | null;
  supportsTools?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  contextLimit?: number | null;
  outputLimit?: number | null;
  isVisible?: boolean;
}

const DRIVER_LABELS: Record<ProviderDriver, string> = {
  'openai-compatible': 'OpenAI Compatible',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
};

const DRIVER_ICONS: Record<ProviderDriver, typeof Code2> = {
  'openai-compatible': Code2,
  anthropic: Plug,
  google: Plug,
  openrouter: Plug,
};

const PRESET_ENDPOINTS: Record<ProviderDriver, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
  'openai-compatible': '',
};

const BUILTIN_SLUG_PREFIX = 'builtin-';

async function fetchProviders(): Promise<ProviderSummary[]> {
  return apiJson('ai-settings/providers') as Promise<ProviderSummary[]>;
}

async function fetchProviderDetail(id: string): Promise<ProviderDetail> {
  return apiJson(`ai-settings/providers/${id}`) as Promise<ProviderDetail>;
}

async function fetchBuiltinProviders(): Promise<BuiltinProviderSettings[]> {
  return apiJson('ai-settings/providers/builtins') as Promise<
    BuiltinProviderSettings[]
  >;
}

async function saveBuiltinProvider(input: {
  driver: ProviderDriver;
  baseUrl?: string;
  credential?: string | null;
  enabled?: boolean;
  reset?: boolean;
}): Promise<BuiltinProviderSettings> {
  return apiJson('ai-settings/providers/builtins', {
    method: 'PUT',
    body: JSON.stringify(input),
  }) as Promise<BuiltinProviderSettings>;
}

async function fetchRuntimeIntegrations(): Promise<RuntimeIntegrationStatus[]> {
  return apiJson('settings/runtime-integrations') as Promise<
    RuntimeIntegrationStatus[]
  >;
}

async function createProvider(
  input: CreateProviderInput,
): Promise<ProviderDetail> {
  return apiJson('ai-settings/providers', {
    method: 'POST',
    body: JSON.stringify(input),
  }) as Promise<ProviderDetail>;
}

async function updateProvider(
  providerId: string,
  input: UpdateProviderInput,
): Promise<ProviderDetail> {
  return apiJson(`ai-settings/providers/${providerId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  }) as Promise<ProviderDetail>;
}

async function deleteProvider(providerId: string): Promise<void> {
  await apiJson(`ai-settings/providers/${providerId}`, { method: 'DELETE' });
}

async function testProviderConnection(input: {
  id?: string;
  draftConfig?: Partial<CreateProviderInput>;
}): Promise<TestProviderResultDto> {
  return apiJson('ai-settings/providers/test', {
    method: 'POST',
    body: JSON.stringify(input),
  }) as Promise<TestProviderResultDto>;
}

async function fetchProviderModels(
  providerId: string,
): Promise<ProviderModelSummary[]> {
  return apiJson(`ai-settings/providers/${providerId}/models`) as Promise<
    ProviderModelSummary[]
  >;
}

async function createProviderModel(
  providerId: string,
  input: CreateProviderModelInput,
): Promise<ProviderModelDetail> {
  return apiJson(`ai-settings/providers/${providerId}/models`, {
    method: 'POST',
    body: JSON.stringify(input),
  }) as Promise<ProviderModelDetail>;
}

async function updateProviderModel(
  providerId: string,
  modelRowId: string,
  input: UpdateProviderModelInput,
): Promise<ProviderModelDetail> {
  return apiJson(`ai-settings/providers/${providerId}/models/${modelRowId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  }) as Promise<ProviderModelDetail>;
}

async function deleteProviderModel(
  providerId: string,
  modelRowId: string,
): Promise<void> {
  await apiJson(`ai-settings/providers/${providerId}/models/${modelRowId}`, {
    method: 'DELETE',
  });
}

function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: fetchProviders,
    staleTime: 0,
  });
}

function useProviderDetail(id: string | null) {
  return useQuery({
    queryKey: ['provider', id ?? ''],
    queryFn: () => (id ? fetchProviderDetail(id) : null),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

function useBuiltinProviders() {
  return useQuery({
    queryKey: ['builtin-providers'],
    queryFn: fetchBuiltinProviders,
    staleTime: 0,
  });
}

function useRuntimeIntegrations() {
  return useQuery({
    queryKey: ['runtime-integrations'],
    queryFn: fetchRuntimeIntegrations,
    staleTime: 0,
  });
}

function useProviderModels(providerId: string | null) {
  return useQuery({
    queryKey: ['providerModels', providerId ?? ''],
    queryFn: () =>
      providerId ? fetchProviderModels(providerId) : Promise.resolve([]),
    enabled: Boolean(providerId),
    staleTime: 0,
  });
}

function useCreateProvider() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: createProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      toast({ title: 'Provider created' });
    },
    onError: (error: Error) =>
      toast({
        title: 'Could not create provider',
        description: error.message,
        variant: 'destructive',
      }),
  });
}

function useUpdateProvider() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({
      providerId,
      input,
    }: {
      providerId: string;
      input: UpdateProviderInput;
    }) => updateProvider(providerId, input),
    onSuccess: (provider) => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['provider', provider.id] });
      toast({ title: 'Provider updated' });
    },
    onError: (error: Error) =>
      toast({
        title: 'Could not update provider',
        description: error.message,
        variant: 'destructive',
      }),
  });
}

function useDeleteProvider() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: deleteProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      toast({ title: 'Provider deleted' });
    },
    onError: (error: Error) =>
      toast({
        title: 'Could not delete provider',
        description: error.message,
        variant: 'destructive',
      }),
  });
}

function useSaveBuiltinProvider() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: saveBuiltinProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['builtin-providers'] });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      toast({ title: 'Provider settings saved' });
    },
    onError: (error: Error) =>
      toast({
        title: 'Could not save provider settings',
        description: error.message,
        variant: 'destructive',
      }),
  });
}

function useTestProvider() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: testProviderConnection,
    onSuccess: (result) =>
      toast({
        title: result.ok ? 'Connection successful' : 'Connection failed',
        description: result.ok
          ? `${result.message} (${result.latencyMs}ms)`
          : result.message,
        ...(result.ok ? {} : { variant: 'destructive' as const }),
      }),
    onError: (error: Error) =>
      toast({
        title: 'Connection test failed',
        description: error.message,
        variant: 'destructive',
      }),
  });
}

function useCreateProviderModel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({
      providerId,
      input,
    }: {
      providerId: string;
      input: CreateProviderModelInput;
    }) => createProviderModel(providerId, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['providerModels', variables.providerId],
      });
      toast({ title: 'Model added' });
    },
  });
}

function useUpdateProviderModel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({
      providerId,
      modelRowId,
      input,
    }: {
      providerId: string;
      modelRowId: string;
      input: UpdateProviderModelInput;
    }) => updateProviderModel(providerId, modelRowId, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['providerModels', variables.providerId],
      });
      toast({ title: 'Model updated' });
    },
  });
}

function useDeleteProviderModel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({
      providerId,
      modelRowId,
    }: {
      providerId: string;
      modelRowId: string;
    }) => deleteProviderModel(providerId, modelRowId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['providerModels', variables.providerId],
      });
      toast({ title: 'Model deleted' });
    },
  });
}

function DriverBadge({ driver }: { driver: ProviderDriver }) {
  return (
    <Badge variant="outline" className="text-adam-neutral-200">
      {DRIVER_LABELS[driver]}
    </Badge>
  );
}

function CredentialBadge({
  hasCredential,
  source,
}: {
  hasCredential: boolean;
  source?: 'override' | 'server' | 'none';
}) {
  if (!hasCredential) {
    return (
      <Badge
        variant="outline"
        className="border-adam-neutral-700 text-adam-neutral-300"
      >
        <Key className="mr-1 h-3 w-3" /> No credential
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-adam-emerald/30 bg-adam-emerald/10 text-adam-emerald"
    >
      <Key className="mr-1 h-3 w-3" />
      {source === 'server'
        ? 'Server credential'
        : source === 'override'
          ? 'Custom credential'
          : 'Credential saved'}
    </Badge>
  );
}

function BuiltinProviderCard({
  provider,
  onEdit,
  onToggle,
  onReset,
  busy,
}: {
  provider: BuiltinProviderSettings;
  onEdit: () => void;
  onToggle: () => void;
  onReset: () => void;
  busy: boolean;
}) {
  const Icon = DRIVER_ICONS[provider.driver] ?? Code2;
  return (
    <div
      className={cn(
        'rounded-lg border border-adam-neutral-700 bg-adam-background-2 px-4 py-3',
        !provider.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-adam-blue/10">
            <Icon className="h-4 w-4 text-adam-blue" />
          </div>
          <div className="min-w-0">
            <div className="break-words text-sm font-medium text-adam-neutral-50">
              {provider.label}
            </div>
            <div className="mt-0.5 break-all text-xs text-adam-neutral-300">
              {provider.baseUrl}
            </div>
          </div>
        </div>
        <Switch
          checked={provider.enabled}
          onCheckedChange={onToggle}
          disabled={busy}
          aria-label={`Enable ${provider.label}`}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DriverBadge driver={provider.driver} />
        <CredentialBadge
          hasCredential={provider.hasCredential}
          source={provider.credentialSource}
        />
        <Badge
          variant="outline"
          className={
            provider.customized
              ? 'border-adam-blue/30 bg-adam-blue/10 text-adam-blue'
              : 'border-adam-neutral-700 text-adam-neutral-300'
          }
        >
          {provider.customized ? 'User override' : 'Server defaults'}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {provider.customized && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onReset}
            disabled={busy}
            className="h-7 rounded-full px-2 text-xs text-adam-neutral-200"
          >
            <RotateCcw className="mr-1 h-3 w-3" /> Reset
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={onEdit}
          disabled={busy}
          className="h-7 rounded-full px-2 text-xs text-adam-neutral-100"
        >
          <Edit2 className="mr-1 h-3 w-3" /> Edit settings
        </Button>
      </div>
    </div>
  );
}

function BuiltinProviderForm({
  provider,
  onSave,
  onReset,
  onCancel,
  busy,
}: {
  provider: BuiltinProviderSettings;
  onSave: (input: {
    driver: ProviderDriver;
    baseUrl: string;
    credential?: string | null;
    enabled: boolean;
  }) => void;
  onReset: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [enabled, setEnabled] = useState(provider.enabled);
  const [credential, setCredential] = useState('');
  const [showCredential, setShowCredential] = useState(false);
  const [removeOverrideCredential, setRemoveOverrideCredential] =
    useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      driver: provider.driver,
      baseUrl: baseUrl.trim(),
      enabled,
      ...(removeOverrideCredential
        ? { credential: null }
        : credential
          ? { credential }
          : {}),
    });
  };

  return (
    <form
      onSubmit={submit}
      className="mt-2 space-y-4 rounded-lg border border-adam-blue/30 bg-adam-background-1 p-4"
    >
      <div>
        <div className="text-sm font-medium text-adam-neutral-50">
          {provider.label}
        </div>
        <div className="text-xs text-adam-neutral-300">
          Override the server defaults for your account. Leave the credential
          blank to keep using the current{' '}
          {provider.credentialSource === 'server' ? 'server' : 'saved'}{' '}
          credential.
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-adam-neutral-200">
          Driver
        </label>
        <Input
          value={DRIVER_LABELS[provider.driver]}
          readOnly
          className="h-9 text-adam-neutral-300"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-adam-neutral-200">
          Base URL
        </label>
        <Input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          className="h-9 text-adam-neutral-50"
          required
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-adam-neutral-200">
            API key / token
          </label>
          {provider.credentialSource === 'override' && (
            <button
              type="button"
              onClick={() => {
                setRemoveOverrideCredential((value) => !value);
                setCredential('');
              }}
              className="text-[11px] text-adam-blue hover:text-adam-blue/80"
            >
              {removeOverrideCredential
                ? 'Keep custom credential'
                : 'Use server credential'}
            </button>
          )}
        </div>
        <Input
          type={showCredential ? 'text' : 'password'}
          value={credential}
          onChange={(event) => {
            setCredential(event.target.value);
            setRemoveOverrideCredential(false);
          }}
          disabled={removeOverrideCredential}
          placeholder={
            removeOverrideCredential
              ? 'Custom credential will be removed'
              : provider.hasCredential
                ? 'Enter a new credential to replace the current one'
                : 'API key or token'
          }
          className="h-9 text-adam-neutral-50"
        />
        {credential && (
          <button
            type="button"
            onClick={() => setShowCredential((value) => !value)}
            className="mt-1 text-[11px] text-adam-neutral-300 underline"
          >
            {showCredential ? 'Hide credential' : 'Show credential'}
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-adam-neutral-700 px-3 py-2">
        <div>
          <div className="text-xs font-medium text-adam-neutral-100">
            Enabled
          </div>
          <div className="text-[11px] text-adam-neutral-400">
            Disabled providers cannot be used for new requests.
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {provider.customized && (
          <Button
            type="button"
            variant="ghost"
            onClick={onReset}
            disabled={busy}
            className="h-8 rounded-full px-3 text-xs text-adam-neutral-200"
          >
            <RotateCcw className="mr-1 h-3 w-3" /> Server defaults
          </Button>
        )}
        <Button
          type="button"
          variant="dark"
          onClick={onCancel}
          disabled={busy}
          className="h-8 rounded-full px-3 text-xs"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={busy || !baseUrl.trim()}
          className="h-8 rounded-full px-3 text-xs"
        >
          {busy ? (
            <ActivityIndicator
              className="mr-1"
              label="Saving provider settings"
              size="sm"
            />
          ) : (
            <Check className="mr-1 h-3 w-3" />
          )}
          Save settings
        </Button>
      </div>
    </form>
  );
}

function ProviderForm({
  mode,
  initialData,
  onSave,
  onCancel,
  busy,
}: {
  mode: 'create' | 'edit';
  initialData?: ProviderDetail;
  onSave: (input: CreateProviderInput | UpdateProviderInput) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(initialData?.name ?? '');
  const [driver, setDriver] = useState<ProviderDriver>(
    initialData?.driver ?? 'openai-compatible',
  );
  const [baseUrl, setBaseUrl] = useState(initialData?.baseUrl ?? '');
  const [credential, setCredential] = useState('');
  const [showCredential, setShowCredential] = useState(false);
  const [removeCredential, setRemoveCredential] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;

    if (mode === 'create') {
      const slug = cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      onSave({
        slug,
        name: cleanName,
        driver,
        baseUrl: baseUrl.trim() || PRESET_ENDPOINTS[driver],
        ...(credential ? { credential } : {}),
      });
      return;
    }

    onSave({
      name: cleanName,
      driver,
      baseUrl: baseUrl.trim(),
      ...(removeCredential
        ? { credential: null }
        : credential
          ? { credential }
          : {}),
    });
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-adam-neutral-700 bg-adam-background-1 p-4"
    >
      <div className="text-sm font-medium text-adam-neutral-50">
        {mode === 'create'
          ? 'Add provider'
          : `Edit ${initialData?.name ?? 'provider'}`}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-adam-neutral-200">
          Display name
        </label>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-9 text-adam-neutral-50"
          required
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-adam-neutral-200">
          Driver
        </label>
        <select
          value={driver}
          onChange={(event) => setDriver(event.target.value as ProviderDriver)}
          className="h-9 w-full rounded-md border border-adam-neutral-700 bg-adam-background-1 px-3 text-sm text-adam-neutral-100 outline-none focus:border-adam-blue/50"
        >
          <option value="openai-compatible">OpenAI Compatible</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-adam-neutral-200">
          Base URL
        </label>
        <Input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={PRESET_ENDPOINTS[driver] || 'http://127.0.0.1:8080/v1'}
          className="h-9 text-adam-neutral-50"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-adam-neutral-200">
            API key / token
          </label>
          {initialData?.hasCredential && (
            <button
              type="button"
              onClick={() => {
                setRemoveCredential((value) => !value);
                setCredential('');
              }}
              className="text-[11px] text-adam-blue hover:text-adam-blue/80"
            >
              {removeCredential ? 'Keep credential' : 'Remove credential'}
            </button>
          )}
        </div>
        <Input
          type={showCredential ? 'text' : 'password'}
          value={credential}
          onChange={(event) => {
            setCredential(event.target.value);
            setRemoveCredential(false);
          }}
          disabled={removeCredential}
          placeholder={
            removeCredential
              ? 'Credential will be removed'
              : initialData?.hasCredential
                ? 'Enter a new credential to replace it'
                : 'API key or token'
          }
          className="h-9 text-adam-neutral-50"
        />
        {credential && (
          <button
            type="button"
            onClick={() => setShowCredential((value) => !value)}
            className="mt-1 text-[11px] text-adam-neutral-300 underline"
          >
            {showCredential ? 'Hide credential' : 'Show credential'}
          </button>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="dark"
          onClick={onCancel}
          disabled={busy}
          className="h-8 rounded-full px-3 text-xs"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={busy || !name.trim()}
          className="h-8 rounded-full px-3 text-xs"
        >
          {busy ? (
            <ActivityIndicator
              className="mr-1"
              label={
                mode === 'create'
                  ? 'Creating provider'
                  : 'Saving provider settings'
              }
              size="sm"
            />
          ) : (
            <Check className="mr-1 h-3 w-3" />
          )}
          {mode === 'create' ? 'Create provider' : 'Save settings'}
        </Button>
      </div>
    </form>
  );
}

function CustomProviderCard({
  summary,
  onEdit,
  onDelete,
  onManageModels,
}: {
  summary: ProviderSummary;
  onEdit: (provider: ProviderDetail) => void;
  onDelete: (providerId: string) => void;
  onManageModels: (providerId: string) => void;
}) {
  const detailQuery = useProviderDetail(summary.id);
  const updateMutation = useUpdateProvider();
  const testMutation = useTestProvider();
  const [testResult, setTestResult] = useState<TestProviderResultDto | null>(
    null,
  );
  const detail = detailQuery.data;
  const Icon = DRIVER_ICONS[summary.driver] ?? Code2;

  if (!detail) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-adam-neutral-700 px-4 py-4 text-xs text-adam-neutral-300">
        <ActivityIndicator label={`Loading ${summary.name}`} size="sm" />{' '}
        Loading {summary.name}…
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-adam-neutral-700 bg-adam-background-2 px-4 py-3',
        !detail.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-adam-blue/10">
            <Icon className="h-4 w-4 text-adam-blue" />
          </div>
          <div className="min-w-0">
            <div className="break-words text-sm font-medium text-adam-neutral-50">
              {detail.name}
            </div>
            <div className="mt-0.5 break-all text-xs text-adam-neutral-300">
              {detail.baseUrl || 'No endpoint configured'}
            </div>
          </div>
        </div>
        <Switch
          checked={detail.enabled}
          onCheckedChange={() =>
            updateMutation.mutate({
              providerId: detail.id,
              input: { enabled: !detail.enabled },
            })
          }
          disabled={updateMutation.isPending}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DriverBadge driver={detail.driver} />
        <CredentialBadge hasCredential={detail.hasCredential} />
        {testResult && (
          <Badge
            variant="outline"
            className={
              testResult.ok
                ? 'border-adam-emerald/30 text-adam-emerald'
                : 'border-adam-red-400/30 text-adam-red-400'
            }
          >
            {testResult.ok ? (
              <CheckCircle2 className="mr-1 h-3 w-3" />
            ) : (
              <XCircle className="mr-1 h-3 w-3" />
            )}
            {testResult.ok ? `${testResult.latencyMs}ms` : 'Failed'}
          </Badge>
        )}
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onManageModels(detail.id)}
          className="h-7 rounded-full px-2 text-xs text-adam-neutral-200"
        >
          <MessageSquare className="mr-1 h-3 w-3" /> Models
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!detail.enabled || testMutation.isPending}
          onClick={() =>
            testMutation.mutate(
              { id: detail.id },
              { onSettled: (result) => setTestResult(result ?? null) },
            )
          }
          className="h-7 rounded-full px-2 text-xs text-adam-neutral-200"
        >
          {testMutation.isPending ? (
            <ActivityIndicator
              className="mr-1"
              label="Testing provider connection"
              size="sm"
            />
          ) : (
            <TestTubes className="mr-1 h-3 w-3" />
          )}
          Test
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(detail)}
          className="h-7 rounded-full px-2 text-xs text-adam-neutral-100"
        >
          <Edit2 className="mr-1 h-3 w-3" /> Edit settings
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(detail.id)}
          className="text-adam-red-400 hover:text-adam-red-300 h-7 rounded-full px-2 text-xs"
        >
          <Trash2 className="mr-1 h-3 w-3" /> Delete
        </Button>
      </div>
    </div>
  );
}

const INTEGRATION_ICONS: Record<
  RuntimeIntegrationStatus['integrationId'],
  typeof Terminal
> = {
  opencode: Terminal,
  codex: Network,
  'local-openai': Server,
};

function RuntimeIntegrationCard({
  integration,
}: {
  integration: RuntimeIntegrationStatus;
}) {
  const Icon = INTEGRATION_ICONS[integration.integrationId];
  const statusClass =
    integration.status === 'connected'
      ? 'text-adam-emerald'
      : integration.status === 'available'
        ? 'text-adam-blue'
        : integration.status === 'unavailable'
          ? 'text-adam-amber'
          : 'text-adam-neutral-300';

  return (
    <div className="rounded-lg border border-adam-neutral-700 bg-adam-background-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-adam-neutral-800">
            <Icon className="h-4 w-4 text-adam-neutral-200" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-adam-neutral-50">
              {integration.label}
            </div>
            <div className={cn('text-xs font-medium', statusClass)}>
              {integration.status === 'not-configured'
                ? 'Not configured'
                : integration.status.charAt(0).toUpperCase() +
                  integration.status.slice(1)}
            </div>
            {integration.baseUrl && (
              <div className="mt-1 break-all text-xs text-adam-neutral-300">
                {integration.baseUrl.replace(/\/+$/, '')}
              </div>
            )}
          </div>
        </div>
        {integration.modelCount > 0 && (
          <Badge variant="outline" className="text-adam-neutral-200">
            {integration.modelCount} models
          </Badge>
        )}
      </div>
      <p className="mt-2 text-xs text-adam-neutral-300">
        {integration.explanation}
      </p>
    </div>
  );
}

function ProviderModelForm({
  mode,
  initialData,
  onSave,
  onCancel,
  busy,
}: {
  mode: 'create' | 'edit';
  initialData?: ProviderModelDetail;
  onSave: (input: CreateProviderModelInput | UpdateProviderModelInput) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [modelId, setModelId] = useState(initialData?.modelId ?? '');
  const [displayName, setDisplayName] = useState(
    initialData?.displayName ?? '',
  );
  const [description, setDescription] = useState(
    initialData?.description ?? '',
  );
  const [supportsTools, setSupportsTools] = useState(
    initialData?.supportsTools ?? false,
  );
  const [supportsThinking, setSupportsThinking] = useState(
    initialData?.supportsThinking ?? false,
  );
  const [supportsVision, setSupportsVision] = useState(
    initialData?.supportsVision ?? false,
  );
  const [contextLimit, setContextLimit] = useState(
    initialData?.contextLimit?.toString() ?? '',
  );
  const [outputLimit, setOutputLimit] = useState(
    initialData?.outputLimit?.toString() ?? '',
  );
  const [isVisible, setIsVisible] = useState(initialData?.isVisible ?? true);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const base: UpdateProviderModelInput = {
      displayName: displayName.trim(),
      description: description.trim() || null,
      supportsTools,
      supportsThinking,
      supportsVision,
      contextLimit: contextLimit ? Number(contextLimit) : null,
      outputLimit: outputLimit ? Number(outputLimit) : null,
      isVisible,
    };
    if (mode === 'create') {
      onSave({
        ...base,
        modelId: modelId.trim(),
        displayName: displayName.trim(),
      } as CreateProviderModelInput);
    } else {
      onSave(base);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mb-3 space-y-3 rounded-lg border border-adam-neutral-700 bg-adam-background-1 p-3"
    >
      <div className="text-xs font-medium text-adam-neutral-100">
        {mode === 'create' ? 'Add model' : 'Edit model'}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-adam-neutral-300">
            Model ID
          </label>
          <Input
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            disabled={mode === 'edit'}
            required
            className="h-8 text-xs text-adam-neutral-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-adam-neutral-300">
            Display name
          </label>
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            className="h-8 text-xs text-adam-neutral-50"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-adam-neutral-300">
          Description
        </label>
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          className="text-xs text-adam-neutral-50"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          ['Tools', supportsTools, setSupportsTools],
          ['Thinking', supportsThinking, setSupportsThinking],
          ['Vision', supportsVision, setSupportsVision],
        ].map(([label, checked, setter]) => (
          <label
            key={label as string}
            className="flex items-center gap-2 text-xs text-adam-neutral-200"
          >
            <Switch
              checked={checked as boolean}
              onCheckedChange={setter as (value: boolean) => void}
            />
            {label as string}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-adam-neutral-300">
            Context limit
          </label>
          <Input
            type="number"
            value={contextLimit}
            onChange={(event) => setContextLimit(event.target.value)}
            className="h-8 text-xs text-adam-neutral-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-adam-neutral-300">
            Output limit
          </label>
          <Input
            type="number"
            value={outputLimit}
            onChange={(event) => setOutputLimit(event.target.value)}
            className="h-8 text-xs text-adam-neutral-50"
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-adam-neutral-200">
          <Switch checked={isVisible} onCheckedChange={setIsVisible} /> Enabled
        </label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="dark"
            size="sm"
            onClick={onCancel}
            className="h-7 rounded-full px-2 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={
              busy ||
              !displayName.trim() ||
              (mode === 'create' && !modelId.trim())
            }
            className="h-7 rounded-full px-2 text-xs"
          >
            {busy && (
              <ActivityIndicator
                className="mr-1"
                label="Saving provider model"
                size="sm"
              />
            )}
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

function ProviderModelsPanel({
  providerId,
  onClose,
}: {
  providerId: string;
  onClose: () => void;
}) {
  const modelsQuery = useProviderModels(providerId);
  const createMutation = useCreateProviderModel();
  const updateMutation = useUpdateProviderModel();
  const deleteMutation = useDeleteProviderModel();
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const editingModel = modelsQuery.data?.find(
    (model) => model.id === editingRowId,
  );

  const save = (input: CreateProviderModelInput | UpdateProviderModelInput) => {
    if (formMode === 'edit' && editingRowId) {
      updateMutation.mutate({
        providerId,
        modelRowId: editingRowId,
        input: input as UpdateProviderModelInput,
      });
    } else {
      createMutation.mutate({
        providerId,
        input: input as CreateProviderModelInput,
      });
    }
    setFormMode(null);
    setEditingRowId(null);
  };

  return (
    <div className="mt-4 rounded-lg border border-adam-neutral-700 bg-adam-background-2 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-adam-neutral-100">
          Provider models ({modelsQuery.data?.length ?? 0})
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="dark"
            onClick={() => {
              setFormMode('create');
              setEditingRowId(null);
            }}
            className="h-7 rounded-full px-2 text-xs"
          >
            <Plus className="mr-1 h-3 w-3" /> Add model
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="h-7 rounded-full px-2 text-xs text-adam-neutral-200"
          >
            Close
          </Button>
        </div>
      </div>

      {formMode && (
        <ProviderModelForm
          key={`${formMode}:${editingRowId ?? 'new'}`}
          mode={formMode}
          initialData={editingModel}
          onSave={save}
          onCancel={() => {
            setFormMode(null);
            setEditingRowId(null);
          }}
          busy={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {modelsQuery.isLoading ? (
        <div className="flex justify-center py-4">
          <ActivityIndicator label="Loading provider models" size="sm" />
        </div>
      ) : (
        <div className="space-y-2">
          {(modelsQuery.data ?? []).map((model) => (
            <div
              key={model.id}
              className={cn(
                'rounded-md border border-adam-neutral-700 bg-adam-background-1 px-3 py-2',
                !model.isVisible && 'opacity-50',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-all font-mono text-xs text-adam-neutral-100">
                    {model.modelId}
                  </div>
                  <div className="text-xs text-adam-neutral-300">
                    {model.displayName}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {model.supportsTools && (
                      <Badge variant="outline">Tools</Badge>
                    )}
                    {model.supportsThinking && (
                      <Badge variant="outline">Thinking</Badge>
                    )}
                    {model.supportsVision && (
                      <Badge variant="outline">Vision</Badge>
                    )}
                    {model.contextLimit && (
                      <span className="text-[11px] text-adam-neutral-400">
                        {model.contextLimit.toLocaleString()} ctx
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingRowId(model.id);
                      setFormMode('edit');
                    }}
                    className="h-7 px-2 text-xs text-adam-neutral-200"
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (window.confirm('Delete this model?')) {
                        deleteMutation.mutate({
                          providerId,
                          modelRowId: model.id,
                        });
                      }
                    }}
                    className="text-adam-red-400 h-7 px-2"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {(modelsQuery.data ?? []).length === 0 && (
            <div className="rounded-md border border-dashed border-adam-neutral-700 px-3 py-4 text-center text-xs text-adam-neutral-300">
              No models configured for this provider.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ProvidersSettings() {
  const providersQuery = useProviders();
  const builtinQuery = useBuiltinProviders();
  const runtimeQuery = useRuntimeIntegrations();
  const createMutation = useCreateProvider();
  const updateMutation = useUpdateProvider();
  const deleteMutation = useDeleteProvider();
  const builtinMutation = useSaveBuiltinProvider();

  const [editingBuiltin, setEditingBuiltin] = useState<ProviderDriver | null>(
    null,
  );
  const [customFormMode, setCustomFormMode] = useState<
    'create' | 'edit' | null
  >(null);
  const [editingCustom, setEditingCustom] = useState<ProviderDetail | null>(
    null,
  );
  const [modelProviderId, setModelProviderId] = useState<string | null>(null);

  const providers = providersQuery.data ?? [];
  const customProviders = providers.filter(
    (provider) => !provider.slug.startsWith(BUILTIN_SLUG_PREFIX),
  );
  const builtinProviders = builtinQuery.data ?? [];
  const editedBuiltin = builtinProviders.find(
    (provider) => provider.driver === editingBuiltin,
  );

  const saveCustom = (input: CreateProviderInput | UpdateProviderInput) => {
    if (customFormMode === 'edit' && editingCustom) {
      updateMutation.mutate({
        providerId: editingCustom.id,
        input: input as UpdateProviderInput,
      });
    } else {
      createMutation.mutate(input as CreateProviderInput);
    }
    setCustomFormMode(null);
    setEditingCustom(null);
  };

  const resetBuiltin = useCallback(
    (driver: ProviderDriver) => {
      builtinMutation.mutate({ driver, reset: true });
      setEditingBuiltin(null);
    },
    [builtinMutation],
  );

  if (providersQuery.isLoading || builtinQuery.isLoading) {
    return (
      <section className="rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-4 sm:p-6">
        <h2 className="mb-5 text-sm font-medium text-adam-neutral-50">
          Providers
        </h2>
        <div className="flex justify-center py-8">
          <ActivityIndicator label="Loading providers" />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-4 text-adam-neutral-100 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-adam-neutral-50">
            Providers
          </h2>
          <p className="mt-1 text-xs text-adam-neutral-300">
            Configure endpoints, credentials, availability and custom model
            metadata from one place.
          </p>
        </div>
        <Button
          size="sm"
          variant="dark"
          onClick={() => {
            setEditingCustom(null);
            setCustomFormMode('create');
          }}
          disabled={customFormMode !== null}
          className="h-8 rounded-full px-3 text-xs text-adam-neutral-100"
        >
          <Plus className="mr-1 h-3 w-3" /> Add provider
        </Button>
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-adam-neutral-200">
          <Settings2 className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold">Built-in providers</span>
        </div>
        {builtinQuery.isError ? (
          <div className="border-adam-red-400/30 bg-adam-red-400/5 text-adam-red-300 rounded-md border px-3 py-2 text-xs">
            Failed to load built-in provider settings.
          </div>
        ) : (
          <div className="space-y-2">
            {builtinProviders.map((provider) => (
              <div key={provider.driver}>
                <BuiltinProviderCard
                  provider={provider}
                  busy={builtinMutation.isPending}
                  onEdit={() => setEditingBuiltin(provider.driver)}
                  onToggle={() =>
                    builtinMutation.mutate({
                      driver: provider.driver,
                      enabled: !provider.enabled,
                      baseUrl: provider.baseUrl,
                    })
                  }
                  onReset={() => resetBuiltin(provider.driver)}
                />
                {editedBuiltin?.driver === provider.driver && (
                  <BuiltinProviderForm
                    key={`${provider.driver}:${provider.overrideId ?? 'default'}`}
                    provider={provider}
                    busy={builtinMutation.isPending}
                    onSave={(input) => {
                      builtinMutation.mutate(input);
                      setEditingBuiltin(null);
                    }}
                    onReset={() => resetBuiltin(provider.driver)}
                    onCancel={() => setEditingBuiltin(null)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-adam-neutral-200">
          <Network className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold">Runtime integrations</span>
        </div>
        {runtimeQuery.isLoading ? (
          <div className="flex items-center gap-2 py-3 text-xs text-adam-neutral-300">
            <ActivityIndicator label="Discovering runtimes" size="sm" />
            Discovering runtimes…
          </div>
        ) : runtimeQuery.isError ? (
          <div className="border-adam-amber/30 bg-adam-amber/5 text-adam-amber rounded-md border px-3 py-2 text-xs">
            Failed to discover runtime integrations.
          </div>
        ) : (
          <div className="space-y-2">
            {(runtimeQuery.data ?? []).map((integration) => (
              <RuntimeIntegrationCard
                key={integration.integrationId}
                integration={integration}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-adam-neutral-800 pt-5">
        <div className="mb-3 flex items-center gap-2 text-adam-neutral-200">
          <Plug className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold">Custom providers</span>
        </div>

        {customFormMode && (
          <div className="mb-4">
            <ProviderForm
              key={`${customFormMode}:${editingCustom?.id ?? 'new'}`}
              mode={customFormMode}
              initialData={editingCustom ?? undefined}
              onSave={saveCustom}
              onCancel={() => {
                setCustomFormMode(null);
                setEditingCustom(null);
              }}
              busy={createMutation.isPending || updateMutation.isPending}
            />
          </div>
        )}

        {customProviders.length > 0 ? (
          <div className="space-y-2">
            {customProviders.map((provider) => (
              <CustomProviderCard
                key={provider.id}
                summary={provider}
                onEdit={(detail) => {
                  setEditingCustom(detail);
                  setCustomFormMode('edit');
                }}
                onDelete={(providerId) => {
                  if (window.confirm('Delete this provider and its models?')) {
                    deleteMutation.mutate(providerId);
                    if (modelProviderId === providerId)
                      setModelProviderId(null);
                  }
                }}
                onManageModels={(providerId) =>
                  setModelProviderId((current) =>
                    current === providerId ? null : providerId,
                  )
                }
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-adam-neutral-700 bg-adam-background-1/50 px-4 py-7 text-center">
            <Plug className="mx-auto mb-2 h-5 w-5 text-adam-neutral-300" />
            <div className="text-sm text-adam-neutral-200">
              No custom providers configured
            </div>
            <div className="mt-1 text-xs text-adam-neutral-400">
              Add a provider to connect another API or local OpenAI-compatible
              endpoint.
            </div>
          </div>
        )}

        {modelProviderId && (
          <ProviderModelsPanel
            providerId={modelProviderId}
            onClose={() => setModelProviderId(null)}
          />
        )}
      </div>
    </section>
  );
}
