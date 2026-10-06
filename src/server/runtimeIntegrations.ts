/**
 * Runtime integrations discovery.
 *
 * Reads status from existing Brepia runtime configuration without exposing
 * secrets, API keys, or raw configuration objects.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { opencodeApiUrl, opencodeModels } from './opencode';
import { configuredCodexModels } from './cliAgents';
import {
  discoverLocalModels,
  getLocalRuntimeConfig,
  normalizeLocalOpenAiUrls,
} from './localModels';

const execFileP = promisify(execFile);

function blockUnsafeProtocol(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

export interface RuntimeIntegrationStatus {
  integrationId: 'opencode' | 'codex' | 'local-openai';
  label: string;
  status: 'connected' | 'available' | 'unavailable' | 'not-configured';
  baseUrl: string | null;
  modelCount: number;
  explanation: string;
}

async function discoverOpenCode(): Promise<RuntimeIntegrationStatus> {
  const baseUrl = opencodeApiUrl();
  let modelCount = 0;

  try {
    const models = await opencodeModels();
    modelCount = models.length;
  } catch {
    // OpenCode server/CLI unreachable
  }

  if (modelCount > 0) {
    return {
      integrationId: 'opencode',
      label: 'OpenCode',
      status: 'connected',
      baseUrl,
      modelCount,
      explanation: `OpenCode agent runtime active with ${modelCount} model${modelCount === 1 ? '' : 's'}`,
    };
  }

  try {
    const parsed = new URL(baseUrl);
    if (!blockUnsafeProtocol(parsed)) {
      return {
        integrationId: 'opencode',
        label: 'OpenCode',
        status: 'unavailable',
        baseUrl,
        modelCount: 0,
        explanation: 'OpenCode URL rejected by SSRF protection',
      };
    }
    const res = await fetch(baseUrl, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      return {
        integrationId: 'opencode',
        label: 'OpenCode',
        status: 'available',
        baseUrl,
        modelCount: 0,
        explanation: 'OpenCode server reachable but no models discovered',
      };
    }
  } catch {
    // Unreachable
  }

  return {
    integrationId: 'opencode',
    label: 'OpenCode',
    status: 'unavailable',
    baseUrl,
    modelCount: 0,
    explanation: 'OpenCode agent runtime not responding',
  };
}

async function checkCodexAvailable(): Promise<boolean> {
  try {
    await execFileP('codex', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function discoverCodex(): Promise<RuntimeIntegrationStatus> {
  const available = await checkCodexAvailable();
  const models = configuredCodexModels();
  const modelCount = models.length;

  if (available) {
    return {
      integrationId: 'codex',
      label: 'Codex CLI',
      status: 'connected',
      baseUrl: null,
      modelCount,
      explanation: `Codex CLI available with ${modelCount} model${modelCount === 1 ? '' : 's'}`,
    };
  }

  return {
    integrationId: 'codex',
    label: 'Codex CLI',
    status: 'unavailable',
    baseUrl: null,
    modelCount,
    explanation: 'Codex CLI not found — install to enable',
  };
}

export { configuredCodexModels } from './cliAgents';
export { normalizeLocalOpenAiUrls } from './localModels';

async function discoverLocalOpenAI(
  userId: string,
): Promise<RuntimeIntegrationStatus> {
  let runtime;
  try {
    runtime = await getLocalRuntimeConfig(userId);
  } catch {
    runtime = null;
  }

  if (!runtime) {
    return {
      integrationId: 'local-openai',
      label: 'Local OpenAI / llama-swap',
      status: 'not-configured',
      baseUrl: null,
      modelCount: 0,
      explanation: 'No Local OpenAI / llama-swap endpoint is configured',
    };
  }

  const { baseUrl, rootUrl } = normalizeLocalOpenAiUrls(runtime.baseUrl);
  if (!runtime.enabled) {
    return {
      integrationId: 'local-openai',
      label: 'Local OpenAI / llama-swap',
      status: 'not-configured',
      baseUrl,
      modelCount: 0,
      explanation: 'Local OpenAI / llama-swap is disabled in AI Settings',
    };
  }

  try {
    const parsed = new URL(baseUrl);
    if (!blockUnsafeProtocol(parsed)) {
      return {
        integrationId: 'local-openai',
        label: 'Local OpenAI / llama-swap',
        status: 'unavailable',
        baseUrl,
        modelCount: 0,
        explanation: 'Local provider URL rejected by protocol validation',
      };
    }
  } catch {
    return {
      integrationId: 'local-openai',
      label: 'Local OpenAI / llama-swap',
      status: 'unavailable',
      baseUrl,
      modelCount: 0,
      explanation: 'Local provider Base URL is not a valid URL',
    };
  }

  try {
    const models = await discoverLocalModels(userId);
    return {
      integrationId: 'local-openai',
      label: 'Local OpenAI / llama-swap',
      status: 'connected',
      baseUrl,
      modelCount: models.length,
      explanation: `Local OpenAI-compatible server running with ${models.length} model${models.length === 1 ? '' : 's'}`,
    };
  } catch {
    // Models endpoint unavailable; fall back to a root reachability probe.
  }

  try {
    const res = await fetch(rootUrl, {
      headers: { Authorization: `Bearer ${runtime.apiKey}` },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      return {
        integrationId: 'local-openai',
        label: 'Local OpenAI / llama-swap',
        status: 'available',
        baseUrl,
        modelCount: 0,
        explanation:
          'Local runtime responds but the OpenAI /v1/models endpoint is not reachable',
      };
    }
  } catch {
    // Unreachable
  }

  return {
    integrationId: 'local-openai',
    label: 'Local OpenAI / llama-swap',
    status: 'unavailable',
    baseUrl,
    modelCount: 0,
    explanation: 'Local runtime endpoint not responding',
  };
}

export async function discoverRuntimeIntegrations(
  userId: string,
): Promise<RuntimeIntegrationStatus[]> {
  const results = await Promise.allSettled([
    discoverOpenCode(),
    discoverCodex(),
    discoverLocalOpenAI(userId),
  ]);

  return results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
}
