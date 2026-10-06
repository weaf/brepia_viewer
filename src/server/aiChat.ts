import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { chatTools, type AppUIMessage, type AppTools } from '@shared/chatAi';
import {
  resolveActiveBrepAiSource,
  type BrepAiSourceRevision,
} from '@shared/brepAiContext';
import type { BrepAiBuildInput } from '@shared/brepAiTool';
import {
  isAiInstructionProfileId,
  loadBundledInstruction,
  renderInstructionTemplate,
} from '@shared/aiInstructionCatalog';
import {
  cleanAssistantText,
  isParametricArtifact,
} from '@shared/parametricParts';
import {
  normalizeOpenScadProject,
  type OpenScadProjectAsset,
} from '@shared/openScadProject';
import { imageIdFromFilename, imageStoragePath } from '@shared/imageRefs';
import { normalizeModelId } from '@shared/models';
import {
  opencodeChatModel,
  streamingOpencodeChatModel,
  type OpenCodeRuntimeOptions,
} from '@/server/opencode';
import { buildCustomChatModel } from '@/server/customProviders';
import { isCustomProviderModel } from '@shared/customModelIds';
import type { Conversation, Message, MeshFileType, Model } from '@shared/types';
import {
  convertToModelMessages,
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  hasToolCall,
  smoothStream,
  stepCountIs,
  streamText,
  type LanguageModel,
} from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import imageType from 'image-type';
import { corsHeaders, isRecord } from './api';
import {
  loadBuiltinProviderRuntimeOverrides,
  type BuiltinProviderRuntimeOverrides,
} from './builtinProviderOverrides';
import { env } from './env';
import { logError } from './serverLog';
import { isRequestAbort } from './requestAbort';
import {
  decidePersistAction,
  hasPendingClientToolCall,
  isDanglingToolPart,
  resolveDanglingToolParts,
} from './chatToolPersistence';
import { brepParametricTools } from './brepAiTools';
import {
  parametricBuildToolName,
  withBrepProjectSystemContext,
} from './brepAiTurn';
import { finalizeBrepAiAssistantPartsForRun } from './brepAiFinalizationLifecycle';
import {
  persistBrepAiRevisionAtomically,
  type BrepAiRpcClient,
} from './brepAiPersistence';
import { handleMeshRequest } from './mesh';
import {
  cliAgentChatModel,
  isCliAgentModel,
  selectChatTransport,
} from './cliAgents';
import { getAnonSupabaseClient } from './supabaseClient';
import { resolveConversationSystemPrompt } from './promptProfiles';
import { resolveCreativeAgentModel } from './creativeAgentModel';
import { createUserAiRuntimeContext } from './aiInstructionRuntime';
import { beginActiveGeneration } from './activeGeneration';
import {
  AiGenerationRunLifecycle,
  cancelDurableGenerationRun,
} from './aiGenerationRunLifecycle';
import { cancelConversationGeneration } from './generationCancellation';
import { generationRunKindForConversation } from './generationRunPersistence';
import { resolveAiTurnProvenance } from './aiTurnProvenance';
import { modelSupportsDirectVision, withVisionFallback } from './vision';
import {
  buildAiContextDiagnostics,
  resolveAiModelBudgetMetadata,
} from './aiContextDiagnostics';
import {
  AiContextBudgetError,
  assertAiHardContextBudget,
  deriveAiHardContextBudget,
  estimateModelMessagesForHardBudget,
  type AiHardContextBudget,
} from './aiContextBudget';
import { shouldStopAfterAcceptedBrepBuild } from './aiBrepStopCondition';
import {
  classifyAiToolError,
  measureAiStepContext,
  summarizeAiToolChoice,
  type AiStepContextMeasurement,
  type AiToolErrorClassification,
} from './aiStepDiagnostics';

export const PARAMETRIC_AGENT_PROMPT = loadBundledInstruction('parametric');
export const CREATIVE_AGENT_PROMPT = loadBundledInstruction('creative');

type ChatBody = {
  conversationId: string;
  model: Model;
  agentModel?: Model;
  thinking?: boolean;
  openCodeExecutionMode?: 'cli' | 'streaming';
};

type ChatRequestBody =
  | { kind: 'generate'; body: ChatBody }
  | { kind: 'cancel'; conversationId: string };

type ConversationAccess = Pick<
  Conversation,
  'id' | 'type' | 'user_id' | 'current_message_leaf_id' | 'settings'
>;

function isChatBody(value: unknown): value is ChatBody {
  return (
    isRecord(value) &&
    typeof value.conversationId === 'string' &&
    typeof value.model === 'string' &&
    (value.agentModel == null || typeof value.agentModel === 'string') &&
    (value.thinking == null || typeof value.thinking === 'boolean') &&
    (value.openCodeExecutionMode == null ||
      value.openCodeExecutionMode === 'cli' ||
      value.openCodeExecutionMode === 'streaming')
  );
}

function parseChatRequestBody(value: unknown): ChatRequestBody | null {
  if (
    isRecord(value) &&
    value.action === 'cancel' &&
    typeof value.conversationId === 'string'
  ) {
    return { kind: 'cancel', conversationId: value.conversationId };
  }

  return isChatBody(value) ? { kind: 'generate', body: value } : null;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function collectAuthoritativeOpenScadAssets(
  messages: readonly AppUIMessage[],
): OpenScadProjectAsset[] {
  const assets = new Map<string, OpenScadProjectAsset>();
  const add = (asset: OpenScadProjectAsset) => {
    assets.set(`${asset.storagePath}\n${asset.path}\n${asset.sha256}`, asset);
  };

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'data-mesh-context' && part.data.asset) {
        add(part.data.asset);
        continue;
      }

      if (
        part.type === 'tool-build_parametric_model' &&
        'input' in part &&
        isParametricArtifact(part.input)
      ) {
        try {
          const project = normalizeOpenScadProject(part.input.project);
          for (const asset of project.assets ?? []) add(asset);
        } catch {
          // Invalid historical artifacts cannot grant storage authority.
        }
      }
    }
  }

  return [...assets.values()];
}

type ChatProvider =
  'custom' | 'local' | 'opencode' | 'cli-agent' | 'unsupported';

function providerFor(modelId: string): ChatProvider {
  if (isCustomProviderModel(modelId)) return 'custom';
  if (modelId.startsWith('local/')) return 'local';
  if (modelId.startsWith('opencode/')) return 'opencode';
  if (isCliAgentModel(modelId)) return 'cli-agent';
  return 'unsupported';
}

type LocalProvider = ReturnType<typeof createOpenAICompatible>;

type ChatProviders = {
  local: () => LocalProvider;
};

function createChatProviders(
  overrides: BuiltinProviderRuntimeOverrides = {},
): ChatProviders {
  let local: LocalProvider | undefined;
  return {
    local: () => {
      if (!local) {
        const override = overrides['openai-compatible'];
        if (override?.enabled === false) {
          throw new Error('Local OpenAI provider is disabled in AI Settings');
        }
        local = createOpenAICompatible({
          name: 'local',
          baseURL:
            override?.baseUrl ||
            env('LOCAL_LLM_BASE_URL') ||
            'http://localhost:11434/v1',
          apiKey:
            (override?.credential ?? env('LOCAL_LLM_API_KEY')) || 'ollama',
          includeUsage: true,
        });
      }
      return local;
    },
  };
}

function buildChatModel(
  modelId: string,
  providers: ChatProviders,
  thinking: boolean,
  thinkingBudget: number,
  thinkingBudgetOverridden: boolean,
  openCodeRuntime: OpenCodeRuntimeOptions,
): { model: LanguageModel; providerOptions?: ProviderOptions } {
  const hasCappedThinkingBudget = thinking && thinkingBudgetOverridden;

  if (modelId.startsWith('local/')) {
    const id = modelId.slice('local/'.length);
    return {
      model: providers.local()(id),
      providerOptions: thinking
        ? {
            openai: {
              ...(hasCappedThinkingBudget
                ? { reasoning: { max_tokens: thinkingBudget } }
                : {}),
            },
          }
        : undefined,
    };
  }

  if (modelId.startsWith('opencode/')) {
    return { model: opencodeChatModel(modelId, openCodeRuntime) };
  }

  if (isCliAgentModel(modelId)) {
    throw new Error('CLI agent model reached the normal model builder');
  }

  throw new Error(`Unsupported chat model ${modelId}`);
}

function bareModelId(modelId: string): string {
  const id = modelId.slice(modelId.lastIndexOf('/') + 1);
  return id.replace(/\./g, '-');
}

function rejectsForcedToolChoice(modelId: string): boolean {
  return /^claude-(?:fable|mythos)\b/.test(bareModelId(modelId));
}

function supportsForcedToolChoice(modelId: string): boolean {
  return !rejectsForcedToolChoice(modelId);
}

type SupabaseAnon = ReturnType<typeof getAnonSupabaseClient>;

type BranchMessageRow = Pick<
  Message,
  'id' | 'role' | 'parts' | 'metadata' | 'parent_message_id'
>;

function finalizeStreamingParts(
  parts: AppUIMessage['parts'],
): AppUIMessage['parts'] {
  return parts.map((part) => {
    if (
      (part.type === 'reasoning' || part.type === 'text') &&
      part.state === 'streaming'
    ) {
      return {
        ...part,
        state: 'done' as const,
        ...(part.type === 'text'
          ? { text: cleanAssistantText(part.text) }
          : {}),
      };
    }
    if (part.type === 'text') {
      return { ...part, text: cleanAssistantText(part.text) };
    }
    return part;
  });
}

function dropTextFromParametricBuildMessage(
  parts: AppUIMessage['parts'],
): AppUIMessage['parts'] {
  const hasBuild = parts.some(
    (part) =>
      part.type === 'tool-build_parametric_model' ||
      part.type === 'tool-build_brep_project',
  );
  if (!hasBuild) return parts;

  return parts.filter((part) => part.type !== 'text') as AppUIMessage['parts'];
}

function messageRowToUIMessage(
  row: BranchMessageRow,
  conversationId: string,
): AppUIMessage {
  const rawParts = Array.isArray(row.parts)
    ? (row.parts as AppUIMessage['parts'])
    : [];

  const dangling = rawParts.filter(isDanglingToolPart);
  if (dangling.length > 0) {
    logError(
      new Error(
        `Resolved ${dangling.length} dangling tool call(s) in persisted branch. ` +
          'Expected to be rare (genuine interruptions only) now that the onFinish ' +
          'clobber guard holds — investigate the write path if this is frequent.',
      ),
      {
        functionName: 'ai-chat',
        statusCode: 200,
        conversationId,
        additionalContext: {
          operation: 'resolve_dangling_tool_parts',
          messageId: row.id,
          role: row.role,
          tools: dangling.map((part) => ({
            type: part.type,
            toolCallId: 'toolCallId' in part ? part.toolCallId : undefined,
            state: 'state' in part ? part.state : undefined,
          })),
        },
      },
    );
  }

  return {
    id: row.id,
    role: row.role,
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as AppUIMessage['metadata'])
        : ({} as AppUIMessage['metadata']),
    parts: resolveDanglingToolParts(rawParts),
  };
}

async function loadBranchFromDb({
  supabaseClient,
  conversationId,
  leafId,
}: {
  supabaseClient: SupabaseAnon;
  conversationId: string;
  leafId: string;
}): Promise<{ branch: AppUIMessage[]; leafRole: 'user' | 'assistant' }> {
  const { data: rows, error } = await supabaseClient
    .from('messages')
    .select('id, role, parts, metadata, parent_message_id')
    .eq('conversation_id', conversationId)
    .overrideTypes<BranchMessageRow[]>();

  if (error || !rows) {
    throw new Error('Failed to load conversation messages');
  }

  const byId = new Map<string, BranchMessageRow>();
  for (const row of rows) byId.set(row.id, row);

  const path: BranchMessageRow[] = [];
  const visited = new Set<string>();
  let current = byId.get(leafId);
  while (current) {
    if (visited.has(current.id)) {
      logError(new Error('parent_message_id cycle in loadBranchFromDb'), {
        functionName: 'ai-chat',
        statusCode: 500,
        userId: '',
        conversationId,
        additionalContext: { messageId: current.id },
      });
      break;
    }
    visited.add(current.id);
    path.unshift(current);
    current = current.parent_message_id
      ? byId.get(current.parent_message_id)
      : undefined;
  }

  if (path.length === 0) {
    throw new Error(
      `Leaf ${leafId} not found in conversation ${conversationId}`,
    );
  }

  return {
    branch: path.map((row) => messageRowToUIMessage(row, conversationId)),
    leafRole: path[path.length - 1].role,
  };
}

function creativeTools({
  conversation,
  req,
  model,
  description,
}: {
  conversation: ConversationAccess;
  req: Request;
  model: Model;
  description: string;
}) {
  return {
    create_mesh: {
      ...chatTools.create_mesh,
      description,
      execute: async (input: AppTools['create_mesh']['input']) => {
        const response = await handleMeshRequest(
          new Request(new URL('/api/mesh', req.url), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: req.headers.get('Authorization') ?? '',
            },
            body: JSON.stringify({
              conversationId: conversation.id,
              text: input.text,
              images: input.imageIds,
              mesh: input.meshId,
              model,
              meshTopology: input.meshTopology,
              polygonCount: input.polygonCount,
            }),
            signal: req.signal,
          }),
        );
        const data: {
          id?: string;
          fileType?: MeshFileType;
          error?: unknown;
        } = await response.json();

        if (!response.ok || !data.id || !data.fileType) {
          throw new Error(
            isRecord(data.error) && typeof data.error.message === 'string'
              ? data.error.message
              : 'Mesh generation failed',
          );
        }

        return { id: data.id, fileType: data.fileType };
      },
    },
  };
}

const ACCEPTED_IMAGE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

async function sniffImageMediaType(bytes: Uint8Array): Promise<string | null> {
  const sniffed = (await imageType(bytes))?.mime;
  return sniffed && ACCEPTED_IMAGE_MEDIA_TYPES.has(sniffed) ? sniffed : null;
}

async function downloadAsBase64(
  supabaseClient: SupabaseAnon,
  bucket: string,
  path: string,
): Promise<{ base64: string; mediaType: string } | null> {
  const { data, error } = await supabaseClient.storage
    .from(bucket)
    .download(path);
  if (error || !data) return null;

  const bytes = new Uint8Array(await data.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  const mediaType =
    (await sniffImageMediaType(bytes)) || data.type || 'image/png';
  return { base64: btoa(binary), mediaType };
}

function parametricTools({
  previewPathForToolCall,
  supabaseClient,
  buildDescription,
  answerDescription,
  inspectionOutputTemplate,
}: {
  previewPathForToolCall: (toolCallId: string) => string;
  supabaseClient: SupabaseAnon;
  buildDescription: string;
  answerDescription: string;
  inspectionOutputTemplate: string;
}) {
  return {
    build_parametric_model: {
      ...chatTools.build_parametric_model,
      description: buildDescription,
      async toModelOutput({
        toolCallId,
        output,
      }: {
        toolCallId: string;
        output: AppTools['build_parametric_model']['output'];
      }) {
        const downloaded = await downloadAsBase64(
          supabaseClient,
          'images',
          previewPathForToolCall(toolCallId),
        );
        const views =
          output.inspection?.views.join(', ') ??
          'ISO, FRONT, BACK, LEFT, RIGHT, TOP, BOTTOM';
        const text = renderInstructionTemplate(inspectionOutputTemplate, {
          message: output.message,
          views,
          imageAttached: downloaded ? 'yes' : 'no',
        });

        if (downloaded) {
          return {
            type: 'content' as const,
            value: [
              { type: 'text' as const, text },
              {
                type: 'image-data' as const,
                data: downloaded.base64,
                mediaType: downloaded.mediaType,
              },
            ],
          };
        }

        return { type: 'text' as const, value: text };
      },
    },
    answer_user: {
      ...chatTools.answer_user,
      description: answerDescription,
    },
  };
}

async function pinCreativeAgentModel({
  supabaseClient,
  conversation,
  userId,
  modelId,
}: {
  supabaseClient: SupabaseAnon;
  conversation: ConversationAccess;
  userId: string;
  modelId: Model;
}) {
  const nextSettings = {
    ...(conversation.settings ?? {}),
    creativeAgentModel: modelId,
  };
  const { error } = await supabaseClient
    .from('conversations')
    .update({ settings: nextSettings })
    .eq('id', conversation.id)
    .eq('user_id', userId);

  if (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId,
      conversationId: conversation.id,
      additionalContext: { operation: 'pin_creative_agent_model', modelId },
    });
    return;
  }

  conversation.settings = nextSettings;
}

export async function handleAiChatRequest(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseClient = getAnonSupabaseClient({
    global: {
      headers: { Authorization: req.headers.get('Authorization') ?? '' },
    },
  });
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();

  if (!user?.id) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const parsedBody = parseChatRequestBody(await req.json().catch(() => null));
  if (!parsedBody) {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const conversationId =
    parsedBody.kind === 'cancel'
      ? parsedBody.conversationId
      : parsedBody.body.conversationId;

  const { data: conversation, error: conversationError } = await supabaseClient
    .from('conversations')
    .select('id, type, user_id, current_message_leaf_id, settings')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .single()
    .overrideTypes<ConversationAccess>();

  if (conversationError || !conversation) {
    return jsonResponse({ error: 'Conversation not found' }, 404);
  }

  if (parsedBody.kind === 'cancel') {
    const canceled = await cancelConversationGeneration(
      user.id,
      conversation.id,
    );
    return jsonResponse({ canceled }, 200);
  }

  const rawBody = parsedBody.body;

  if (!conversation.current_message_leaf_id) {
    return jsonResponse(
      { error: 'Conversation has no leaf to generate from' },
      400,
    );
  }

  const executionMode: 'cli' | 'streaming' =
    rawBody.openCodeExecutionMode ??
    conversation.settings?.openCodeExecutionMode ??
    'cli';
  const pinnedInstructionProfileId = isAiInstructionProfileId(
    conversation.settings?.instructionProfileId,
  )
    ? conversation.settings?.instructionProfileId
    : undefined;

  let aiRuntime: Awaited<ReturnType<typeof createUserAiRuntimeContext>>;
  try {
    aiRuntime = await createUserAiRuntimeContext(
      user.id,
      pinnedInstructionProfileId,
    );
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: { operation: 'load_ai_runtime_settings' },
    });
    return jsonResponse(
      { error: 'AI runtime settings could not be loaded' },
      500,
    );
  }

  let resolvedSystemPrompt: string;
  try {
    if (conversation.type === 'creative') {
      const creativePromptProfileId = conversation.settings
        ?.creativePromptProfileId as string | null | undefined;
      resolvedSystemPrompt = await resolveConversationSystemPrompt({
        userId: user.id,
        profileId: creativePromptProfileId,
        scope: 'creative',
        instructionProfileId: aiRuntime.instructionProfileId,
      });
    } else {
      const promptProfileId = conversation.settings?.promptProfileId as
        string | null | undefined;
      resolvedSystemPrompt = await resolveConversationSystemPrompt({
        userId: user.id,
        profileId: promptProfileId,
        scope: 'parametric',
        instructionProfileId: aiRuntime.instructionProfileId,
      });
    }
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: { operation: 'resolve_system_prompt' },
    });
    return jsonResponse(
      { error: 'Failed to resolve conversation system prompt' },
      500,
    );
  }

  let buildToolDescription: string;
  let brepBuildToolDescription: string;
  let answerToolDescription: string;
  let createMeshDescription: string;
  let parametricAttachmentTemplate: string;
  let brepProjectContextTemplate: string;
  let creativeReferenceTemplate: string;
  let meshPreferencesTemplate: string;
  let inspectionOutputTemplate: string;
  let openCodeTransportInstruction: string;
  let codexTransportInstruction: string;
  let openCodeBrepTransportInstruction: string;
  let codexBrepTransportInstruction: string;
  try {
    [
      buildToolDescription,
      brepBuildToolDescription,
      answerToolDescription,
      createMeshDescription,
      parametricAttachmentTemplate,
      brepProjectContextTemplate,
      creativeReferenceTemplate,
      meshPreferencesTemplate,
      inspectionOutputTemplate,
      openCodeTransportInstruction,
      codexTransportInstruction,
      openCodeBrepTransportInstruction,
      codexBrepTransportInstruction,
    ] = await Promise.all([
      aiRuntime.instruction('tool.build_parametric_model'),
      aiRuntime.instruction('tool.build_brep_project'),
      aiRuntime.instruction('tool.answer_user'),
      aiRuntime.instruction('tool.create_mesh'),
      aiRuntime.template('context.parametric_attachment'),
      aiRuntime.template('context.brep_project'),
      aiRuntime.template('context.creative_reference_mesh'),
      aiRuntime.template('context.mesh_preferences'),
      aiRuntime.template('context.parametric_inspection_output'),
      aiRuntime.instruction('transport.opencode'),
      aiRuntime.instruction('transport.codex'),
      aiRuntime.instruction('transport.opencode_brep'),
      aiRuntime.instruction('transport.codex_brep'),
    ]);
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: { operation: 'resolve_auxiliary_instructions' },
    });
    return jsonResponse(
      { error: 'AI instructions could not be resolved' },
      500,
    );
  }

  let branchMessages: AppUIMessage[];
  let leafRole: 'user' | 'assistant';
  try {
    const branchResult = await loadBranchFromDb({
      supabaseClient,
      conversationId: conversation.id,
      leafId: conversation.current_message_leaf_id,
    });
    branchMessages = branchResult.branch;
    leafRole = branchResult.leafRole;
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: { operation: 'load_branch' },
    });
    return jsonResponse({ error: 'Failed to load conversation branch' }, 500);
  }

  let activeBrepSource: BrepAiSourceRevision | undefined;
  if (conversation.type === 'parametric') {
    try {
      activeBrepSource = resolveActiveBrepAiSource(branchMessages);
    } catch (error) {
      logError(error, {
        functionName: 'ai-chat',
        statusCode: 400,
        userId: user.id,
        conversationId: conversation.id,
        additionalContext: { operation: 'resolve_active_brep_source' },
      });
      return jsonResponse(
        { error: 'Active native BRep source is invalid' },
        400,
      );
    }
  }

  const systemPromptBeforeBrepContext = resolvedSystemPrompt;
  resolvedSystemPrompt = withBrepProjectSystemContext({
    systemPrompt: resolvedSystemPrompt,
    contextTemplate: brepProjectContextTemplate,
    activeBrepSource,
  });

  let acceptedBrepBuildInput: BrepAiBuildInput | undefined;
  let activeAiStepNumber = 0;
  const brepBuildAttemptsByStep = new Map<
    number,
    Array<{
      accepted: boolean;
      durationMs: number;
      error?: AiToolErrorClassification;
    }>
  >();

  const tools =
    conversation.type === 'creative'
      ? creativeTools({
          conversation,
          req,
          model: rawBody.model,
          description: createMeshDescription,
        })
      : activeBrepSource
        ? brepParametricTools({
            activeBrepSource,
            buildDescription: brepBuildToolDescription,
            answerDescription: answerToolDescription,
            onAcceptedBuild: (input) => {
              acceptedBrepBuildInput = input;
            },
            onBuildAttempt: ({ accepted, durationMs, error }) => {
              const attempts =
                brepBuildAttemptsByStep.get(activeAiStepNumber) ?? [];
              attempts.push({
                accepted,
                durationMs,
                ...(error ? { error: classifyAiToolError(error) } : {}),
              });
              brepBuildAttemptsByStep.set(activeAiStepNumber, attempts);
            },
          })
        : parametricTools({
            supabaseClient,
            buildDescription: buildToolDescription,
            answerDescription: answerToolDescription,
            inspectionOutputTemplate,
            previewPathForToolCall: (toolCallId) =>
              `${user.id}/${conversation.id}/inspection-preview-${toolCallId}`,
          });
  const buildToolName = parametricBuildToolName(activeBrepSource);

  const leafMessageId = conversation.current_message_leaf_id;
  const authoritativeOpenScadAssets =
    collectAuthoritativeOpenScadAssets(branchMessages);

  let providers: ChatProviders;
  let builtinProviderOverrides: BuiltinProviderRuntimeOverrides = {};
  try {
    builtinProviderOverrides = await loadBuiltinProviderRuntimeOverrides(
      user.id,
    );
    providers = createChatProviders(builtinProviderOverrides);
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: { operation: 'create_providers' },
    });
    return jsonResponse(
      { error: 'AI provider settings could not be loaded' },
      503,
    );
  }

  const hydratedMessages = await Promise.all(
    branchMessages.map(async (message) => ({
      ...message,
      parts: (
        await Promise.all(
          message.parts.map(async (part) => {
            if (
              part.type !== 'file' ||
              typeof part.mediaType !== 'string' ||
              !part.mediaType.startsWith('image/') ||
              part.url.startsWith('data:')
            ) {
              return part;
            }
            const imageId = imageIdFromFilename(part.filename);
            if (!imageId) return null;
            const downloaded = await downloadAsBase64(
              supabaseClient,
              'images',
              imageStoragePath(conversation.user_id, conversation.id, imageId),
            );
            if (!downloaded) return null;
            return {
              ...part,
              mediaType: downloaded.mediaType,
              url: `data:${downloaded.mediaType};base64,${downloaded.base64}`,
            };
          }),
        )
      ).filter((part): part is NonNullable<typeof part> => part != null),
    })),
  );

  const modelMessages = await convertToModelMessages<AppUIMessage>(
    hydratedMessages,
    {
      tools,
      convertDataPart: (part) => {
        if (
          activeBrepSource &&
          (part.type === 'data-mesh-context' ||
            part.type === 'data-mesh-preferences')
        ) {
          return undefined;
        }
        if (part.type === 'data-mesh-context') {
          const { meshId, fileType, filename, boundingBox } = part.data;
          if (conversation.type === 'parametric' && filename) {
            const dimensions = boundingBox
              ? `\nModel dimensions (mm): width=${boundingBox.x.toFixed(1)}, height=${boundingBox.y.toFixed(1)}, depth=${boundingBox.z.toFixed(1)}`
              : '';
            return {
              type: 'text',
              text: renderInstructionTemplate(parametricAttachmentTemplate, {
                fileType: fileType.toUpperCase(),
                filename,
                dimensions,
              }),
            };
          }
          return {
            type: 'text',
            text: renderInstructionTemplate(creativeReferenceTemplate, {
              meshId,
              fileType,
            }),
          };
        }
        if (part.type === 'data-mesh-preferences') {
          return {
            type: 'text',
            text: renderInstructionTemplate(meshPreferencesTemplate, {
              topology: part.data.topology,
              polygonCount: part.data.polygonCount,
            }),
          };
        }
        return undefined;
      },
    },
  );

  let actualModelId: string;
  let creativeAgentSource: 'request' | 'conversation' | 'catalog' | undefined;
  if (conversation.type === 'creative') {
    let resolution;
    try {
      resolution = await resolveCreativeAgentModel({
        conversation,
        requestedAgentModel: rawBody.agentModel,
        user,
      });
    } catch (error) {
      logError(error, {
        functionName: 'ai-chat',
        statusCode: 500,
        userId: user.id,
        conversationId: conversation.id,
        additionalContext: { operation: 'resolve_creative_agent_model' },
      });
      return jsonResponse(
        { error: 'Failed to resolve a Creative AI agent model' },
        500,
      );
    }

    if (!resolution) {
      return jsonResponse(
        {
          error:
            'No enabled direct AI model with tool support is available for Creative mode',
        },
        400,
      );
    }

    actualModelId = resolution.modelId;
    creativeAgentSource = resolution.source;
    if (resolution.source === 'catalog') {
      await pinCreativeAgentModel({
        supabaseClient,
        conversation,
        userId: user.id,
        modelId: actualModelId,
      });
    }
  } else {
    actualModelId = normalizeModelId(rawBody.model);
  }

  const resolvedProvider = providerFor(actualModelId);
  const baseLogContext = {
    userId: user.id,
    conversationId: conversation.id,
    modelId: actualModelId,
    requestedModelId:
      conversation.type === 'creative'
        ? (rawBody.agentModel ??
          conversation.settings?.creativeAgentModel ??
          actualModelId)
        : rawBody.model,
    ...(conversation.type === 'creative'
      ? { meshModelId: rawBody.model, creativeAgentSource }
      : {}),
    provider: resolvedProvider,
  };

  const thinkingEnabled = rawBody.thinking ?? false;
  const thinkingBudget = aiRuntime.number('chat.thinkingBudgetTokens');
  const thinkingBudgetOverridden = Object.prototype.hasOwnProperty.call(
    aiRuntime.preferences.runtimeOverrides,
    'chat.thinkingBudgetTokens',
  );
  const maxSteps = aiRuntime.number(
    conversation.type === 'parametric'
      ? 'chat.parametricMaxSteps'
      : 'chat.creativeMaxSteps',
  );
  const maxOutputTokens = aiRuntime.number(
    conversation.type === 'parametric'
      ? 'chat.parametricMaxOutputTokens'
      : thinkingEnabled
        ? 'chat.creativeThinkingMaxOutputTokens'
        : 'chat.creativeMaxOutputTokens',
  );
  const modelBudgetMetadata = await resolveAiModelBudgetMetadata(
    user.id,
    actualModelId,
  );
  const openCodeRuntime: OpenCodeRuntimeOptions = {
    transportInstruction: activeBrepSource
      ? openCodeBrepTransportInstruction
      : openCodeTransportInstruction,
    timeoutMs: aiRuntime.number('transport.openCodeTimeoutMs'),
    validationAttempts: aiRuntime.number(
      'transport.openCodeValidationAttempts',
    ),
    authoritativeAssets: activeBrepSource ? [] : authoritativeOpenScadAssets,
    sourceKind: activeBrepSource ? 'brep' : 'openscad',
    currentBrepProject: activeBrepSource?.project,
  };
  const cliTimeoutMs = aiRuntime.number('transport.cliTimeoutMs');

  const transport = selectChatTransport(actualModelId, executionMode);
  if (conversation.type === 'creative' && transport.kind !== 'normal') {
    return jsonResponse(
      {
        error:
          'Creative mode currently requires a direct AI model; OpenCode/Codex agent adapters are parametric-only',
      },
      400,
    );
  }
  const turnProvenance = resolveAiTurnProvenance({
    actualModelId,
    transport,
    executionMode,
  });
  const turnMetadata: AppUIMessage['metadata'] = {
    model: rawBody.model,
    ...(conversation.type === 'creative' ? { agentModel: actualModelId } : {}),
    ...turnProvenance,
  };
  let generationRun: AiGenerationRunLifecycle;
  try {
    generationRun = await AiGenerationRunLifecycle.create({
      userId: user.id,
      conversationId: conversation.id,
      requestMessageId: leafMessageId,
      kind: generationRunKindForConversation(
        conversation.type,
        Boolean(activeBrepSource),
      ),
      requestedModelId: baseLogContext.requestedModelId,
    });
    await generationRun.dispatched(turnProvenance);
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: {
        ...baseLogContext,
        operation: 'create_generation_run',
      },
    });
    return jsonResponse(
      { error: 'Generation status could not be initialized' },
      500,
    );
  }

  console.info('transport', {
    modelId: actualModelId,
    executionMode,
    transportKind: transport.kind,
    ...(transport.kind === 'streaming-opencode' && {
      underlyingModelId: transport.underlyingModelId,
    }),
  });

  let chatLanguageModel: LanguageModel;
  let chatProviderOptions: ProviderOptions | undefined;
  let customSupportsVision: boolean | undefined;
  try {
    if (transport.kind === 'streaming-opencode') {
      chatLanguageModel = streamingOpencodeChatModel(
        transport.underlyingModelId,
        conversation.id,
        openCodeRuntime,
      );
      chatProviderOptions = undefined;
    } else if (transport.kind === 'cli-agent') {
      chatLanguageModel = cliAgentChatModel(actualModelId, {
        transportInstruction: actualModelId.startsWith('agent/codex/')
          ? activeBrepSource
            ? codexBrepTransportInstruction
            : codexTransportInstruction
          : activeBrepSource
            ? openCodeBrepTransportInstruction
            : openCodeTransportInstruction,
        timeoutMs: cliTimeoutMs,
        authoritativeAssets: activeBrepSource
          ? []
          : authoritativeOpenScadAssets,
        sourceKind: activeBrepSource ? 'brep' : 'openscad',
        currentBrepProject: activeBrepSource?.project,
      });
      chatProviderOptions = undefined;
    } else if (isCustomProviderModel(actualModelId)) {
      try {
        const built = await buildCustomChatModel(
          actualModelId,
          user.id,
          thinkingEnabled,
          thinkingBudget,
        );

        const supportsTools = built.capabilities.supportsTools;
        if (!supportsTools) {
          await generationRun.failed('provider_tools_unsupported');
          return jsonResponse(
            { error: 'Provider does not support required CAD tools' },
            400,
          );
        }

        chatLanguageModel = built.model;
        chatProviderOptions = built.providerOptions;
        customSupportsVision = built.capabilities.supportsVision;
      } catch (error) {
        logError(error, {
          functionName: 'ai-chat',
          statusCode: 400,
          userId: user.id,
          conversationId: conversation.id,
          additionalContext: {
            ...baseLogContext,
            operation: 'build_custom_chat_model',
          },
        });
        await generationRun.failed('model_initialization_failed');
        const message =
          error instanceof Error ? error.message : 'Custom provider error';
        return jsonResponse({ error: message }, 400);
      }
    } else {
      const built = buildChatModel(
        actualModelId,
        providers,
        thinkingEnabled,
        thinkingBudget,
        thinkingBudgetOverridden,
        openCodeRuntime,
      );
      chatLanguageModel = built.model;
      chatProviderOptions = built.providerOptions;
    }
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: {
        ...baseLogContext,
        operation: 'build_chat_model',
      },
    });
    await generationRun.failed('model_initialization_failed');
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      { error: `Failed to initialize model ${actualModelId}: ${message}` },
      500,
    );
  }

  const directVision = modelSupportsDirectVision(
    actualModelId,
    transport.kind,
    customSupportsVision,
  );
  if (!directVision) {
    chatLanguageModel = withVisionFallback(chatLanguageModel, user.id);
  }
  console.info('vision routing', {
    modelId: actualModelId,
    transportKind: transport.kind,
    directVision,
    fallbackConfiguredByAiSettings: !directVision,
  });

  const logContext = {
    ...baseLogContext,
    thinking: thinkingEnabled,
  };

  const streamingOpenCode = transport.kind === 'streaming-opencode';
  const forceBuildToolChoice =
    !streamingOpenCode && supportsForcedToolChoice(actualModelId);
  const usingAutoToolChoiceFallback =
    conversation.type === 'parametric' &&
    leafRole === 'user' &&
    !streamingOpenCode &&
    !forceBuildToolChoice;

  let contextDiagnostics: Awaited<ReturnType<typeof buildAiContextDiagnostics>>;
  try {
    contextDiagnostics = await buildAiContextDiagnostics({
      systemPrompt: resolvedSystemPrompt,
      systemPromptBeforeBrepContext,
      tools: tools as Record<string, unknown>,
      branchMessages,
      modelMessages,
      currentBrepProject: activeBrepSource?.project,
      modelContextLimit: modelBudgetMetadata.contextLimit,
      modelOutputLimit: modelBudgetMetadata.outputLimit,
      reservedOutputTokens: maxOutputTokens,
    });
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: {
        ...baseLogContext,
        operation: 'context_preflight',
      },
    });
    await generationRun.failed('context_preflight_failed');
    return jsonResponse(
      { error: 'AI context could not be prepared safely' },
      500,
    );
  }

  const requestHardBudget = deriveAiHardContextBudget({
    estimatedInputTokens: contextDiagnostics.total.estimatedInputTokens,
    contextWindowTokens: modelBudgetMetadata.contextLimit,
    configuredMaxOutputTokens: maxOutputTokens,
    modelOutputLimitTokens: modelBudgetMetadata.outputLimit,
    safetyMarginTokens: contextDiagnostics.budget.safetyMarginTokens,
  });
  console.info('ai context diagnostics', {
    modelId: actualModelId,
    transportKind: transport.kind,
    modelBudgetSource: modelBudgetMetadata.source,
    ...contextDiagnostics,
    hardBudget: requestHardBudget,
  });

  try {
    assertAiHardContextBudget(requestHardBudget);
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 413,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: {
        ...baseLogContext,
        operation: 'context_budget_preflight',
        hardBudget: requestHardBudget,
      },
    });
    await generationRun.failed('context_budget_exceeded');
    return jsonResponse(
      {
        error:
          'AI context is too large for the selected model. Shorten the conversation or choose a model with a larger context window.',
      },
      413,
    );
  }

  const fixedContextEstimatedTokens =
    contextDiagnostics.systemInstructions.estimatedTokens +
    contextDiagnostics.providerToolSchemas.estimatedTokens;

  const activeGeneration = beginActiveGeneration(
    user.id,
    conversation.id,
    generationRun.id,
  );
  if (activeGeneration.replacedDurableRunId) {
    await cancelDurableGenerationRun(
      activeGeneration.replacedDurableRunId,
      user.id,
      conversation.id,
      'Generation superseded by a newer request.',
    );
  }
  await generationRun.generating();

  const generationStartedAt = Date.now();
  const stepStartedAt = new Map<number, number>();
  const stepContextByNumber = new Map<number, AiStepContextMeasurement>();
  const stepBudgetByNumber = new Map<number, AiHardContextBudget>();
  const stepPolicyByNumber = new Map<
    number,
    { activeTools: string[]; toolChoice: string; maxOutputTokens: number }
  >();
  let modelStreamFailed = false;
  let modelStreamFailure: unknown;

  const result = streamText({
    model: chatLanguageModel,
    providerOptions: chatProviderOptions,
    system: resolvedSystemPrompt,
    messages: modelMessages,
    tools,
    prepareStep: ({ stepNumber, messages }) => {
      activeAiStepNumber = stepNumber;
      const stepMessages = estimateModelMessagesForHardBudget(messages);
      const stepBudget = deriveAiHardContextBudget({
        estimatedInputTokens:
          fixedContextEstimatedTokens + stepMessages.estimatedTokens,
        contextWindowTokens: modelBudgetMetadata.contextLimit,
        configuredMaxOutputTokens: maxOutputTokens,
        modelOutputLimitTokens: modelBudgetMetadata.outputLimit,
        safetyMarginTokens: contextDiagnostics.budget.safetyMarginTokens,
      });
      stepBudgetByNumber.set(stepNumber, stepBudget);
      assertAiHardContextBudget(stepBudget);

      const forceInitialBuild =
        !streamingOpenCode &&
        conversation.type === 'parametric' &&
        leafRole === 'user' &&
        stepNumber === 0;
      const stepPolicy = forceInitialBuild
        ? {
            activeTools: [buildToolName],
            toolChoice: forceBuildToolChoice ? `tool:${buildToolName}` : 'auto',
            maxOutputTokens: stepBudget.effectiveMaxOutputTokens,
          }
        : {
            activeTools: Object.keys(tools),
            toolChoice: 'auto',
            maxOutputTokens: stepBudget.effectiveMaxOutputTokens,
          };
      stepPolicyByNumber.set(stepNumber, stepPolicy);

      if (streamingOpenCode) {
        return { maxOutputTokens: stepBudget.effectiveMaxOutputTokens };
      }
      if (forceInitialBuild) {
        return {
          activeTools: [buildToolName as never],
          maxOutputTokens: stepBudget.effectiveMaxOutputTokens,
          ...(forceBuildToolChoice
            ? {
                toolChoice: {
                  type: 'tool' as const,
                  toolName: buildToolName as never,
                },
              }
            : {}),
        };
      }
      return { maxOutputTokens: stepBudget.effectiveMaxOutputTokens };
    },
    experimental_onStepStart: ({ stepNumber, messages }) => {
      activeAiStepNumber = stepNumber;
      const startedAt = Date.now();
      const context = measureAiStepContext(messages);
      const previousContext = stepContextByNumber.get(stepNumber - 1);
      stepStartedAt.set(stepNumber, startedAt);
      stepContextByNumber.set(stepNumber, context);
      const policy = stepPolicyByNumber.get(stepNumber);
      console.info('ai step started', {
        modelId: actualModelId,
        transportKind: transport.kind,
        stepNumber: stepNumber + 1,
        totalElapsedMs: startedAt - generationStartedAt,
        activeTools: policy?.activeTools ?? Object.keys(tools),
        toolChoice: summarizeAiToolChoice(policy?.toolChoice ?? 'auto'),
        maxOutputTokens:
          policy?.maxOutputTokens ?? requestHardBudget.effectiveMaxOutputTokens,
        hardBudget: stepBudgetByNumber.get(stepNumber) ?? requestHardBudget,
        context: {
          ...context,
          modelMessageGrowthBytes: previousContext
            ? context.modelMessageBytes - previousContext.modelMessageBytes
            : 0,
          brepToolPayloadGrowthBytes: previousContext
            ? context.brepToolPayloadBytes -
              previousContext.brepToolPayloadBytes
            : 0,
        },
      });
    },
    onStepFinish: ({ stepNumber, finishReason, usage, toolCalls }) => {
      if (finishReason === 'error') {
        modelStreamFailed = true;
      }
      const finishedAt = Date.now();
      const context = stepContextByNumber.get(stepNumber);
      const policy = stepPolicyByNumber.get(stepNumber);
      const buildAttempts = brepBuildAttemptsByStep.get(stepNumber) ?? [];
      const usageAvailable =
        (usage.inputTokens ?? 0) > 0 ||
        (usage.outputTokens ?? 0) > 0 ||
        (usage.totalTokens ?? 0) > 0;
      console.info('ai step diagnostics', {
        modelId: actualModelId,
        transportKind: transport.kind,
        stepNumber: stepNumber + 1,
        stepDurationMs:
          finishedAt - (stepStartedAt.get(stepNumber) ?? generationStartedAt),
        totalElapsedMs: finishedAt - generationStartedAt,
        finishReason,
        activeTools: policy?.activeTools ?? Object.keys(tools),
        toolChoice: summarizeAiToolChoice(policy?.toolChoice ?? 'auto'),
        maxOutputTokens:
          policy?.maxOutputTokens ?? requestHardBudget.effectiveMaxOutputTokens,
        hardBudget: stepBudgetByNumber.get(stepNumber) ?? requestHardBudget,
        toolCalls: toolCalls.map((call) => call.toolName),
        buildBrepProject: {
          attemptCount: buildAttempts.length,
          accepted: buildAttempts.some((attempt) => attempt.accepted),
          attempts: buildAttempts,
        },
        context: context ?? null,
        providerUsage: usageAvailable
          ? {
              inputTokens: usage.inputTokens ?? null,
              outputTokens: usage.outputTokens ?? null,
              totalTokens: usage.totalTokens ?? null,
            }
          : null,
      });
    },
    stopWhen: activeBrepSource
      ? [
          ({ steps }) =>
            shouldStopAfterAcceptedBrepBuild(
              brepBuildAttemptsByStep,
              steps.length,
            ),
          hasToolCall('answer_user'),
          stepCountIs(maxSteps),
        ]
      : streamingOpenCode
        ? hasToolCall('build_parametric_model')
        : stepCountIs(maxSteps),
    maxOutputTokens: requestHardBudget.effectiveMaxOutputTokens,
    abortSignal: activeGeneration.signal,
    experimental_transform: smoothStream({ delayInMs: 30 }),
    onError: ({ error }) => {
      modelStreamFailed = true;
      if (modelStreamFailure === undefined) modelStreamFailure = error;
      activeGeneration.finish();
      if (isRequestAbort(error, activeGeneration.signal)) {
        void generationRun.cancelled('Generation aborted.');
        return;
      }
      if (error instanceof AiContextBudgetError) {
        void generationRun.failed('context_budget_exceeded');
        logError(error, {
          functionName: 'ai-chat',
          statusCode: 413,
          userId: logContext.userId,
          conversationId: logContext.conversationId,
          additionalContext: {
            ...logContext,
            operation: 'step_context_budget',
            hardBudget: error.budget,
          },
        });
        return;
      }
      void generationRun.failed('model_stream_failed');

      logError(error, {
        functionName: 'ai-chat',
        statusCode: 500,
        userId: logContext.userId,
        conversationId: logContext.conversationId,
        additionalContext: {
          ...logContext,
          operation: 'stream_text',
        },
      });
    },
    onFinish: ({ steps }) => {
      activeGeneration.finish();
      if (!modelStreamFailed) {
        void generationRun.responseReceived();
      }
      const usageAvailable = steps.some(
        (step) =>
          (step.usage.inputTokens ?? 0) > 0 ||
          (step.usage.outputTokens ?? 0) > 0 ||
          (step.usage.totalTokens ?? 0) > 0,
      );
      const inputTokens = usageAvailable
        ? steps.reduce(
            (total, step) => total + (step.usage.inputTokens ?? 0),
            0,
          )
        : null;
      const outputTokens = usageAvailable
        ? steps.reduce(
            (total, step) => total + (step.usage.outputTokens ?? 0),
            0,
          )
        : null;
      const totalTokens = usageAvailable
        ? steps.reduce(
            (total, step) => total + (step.usage.totalTokens ?? 0),
            0,
          )
        : null;
      const acceptedBrepBuildSteps = [...brepBuildAttemptsByStep.entries()]
        .filter(([, attempts]) => attempts.some((attempt) => attempt.accepted))
        .map(([stepNumber]) => stepNumber + 1)
        .sort((left, right) => left - right);
      console.info('ai context actual usage', {
        modelId: actualModelId,
        transportKind: transport.kind,
        stepCount: steps.length,
        providerUsageRequested: actualModelId.startsWith('local/'),
        providerUsageAvailable: usageAvailable,
        inputTokens,
        outputTokens,
        totalTokens,
        totalElapsedMs: Date.now() - generationStartedAt,
        acceptedBrepBuildSteps,
      });
      if (!usingAutoToolChoiceFallback) return;
      const calledBuildTool = steps.some((step) =>
        step.toolCalls?.some((call) => call.toolName === buildToolName),
      );
      if (!calledBuildTool) {
        logError(
          new Error(
            `Parametric turn finished without calling ${buildToolName} under auto tool-choice fallback`,
          ),
          {
            functionName: 'ai-chat',
            statusCode: 500,
            userId: logContext.userId,
            conversationId: logContext.conversationId,
            additionalContext: {
              ...logContext,
              operation: 'forced_tool_choice_fallback',
              modelId: actualModelId,
            },
          },
        );
      }
    },
  });

  const stream = createUIMessageStream<AppUIMessage>({
    onError: (error) => {
      activeGeneration.finish();
      if (isRequestAbort(error, activeGeneration.signal)) {
        void generationRun.cancelled('Generation aborted.');
        return 'Generation stopped';
      }
      if (error instanceof AiContextBudgetError) {
        void generationRun.failed('context_budget_exceeded');
        return 'AI context became too large for the selected model before the next provider step.';
      }
      if (modelStreamFailed) {
        if (modelStreamFailure === undefined) {
          modelStreamFailure = error;
          void generationRun.failed('model_stream_failed');
          logError(error, {
            functionName: 'ai-chat',
            statusCode: 500,
            userId: baseLogContext.userId,
            conversationId: baseLogContext.conversationId,
            additionalContext: {
              ...baseLogContext,
              operation: 'ui_message_stream_model_failure',
            },
          });
        }
        const failure = modelStreamFailure ?? error;
        const message =
          failure instanceof Error ? failure.message : String(failure);
        return `Model call failed (${resolvedProvider}/${actualModelId}): ${message}`;
      }
      void generationRun.failed('ui_stream_failed');

      logError(error, {
        functionName: 'ai-chat',
        statusCode: 500,
        userId: baseLogContext.userId,
        conversationId: baseLogContext.conversationId,
        additionalContext: {
          ...baseLogContext,
          operation: 'ui_message_stream',
        },
      });
      const message = error instanceof Error ? error.message : String(error);
      return `Model call failed (${resolvedProvider}/${actualModelId}): ${message}`;
    },
    execute: async ({ writer }) => {
      writer.merge(
        result.toUIMessageStream<AppUIMessage>({
          originalMessages: branchMessages,
          generateMessageId: () => crypto.randomUUID(),
          messageMetadata: ({ part }) =>
            part.type === 'start' ? turnMetadata : undefined,
          onFinish: async ({ responseMessage, isContinuation }) => {
            if (modelStreamFailed) {
              if (modelStreamFailure !== undefined) throw modelStreamFailure;
              throw new Error(
                'Model stream failed before response finalization.',
              );
            }
            await generationRun.validatingArtifact(responseMessage.id);

            const metadata = {
              ...(responseMessage.metadata ?? {}),
              ...turnMetadata,
            };

            const baseFinalizedParts =
              conversation.type === 'parametric'
                ? dropTextFromParametricBuildMessage(
                    finalizeStreamingParts(responseMessage.parts),
                  )
                : finalizeStreamingParts(responseMessage.parts);
            const brepFinalized = await finalizeBrepAiAssistantPartsForRun({
              parts: baseFinalizedParts,
              activeBrepSource,
              acceptedBuildInput: acceptedBrepBuildInput,
              generationRun,
            });
            const finalizedParts = brepFinalized.parts;

            const serializedMessage = {
              metadata: JSON.parse(JSON.stringify(metadata)),
              parts: JSON.parse(JSON.stringify(finalizedParts)),
            };

            const hasPendingToolCall = hasPendingClientToolCall(finalizedParts);
            const persistAction = decidePersistAction({
              isContinuation,
              hasPendingToolCall,
            });
            await generationRun.savingRevision(responseMessage.id);
            let error: { message: string } | null = null;
            if (persistAction === 'update') {
              if (activeBrepSource) {
                error = {
                  message:
                    'Native BRep AI attempted to update an immutable assistant revision in place.',
                };
              } else {
                ({ error } = await supabaseClient
                  .from('messages')
                  .update(serializedMessage)
                  .eq('id', responseMessage.id)
                  .eq('conversation_id', conversation.id));
              }
            } else if (persistAction === 'insert') {
              if (activeBrepSource) {
                try {
                  await persistBrepAiRevisionAtomically({
                    client: supabaseClient as unknown as BrepAiRpcClient,
                    conversationId: conversation.id,
                    expectedLeafId: leafMessageId,
                    messageId: responseMessage.id,
                    parts: serializedMessage.parts,
                    metadata: serializedMessage.metadata,
                  });
                } catch (persistError) {
                  error = {
                    message:
                      persistError instanceof Error
                        ? persistError.message
                        : 'BRep AI revision persistence failed',
                  };
                }
              } else {
                ({ error } = await supabaseClient.from('messages').insert({
                  id: responseMessage.id,
                  conversation_id: conversation.id,
                  role: responseMessage.role,
                  ...serializedMessage,
                  parent_message_id: leafMessageId,
                }));
              }
            } else {
              ({ error } = await supabaseClient
                .from('messages')
                .update({ metadata: serializedMessage.metadata })
                .eq('id', responseMessage.id)
                .eq('conversation_id', conversation.id));
            }

            if (error) {
              logError(error, {
                functionName: 'ai-chat',
                statusCode: 500,
                userId: user.id,
                conversationId: conversation.id,
                additionalContext: { operation: 'persist_response_message' },
              });
              await generationRun.failed('response_persistence_failed');
            } else {
              await generationRun.persisted(
                responseMessage.id,
                Boolean(brepFinalized.artifact),
              );
            }
          },
        }),
      );
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: corsHeaders,
    consumeSseStream: consumeStream,
  });
}
