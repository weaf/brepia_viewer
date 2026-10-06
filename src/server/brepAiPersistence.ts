type RpcError = { message: string } | null;

type RpcResult = {
  data: unknown;
  error: RpcError;
};

export type BrepAiRpcClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<RpcResult>;
};

export type BrepAiPersistenceAccepted = {
  accepted: true;
  messageId: string;
};

export class BrepAiPersistenceError extends Error {
  constructor(
    public readonly code:
      | 'rpc_failed'
      | 'invalid_rpc_result'
      | 'stale'
      | 'conversation_not_found',
    message: string,
  ) {
    super(message);
    this.name = 'BrepAiPersistenceError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function persistBrepAiRevisionAtomically({
  client,
  conversationId,
  expectedLeafId,
  messageId,
  parts,
  metadata,
}: {
  client: BrepAiRpcClient;
  conversationId: string;
  expectedLeafId: string;
  messageId: string;
  parts: unknown[];
  metadata: Record<string, unknown>;
}): Promise<BrepAiPersistenceAccepted> {
  const { data, error } = await client.rpc('persist_brep_ai_revision', {
    p_conversation_id: conversationId,
    p_expected_leaf_id: expectedLeafId,
    p_message_id: messageId,
    p_parts: parts,
    p_metadata: metadata,
  });

  if (error) {
    throw new BrepAiPersistenceError(
      'rpc_failed',
      `Could not persist BRep AI revision: ${error.message}`,
    );
  }
  if (!isRecord(data) || typeof data.accepted !== 'boolean') {
    throw new BrepAiPersistenceError(
      'invalid_rpc_result',
      'BRep AI persistence RPC returned an invalid result.',
    );
  }

  if (!data.accepted) {
    const reason = data.reason;
    if (reason === 'stale') {
      throw new BrepAiPersistenceError(
        'stale',
        'BRep project changed before the AI revision could be activated.',
      );
    }
    if (reason === 'conversation_not_found') {
      throw new BrepAiPersistenceError(
        'conversation_not_found',
        'BRep conversation was not found or is not writable by this user.',
      );
    }
    throw new BrepAiPersistenceError(
      'invalid_rpc_result',
      'BRep AI persistence RPC rejected the revision for an unknown reason.',
    );
  }

  if (data.messageId !== messageId) {
    throw new BrepAiPersistenceError(
      'invalid_rpc_result',
      'BRep AI persistence RPC returned an unexpected message identity.',
    );
  }

  return { accepted: true, messageId };
}
