/**
 * OpenCode and Codex are coding agents, not native AI SDK providers. This
 * adapter runs either CLI in a stable working directory and turns its final
 * OpenSCAD answer into Brepia's existing build_parametric_model tool call.
 *
 * Both CLIs persist their own sessions. Brepia carries the discovered external
 * session ID forward inside the persisted tool-call ID, so the next turn can
 * resume the same agent session without adding database schema or server-local
 * state. This also survives a Brepia restart because tool-call IDs are stored in
 * the conversation branch.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import {
  getAiRuntimeLimitDefinition,
  loadBundledInstruction,
} from '@shared/aiInstructionCatalog';
import { env } from './env';
import {
  normalizeOpenScadProject,
  type OpenScadProject,
  type OpenScadProjectAsset,
} from '@shared/openScadProject';
import type { BrepProject } from '@shared/brepProject';
import {
  reconcileOpenScadProjectAssetManifest,
  resolveOpenScadAttachmentAssets,
} from '@shared/openScadProjectAssetReconciliation';
import {
  buildAgentOutputContract,
  buildExternalBrepRepairPrompt,
  externalBrepResultRepairDiagnostic,
  parseAgentResult,
  type AgentParametricSourceKind,
  type AgentResult,
} from './opencodeAgentResult';
import { openCodeAgentForSourceKind } from './opencodeAgentRouting';
import { logWarning } from './serverLog';

const CLI_AGENT_WORKDIR = join(tmpdir(), 'brepia-cli-agent');
const OPEN_CODE_WORKDIR = process.cwd();
const SESSION_MARKER_PREFIX = 'cli-agent-session';

const USAGE = (): LanguageModelV3Usage => ({
  inputTokens: {
    total: 0,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 0,
    text: undefined,
    reasoning: undefined,
  },
});

function finishReason(
  unified: LanguageModelV3FinishReason['unified'],
): LanguageModelV3FinishReason {
  return { unified, raw: unified };
}

type AgentKind = 'opencode' | 'codex';

export type CliAgentModel = {
  id: string;
  name: string;
  description: string;
  provider: 'OpenCode Agent' | 'Codex Agent';
  supportsTools: true;
  supportsThinking: false;
  supportsVision: false;
};

export function isCliAgentModel(modelId: string): boolean {
  return (
    modelId.startsWith('agent/opencode/') || modelId.startsWith('agent/codex/')
  );
}

export function opencodeAgentUnderlyingModelId(
  modelId: string,
): string | undefined {
  if (modelId.startsWith('agent/opencode/')) {
    return modelId.slice('agent/opencode/'.length);
  }
  if (modelId.startsWith('opencode/')) {
    return modelId;
  }
  return undefined;
}

export type ChatTransport =
  | { kind: 'cli-agent' }
  | { kind: 'streaming-opencode'; underlyingModelId: string }
  | { kind: 'normal' };

export function selectChatTransport(
  modelId: string,
  executionMode: 'cli' | 'streaming',
): ChatTransport {
  if (modelId.startsWith('agent/codex/')) return { kind: 'cli-agent' };
  const underlying = opencodeAgentUnderlyingModelId(modelId);
  if (underlying === undefined) return { kind: 'normal' };
  if (executionMode === 'streaming') {
    return { kind: 'streaming-opencode', underlyingModelId: underlying };
  }
  return modelId.startsWith('agent/opencode/')
    ? { kind: 'cli-agent' }
    : { kind: 'normal' };
}

function parseModelId(modelId: string): { agent: AgentKind; model: string } {
  const match = /^agent\/(opencode|codex)\/(.+)$/.exec(modelId);
  if (!match) throw new Error(`Unsupported CLI agent model ${modelId}`);
  return { agent: match[1] as AgentKind, model: match[2] };
}

function displayName(id: string): string {
  return id
    .split(/[-_.]/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

export function configuredCodexModels(): CliAgentModel[] {
  const configured = env('CODEX_MODELS')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  const ids = [...new Set(['default', ...configured])];
  return ids.map((model) => ({
    id: `agent/codex/${model}`,
    name:
      model === 'default' ? 'Codex (default)' : `Codex · ${displayName(model)}`,
    description:
      model === 'default'
        ? 'Uses the model selected in the local Codex profile'
        : 'Configured Codex CLI model',
    provider: 'Codex Agent',
    supportsTools: true,
    supportsThinking: false,
    supportsVision: false,
  }));
}

async function ensureCliAgentWorkdir(): Promise<string> {
  await mkdir(CLI_AGENT_WORKDIR, { recursive: true });
  return CLI_AGENT_WORKDIR;
}

function bundledCliTimeoutMs(): number {
  const definition = getAiRuntimeLimitDefinition('transport.cliTimeoutMs');
  if (!definition || typeof definition.defaultValue !== 'number') {
    throw new Error('Missing transport.cliTimeoutMs runtime definition');
  }
  return definition.defaultValue;
}

function bundledCliValidationAttempts(): number {
  const definition = getAiRuntimeLimitDefinition(
    'transport.openCodeValidationAttempts',
  );
  if (!definition || typeof definition.defaultValue !== 'number') {
    throw new Error(
      'Missing transport.openCodeValidationAttempts runtime definition',
    );
  }
  return definition.defaultValue;
}

function runCli(
  bin: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const fail = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new Error(`${bin} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    const abort = () => {
      child.kill('SIGKILL');
      fail(new Error(`${bin} request was cancelled`));
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) => fail(error));
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(`${bin} exited ${code}: ${stderr.trim().slice(0, 500)}`),
        );
    });
    child.stdin.end(input);
  });
}

type ParsedCliOutput = {
  text: string;
  sessionId?: string;
};

export function parseOpenCodeCliOutput(
  stdout: string,
  stderr = '',
): ParsedCliOutput {
  let text = '';
  let sessionId: string | undefined;
  for (const line of stdout.split('\n')) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        sessionID?: string;
        sessionId?: string;
        part?: { type?: string; text?: string; sessionID?: string };
      };
      const eventSessionId =
        typeof event.sessionID === 'string'
          ? event.sessionID
          : typeof event.sessionId === 'string'
            ? event.sessionId
            : typeof event.part?.sessionID === 'string'
              ? event.part.sessionID
              : undefined;
      if (eventSessionId?.startsWith('ses')) sessionId = eventSessionId;
      if (event.type === 'text' && event.part?.type === 'text') {
        text = event.part.text ?? text;
      }
    } catch {
      // OpenCode can write informational non-JSON lines; they are not output.
    }
  }

  if (!sessionId) {
    const stderrMatch = /\bsession:\s*(ses_[A-Za-z0-9_-]+)/i.exec(stderr);
    if (stderrMatch) sessionId = stderrMatch[1];
  }

  return { text, sessionId };
}

export function parseCodexCliOutput(stdout: string): ParsedCliOutput {
  let text = '';
  let sessionId: string | undefined;
  for (const line of stdout.split('\n')) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        thread_id?: string;
        item?: { type?: string; text?: string };
      };
      if (
        event.type === 'thread.started' &&
        typeof event.thread_id === 'string'
      ) {
        sessionId = event.thread_id;
      }
      if (
        event.type === 'item.completed' &&
        event.item?.type === 'agent_message'
      ) {
        text = event.item.text ?? text;
      }
    } catch {
      // Codex --json is JSONL, but keep the parser defensive.
    }
  }
  return { text, sessionId };
}

function promptTextParts(message: LanguageModelV3Prompt[number]): string[] {
  const parts = Array.isArray(message.content)
    ? message.content
    : [message.content];
  return parts.flatMap((part) => {
    if (typeof part === 'string') return [part];
    if (part.type === 'text') return [part.text];
    return [];
  });
}

type ParametricArtifactSnapshot = {
  title: string;
  version: string;
  project: OpenScadProject;
};

function parseArtifactInput(
  value: unknown,
): ParametricArtifactSnapshot | undefined {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
  let project: OpenScadProject;
  try {
    project = normalizeOpenScadProject(record['project'] as OpenScadProject);
  } catch {
    return undefined;
  }
  return {
    title:
      typeof record['title'] === 'string' && record['title'].trim()
        ? record['title'].trim()
        : 'Current Brepia model',
    version:
      typeof record['version'] === 'string' && record['version'].trim()
        ? record['version'].trim()
        : 'v1',
    project,
  };
}

function currentArtifact(
  prompt: LanguageModelV3Prompt,
): ParametricArtifactSnapshot | undefined {
  for (
    let messageIndex = prompt.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = prompt[messageIndex];
    const parts = Array.isArray(message.content)
      ? message.content
      : [message.content];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (!part || typeof part !== 'object') continue;
      const record = part as unknown as Record<string, unknown>;
      if (
        record['type'] !== 'tool-call' ||
        record['toolName'] !== 'build_parametric_model'
      ) {
        continue;
      }
      const artifact = parseArtifactInput(record['input']);
      if (artifact) return artifact;
    }
  }
  return undefined;
}

function toolOutputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  if (record['type'] === 'text') {
    if (typeof record['value'] === 'string') return record['value'];
    if (typeof record['text'] === 'string') return record['text'];
  }
  if (record['type'] === 'content' && Array.isArray(record['value'])) {
    return record['value']
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
        const content = item as Record<string, unknown>;
        return content['type'] === 'text' && typeof content['text'] === 'string'
          ? content['text']
          : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof record['value'] === 'string') return record['value'];
  if (typeof record['text'] === 'string') return record['text'];
  return '';
}

function latestBuildResult(
  prompt: LanguageModelV3Prompt,
  sourceKind: AgentParametricSourceKind,
): string {
  for (
    let messageIndex = prompt.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = prompt[messageIndex];
    const parts = Array.isArray(message.content)
      ? message.content
      : [message.content];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (!part || typeof part !== 'object') continue;
      const record = part as unknown as Record<string, unknown>;
      if (
        record['type'] !== 'tool-result' ||
        record['toolName'] !==
          (sourceKind === 'brep'
            ? 'build_brep_project'
            : 'build_parametric_model')
      ) {
        continue;
      }
      const text = toolOutputText(record['output']).trim();
      if (text) return text;
    }
  }
  return '';
}

function latestUserText(prompt: LanguageModelV3Prompt): string {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    if (prompt[index].role !== 'user') continue;
    return promptTextParts(prompt[index]).join('\n').trim();
  }
  return '';
}

function systemText(prompt: LanguageModelV3Prompt): string {
  return prompt
    .filter((message) => message.role === 'system')
    .flatMap((message) => promptTextParts(message))
    .join('\n\n')
    .trim();
}

export function buildPersistentCliAgentPrompt(
  prompt: LanguageModelV3Prompt,
  sessionExists: boolean,
  transportInstruction = '',
  context: {
    sourceKind?: AgentParametricSourceKind;
    currentBrepProject?: BrepProject;
  } = {},
): string {
  const lines: string[] = [];
  const sourceKind = context.sourceKind ?? 'openscad';

  if (transportInstruction.trim()) {
    lines.push(
      `<brepia_transport_instructions>\n${transportInstruction.trim()}\n</brepia_transport_instructions>`,
    );
  }

  if (!sessionExists) {
    const system = systemText(prompt);
    if (system) {
      lines.push(
        `<brepia_system_context>\n${system}\n</brepia_system_context>`,
      );
    }
  }

  const artifact =
    sourceKind === 'openscad' ? currentArtifact(prompt) : undefined;
  if (artifact) {
    lines.push(
      [
        '<current_brepia_artifact>',
        JSON.stringify({
          title: artifact.title,
          version: artifact.version,
          project: artifact.project,
        }),
        '</current_brepia_artifact>',
      ].join('\n'),
    );
  }
  if (sourceKind === 'brep' && context.currentBrepProject) {
    lines.push(
      `<current_brep_project>\n${JSON.stringify(context.currentBrepProject)}\n</current_brep_project>`,
    );
  }

  const userText = latestUserText(prompt);
  const buildResult = latestBuildResult(prompt, sourceKind);
  const isBuildContinuation =
    prompt[prompt.length - 1]?.role === 'tool' && Boolean(buildResult);

  if (isBuildContinuation) {
    if (userText) {
      lines.push(`<task_context>\n${userText}\n</task_context>`);
    }
    lines.push(`<brepia_build_result>\n${buildResult}\n</brepia_build_result>`);
  } else if (userText) {
    lines.push(`<user_request>\n${userText}\n</user_request>`);
  } else {
    lines.push('<brepia_continuation />');
  }

  return lines.join('\n\n');
}

export function encodeCliAgentSessionToolCallId(
  agent: AgentKind,
  sessionId: string | undefined,
): string {
  if (!sessionId) return `cli-agent-${crypto.randomUUID()}`;
  const encoded = Buffer.from(sessionId, 'utf8').toString('base64url');
  return `${SESSION_MARKER_PREFIX}.${agent}.${encoded}.${crypto.randomUUID()}`;
}

function sessionIdFromToolCallId(
  agent: AgentKind,
  toolCallId: string,
): string | undefined {
  const [prefix, encodedAgent, encodedSession] = toolCallId.split('.', 4);
  if (
    prefix !== SESSION_MARKER_PREFIX ||
    encodedAgent !== agent ||
    !encodedSession
  ) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(encodedSession, 'base64url').toString('utf8');
    if (agent === 'opencode') {
      return decoded.startsWith('ses') ? decoded : undefined;
    }
    return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export function cliAgentSessionIdFromPrompt(
  agent: AgentKind,
  prompt: LanguageModelV3Prompt,
): string | undefined {
  for (
    let messageIndex = prompt.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = prompt[messageIndex];
    const parts = Array.isArray(message.content)
      ? message.content
      : [message.content];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (!part || typeof part !== 'object') continue;
      const toolCallId = (part as unknown as Record<string, unknown>)[
        'toolCallId'
      ];
      if (typeof toolCallId !== 'string') continue;
      const sessionId = sessionIdFromToolCallId(agent, toolCallId);
      if (sessionId) return sessionId;
    }
  }
  return undefined;
}

export function buildCliAgentArgs(
  agent: AgentKind,
  model: string,
  sessionId?: string,
  sourceKind: AgentParametricSourceKind = 'openscad',
): string[] {
  if (agent === 'opencode') {
    return [
      'run',
      '--format',
      'json',
      '--agent',
      openCodeAgentForSourceKind(sourceKind),
      '-m',
      model,
      ...(sessionId ? ['--session', sessionId] : []),
    ];
  }

  const common = [
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--json',
    ...(model === 'default' ? [] : ['-m', model]),
    '-',
  ];
  return sessionId
    ? ['exec', 'resume', sessionId, ...common]
    : ['exec', ...common];
}

export function buildCliAgentInstruction(
  _agent: AgentKind,
  prompt: string,
  sourceKind: AgentParametricSourceKind = 'openscad',
): string {
  return `${prompt}\n\n${buildAgentOutputContract(sourceKind)}`;
}

function isMissingSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /resource not found|session[^\n]*(?:not found|does not exist|unknown)|thread[^\n]*(?:not found|does not exist|unknown)|rollout[^\n]*not found/i.test(
    message,
  );
}

type AgentInvocation = {
  result: AgentResult<OpenScadProject | BrepProject>;
  sessionId?: string;
  reused: boolean;
};

async function invokeAgent(
  agent: AgentKind,
  model: string,
  prompt: string,
  timeoutMs: number,
  validationAttempts: number,
  requireBrepProject: boolean,
  existingSessionId?: string,
  signal?: AbortSignal,
  sourceKind: AgentParametricSourceKind = 'openscad',
): Promise<AgentInvocation> {
  const dir =
    agent === 'opencode' ? OPEN_CODE_WORKDIR : await ensureCliAgentWorkdir();
  const instruction = buildCliAgentInstruction(agent, prompt, sourceKind);

  const runOnce = async (sessionId?: string, input = instruction) => {
    const cliResult = await runCli(
      agent,
      buildCliAgentArgs(agent, model, sessionId, sourceKind),
      input,
      dir,
      timeoutMs,
      signal,
    );
    const parsed =
      agent === 'opencode'
        ? parseOpenCodeCliOutput(cliResult.stdout, cliResult.stderr)
        : parseCodexCliOutput(cliResult.stdout);
    if (!parsed.text) {
      throw new Error(
        `${agent} returned no final response: ${cliResult.stderr.slice(0, 300)}`,
      );
    }
    return parsed;
  };

  let parsed: ParsedCliOutput;
  let reused = Boolean(existingSessionId);
  try {
    parsed = await runOnce(existingSessionId);
  } catch (error) {
    if (!existingSessionId || !isMissingSessionError(error)) throw error;
    logWarning(
      `${agent} session ${existingSessionId} no longer exists; starting a replacement session`,
      { functionName: 'cli-agent-session-resume' },
    );
    parsed = await runOnce();
    reused = false;
  }

  let sessionId = parsed.sessionId ?? existingSessionId;
  let result = parseAgentResult(parsed.text, sourceKind);
  let brepValidationAttempt = 0;

  if (sourceKind === 'brep') {
    while (!result.project) {
      const diagnostic = externalBrepResultRepairDiagnostic(parsed.text, {
        requireProject: requireBrepProject,
      });
      if (!diagnostic) break;

      brepValidationAttempt += 1;
      if (brepValidationAttempt >= validationAttempts) {
        result = {
          message: `Native BRep validation failed after ${validationAttempts} attempts: ${diagnostic}`,
        };
        break;
      }
      if (!sessionId) {
        result = {
          message: `Native BRep validation failed and ${agent} exposed no resumable session for repair: ${diagnostic}`,
        };
        break;
      }

      console.info('cli agent native BRep repair', {
        agent,
        model,
        sessionId,
        attempt: brepValidationAttempt,
        maxAttempts: validationAttempts,
        diagnostic,
      });
      const repairPrompt = buildExternalBrepRepairPrompt({
        diagnostic,
        attempt: brepValidationAttempt,
        maxAttempts: validationAttempts,
      });
      parsed = await runOnce(sessionId, repairPrompt);
      sessionId = parsed.sessionId ?? sessionId;
      result = parseAgentResult(parsed.text, sourceKind);
    }
  }

  if (!sessionId) {
    logWarning(`${agent} CLI did not expose a resumable session ID`, {
      functionName: 'cli-agent-session-id',
    });
  }

  console.info('cli agent session', {
    agent,
    model,
    sessionId,
    reused,
    ...(sourceKind === 'brep'
      ? { brepValidationAttempts: brepValidationAttempt }
      : {}),
  });

  return {
    result,
    sessionId,
    reused,
  };
}

export function cliAgentChatModel(
  appModelId: string,
  options: {
    transportInstruction?: string;
    timeoutMs?: number;
    validationAttempts?: number;
    authoritativeAssets?: readonly OpenScadProjectAsset[];
    sourceKind?: AgentParametricSourceKind;
    currentBrepProject?: BrepProject;
  } = {},
): LanguageModelV3 {
  const { agent, model } = parseModelId(appModelId);
  const transportInstruction =
    options.transportInstruction ??
    loadBundledInstruction(
      agent === 'opencode' ? 'transport.opencode' : 'transport.codex',
    );
  const timeoutMs = options.timeoutMs ?? bundledCliTimeoutMs();
  const validationAttempts =
    options.validationAttempts ?? bundledCliValidationAttempts();
  const sourceKind = options.sourceKind ?? 'openscad';

  return {
    specificationVersion: 'v3',
    provider: `${agent}-cli`,
    modelId: appModelId,
    supportedUrls: {},
    async doStream(optionsForCall: LanguageModelV3CallOptions) {
      const existingSessionId = cliAgentSessionIdFromPrompt(
        agent,
        optionsForCall.prompt,
      );
      const invocation = await invokeAgent(
        agent,
        model,
        buildPersistentCliAgentPrompt(
          optionsForCall.prompt,
          Boolean(existingSessionId),
          transportInstruction,
          { sourceKind, currentBrepProject: options.currentBrepProject },
        ),
        timeoutMs,
        validationAttempts,
        sourceKind === 'brep' && !options.currentBrepProject,
        existingSessionId,
        optionsForCall.abortSignal,
        sourceKind,
      );
      let result = invocation.result;
      if (sourceKind === 'openscad' && result.project) {
        const currentAssets =
          currentArtifact(optionsForCall.prompt)?.project.assets ?? [];
        const authoritativeAssets = [
          ...currentAssets,
          ...(options.authoritativeAssets ?? []),
        ];
        const attachmentAssets = resolveOpenScadAttachmentAssets(
          result.project as OpenScadProject,
          authoritativeAssets,
        );
        result = {
          ...result,
          project: reconcileOpenScadProjectAssetManifest(
            result.project as OpenScadProject,
            [...authoritativeAssets, ...attachmentAssets],
          ),
        };
      }

      const parts: LanguageModelV3StreamPart[] = [
        { type: 'stream-start', warnings: [] },
      ];
      if (result.project) {
        parts.push({
          type: 'tool-call',
          toolCallId: encodeCliAgentSessionToolCallId(
            agent,
            invocation.sessionId,
          ),
          toolName:
            sourceKind === 'brep'
              ? 'build_brep_project'
              : 'build_parametric_model',
          input: JSON.stringify({
            title:
              sourceKind === 'brep'
                ? (result.project as BrepProject).name
                : 'Generated model',
            version: 'v1',
            project: result.project,
            ...(sourceKind === 'openscad'
              ? { message: result.message || 'Model generated.' }
              : {}),
          }),
        });
      } else if (result.message) {
        const textId = 'cli-agent-text';
        parts.push(
          { type: 'text-start', id: textId },
          {
            type: 'text-delta',
            id: textId,
            delta: result.message,
          },
          { type: 'text-end', id: textId },
        );
      }
      parts.push({
        type: 'finish',
        finishReason: finishReason(result.project ? 'tool-calls' : 'stop'),
        usage: USAGE(),
      });
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      });
      return {
        stream,
        request: {},
        response: {},
      };
    },
    async doGenerate(optionsForCall) {
      const result = await this.doStream(optionsForCall);
      const content: LanguageModelV3Content[] = [];
      let finalReason = finishReason('stop');
      let usage = USAGE();
      const reader = result.stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === 'tool-call') {
            content.push({
              type: 'tool-call',
              toolCallId: value.toolCallId,
              toolName: value.toolName,
              input: value.input,
            });
          }
          if (value.type === 'text-delta') {
            content.push({ type: 'text', text: value.delta });
          }
          if (value.type === 'finish') {
            finalReason = value.finishReason;
            usage = value.usage;
          }
        }
      } finally {
        reader.releaseLock();
      }
      return {
        content,
        finishReason: finalReason,
        usage,
        request: {},
        response: { modelId: appModelId },
        warnings: [],
      };
    },
  };
}
