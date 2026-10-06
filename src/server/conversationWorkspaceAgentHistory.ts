import { createHash } from 'node:crypto';
import {
  buildOpenCodeAttachCommand,
  buildOpenCodeSessionId,
  opencodeApiUrl,
} from './opencode';
import {
  recordConversationAgentSession,
  recordConversationAgentTurn,
  type ConversationAgentSessionInput,
  type ConversationAgentTransport,
  type ConversationAgentTurnInput,
} from './conversationWorkspaceAgents';
import type { ConversationAgentKind } from './conversationWorkspace';
import { getAnonSupabaseClient } from './supabaseClient';

const FALLBACK_MESSAGE_TIME = '1970-01-01T00:00:00.000Z';
const CLI_SESSION_MARKER_PREFIX = 'cli-agent-session';

export type ConversationAgentHistoryRow = {
  id: string;
  parent_message_id: string | null;
  created_at: string | null;
  role: string;
  parts: unknown;
  metadata: unknown;
};

export type ConversationAgentHistorySyncResult = {
  discoveredTurns: number;
  recordedTurns: number;
  sessionsUpdated: number;
};

type DiscoveredAgentTurn = Omit<
  ConversationAgentTurnInput,
  'conversationId' | 'startedAt' | 'finishedAt'
> & {
  messageId: string;
  messageCreatedAt: string;
};

type AgentHistoryDependencies = {
  loadMessages?: (
    request: Request,
    conversationId: string,
  ) => Promise<ConversationAgentHistoryRow[]>;
  recordTurn?: typeof recordConversationAgentTurn;
  recordSession?: typeof recordConversationAgentSession;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function modelFromMetadata(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  return typeof metadata.model === 'string' && metadata.model.trim()
    ? metadata.model
    : null;
}

function agentFromModel(model: string): ConversationAgentKind | null {
  if (model.startsWith('agent/opencode/') || model.startsWith('opencode/')) {
    return 'opencode';
  }
  if (model.startsWith('agent/codex/')) return 'codex';
  return null;
}

function decodeCliSessionMarker(
  toolCallId: string,
): { agent: ConversationAgentKind; sessionId: string | null } | null {
  if (
    toolCallId.startsWith('cli-agent-') &&
    !toolCallId.startsWith(`${CLI_SESSION_MARKER_PREFIX}.`)
  ) {
    return null;
  }

  const [prefix, rawAgent, encodedSession] = toolCallId.split('.', 4);
  if (
    prefix !== CLI_SESSION_MARKER_PREFIX ||
    (rawAgent !== 'opencode' && rawAgent !== 'codex') ||
    !encodedSession
  ) {
    return null;
  }

  try {
    const decoded = Buffer.from(encodedSession, 'base64url').toString('utf8');
    if (rawAgent === 'opencode') {
      return {
        agent: 'opencode',
        sessionId: decoded.startsWith('ses') ? decoded : null,
      };
    }
    return {
      agent: 'codex',
      sessionId: /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(decoded) ? decoded : null,
    };
  } catch {
    return { agent: rawAgent, sessionId: null };
  }
}

function stableTurnId(messageId: string, toolCallId: string): string {
  return createHash('sha256')
    .update(`${messageId}:${toolCallId}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
}

function errorFromToolPart(part: Record<string, unknown>): Error | undefined {
  if (typeof part.errorText === 'string' && part.errorText.trim()) {
    return new Error(part.errorText.trim());
  }
  if (isRecord(part.output) && part.output.status === 'error') {
    const message =
      typeof part.output.message === 'string' && part.output.message.trim()
        ? part.output.message.trim()
        : 'Agent CAD build failed';
    return new Error(message);
  }
  return undefined;
}

function discoverAgentTurn(
  conversationId: string,
  row: ConversationAgentHistoryRow,
  part: Record<string, unknown>,
  seenSessions: Set<string>,
): DiscoveredAgentTurn | null {
  if (part.type !== 'tool-build_parametric_model') return null;
  if (typeof part.toolCallId !== 'string' || !part.toolCallId) return null;
  if (part.state !== 'output-available' && part.state !== 'output-error') {
    return null;
  }

  const model = modelFromMetadata(row.metadata);
  if (!model) return null;
  const modelAgent = agentFromModel(model);
  if (!modelAgent) return null;

  let agent = modelAgent;
  let transport: ConversationAgentTransport;
  let sessionId: string | null;
  const cliSession = decodeCliSessionMarker(part.toolCallId);
  if (cliSession) {
    agent = cliSession.agent;
    transport = 'cli';
    sessionId = cliSession.sessionId;
  } else if (part.toolCallId.startsWith('cli-agent-')) {
    transport = 'cli';
    sessionId = null;
  } else if (
    part.toolCallId.startsWith('stream-') &&
    modelAgent === 'opencode'
  ) {
    transport = 'streaming';
    sessionId = buildOpenCodeSessionId(conversationId);
  } else {
    return null;
  }

  if (agent !== modelAgent) return null;
  const sessionKey = sessionId ? `${agent}:${transport}:${sessionId}` : null;
  const reused = sessionKey ? seenSessions.has(sessionKey) : false;
  if (sessionKey) seenSessions.add(sessionKey);
  const error = errorFromToolPart(part);
  const status = part.state === 'output-error' || error ? 'error' : 'success';

  return {
    id: stableTurnId(row.id, part.toolCallId),
    messageId: row.id,
    messageCreatedAt: row.created_at ?? FALLBACK_MESSAGE_TIME,
    agent,
    transport,
    model,
    sessionId,
    reused,
    status,
    resultKind: status === 'success' ? 'code' : 'none',
    ...(error ? { error } : {}),
  };
}

export function collectConversationAgentTurns(
  conversationId: string,
  rows: ConversationAgentHistoryRow[],
  leafId: string | null,
): DiscoveredAgentTurn[] {
  if (!leafId) return [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const branch: ConversationAgentHistoryRow[] = [];
  const seen = new Set<string>();
  let currentId: string | null = leafId;

  while (currentId) {
    if (seen.has(currentId)) {
      throw new Error(`Conversation message parent cycle at ${currentId}`);
    }
    seen.add(currentId);
    const row = byId.get(currentId);
    if (!row) {
      throw new Error(`Conversation branch message not found: ${currentId}`);
    }
    branch.push(row);
    currentId = row.parent_message_id;
  }

  branch.reverse();
  const sessionSeen = new Set<string>();
  const turns: DiscoveredAgentTurn[] = [];
  for (const row of branch) {
    if (row.role !== 'assistant' || !Array.isArray(row.parts)) continue;
    for (const part of row.parts) {
      if (!isRecord(part)) continue;
      const turn = discoverAgentTurn(conversationId, row, part, sessionSeen);
      if (turn) turns.push(turn);
    }
  }
  return turns;
}

async function defaultLoadMessages(
  request: Request,
  conversationId: string,
): Promise<ConversationAgentHistoryRow[]> {
  const supabase = getAnonSupabaseClient({
    global: {
      headers: { Authorization: request.headers.get('Authorization') ?? '' },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return [];

  const { data, error } = await supabase
    .from('messages')
    .select('id, parent_message_id, created_at, role, parts, metadata')
    .eq('conversation_id', conversationId);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    parent_message_id: row.parent_message_id,
    created_at: row.created_at,
    role: row.role,
    parts: row.parts,
    metadata: row.metadata,
  }));
}

function latestSessionInput(
  conversationId: string,
  turn: DiscoveredAgentTurn,
): ConversationAgentSessionInput {
  if (
    turn.agent === 'opencode' &&
    turn.transport === 'streaming' &&
    turn.sessionId
  ) {
    const server = opencodeApiUrl();
    const directory = process.cwd();
    return {
      conversationId,
      agent: turn.agent,
      transport: turn.transport,
      model: turn.model,
      sessionId: turn.sessionId,
      reused: turn.reused,
      server,
      directory,
      attachCommand: buildOpenCodeAttachCommand(
        server,
        turn.sessionId,
        directory,
      ),
    };
  }

  return {
    conversationId,
    agent: turn.agent,
    transport: turn.transport,
    model: turn.model,
    sessionId: turn.sessionId,
    reused: turn.reused,
    ...(turn.agent === 'opencode' ? { directory: process.cwd() } : {}),
  };
}

export async function syncConversationAgentHistory(
  request: Request,
  conversationId: string,
  leafId: string | null,
  dependencies: AgentHistoryDependencies = {},
): Promise<ConversationAgentHistorySyncResult> {
  if (!leafId) {
    return { discoveredTurns: 0, recordedTurns: 0, sessionsUpdated: 0 };
  }

  const loadMessages = dependencies.loadMessages ?? defaultLoadMessages;
  const recordTurn = dependencies.recordTurn ?? recordConversationAgentTurn;
  const recordSession =
    dependencies.recordSession ?? recordConversationAgentSession;
  const rows = await loadMessages(request, conversationId);
  const turns = collectConversationAgentTurns(conversationId, rows, leafId);

  let recordedTurns = 0;
  const latestByAgent = new Map<ConversationAgentKind, DiscoveredAgentTurn>();
  for (const turn of turns) {
    await recordTurn({
      id: turn.id,
      conversationId,
      agent: turn.agent,
      transport: turn.transport,
      model: turn.model,
      sessionId: turn.sessionId,
      reused: turn.reused,
      status: turn.status,
      startedAt: turn.messageCreatedAt,
      finishedAt: turn.messageCreatedAt,
      resultKind: turn.resultKind,
      ...(turn.error ? { error: turn.error } : {}),
    });
    recordedTurns += 1;
    latestByAgent.set(turn.agent, turn);
  }

  let sessionsUpdated = 0;
  for (const turn of latestByAgent.values()) {
    await recordSession(latestSessionInput(conversationId, turn));
    sessionsUpdated += 1;
  }

  return {
    discoveredTurns: turns.length,
    recordedTurns,
    sessionsUpdated,
  };
}
