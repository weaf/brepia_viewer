import type { BrepProject } from './brepProject.ts';
import { getBrepProjectArtifact } from './brepProjectArtifact.ts';
import { normalizeBrepAiProjectCandidate } from './brepAiProject.ts';
import type { BrepProjectArtifactData } from './chatAi.ts';

export type BrepAiBranchMessage = {
  id: string;
  role: string;
  parts: unknown;
  metadata?: unknown;
};

export type BrepAiTreeMessage = BrepAiBranchMessage & {
  parent_message_id: string | null;
};

export type BrepAiPersistedSourceRevision = {
  kind?: 'source';
  messageId: string;
  artifact: BrepProjectArtifactData;
  project: BrepProject;
};

export type BrepAiCreationRoute = {
  kind: 'creation';
  messageId: string;
  artifact?: undefined;
  project?: undefined;
};

/**
 * Server-side native BRep route state. A creation route is deliberately not a
 * source revision and therefore carries no fabricated previous project.
 */
export type BrepAiSourceRevision =
  | BrepAiPersistedSourceRevision
  | BrepAiCreationRoute;

export function isBrepAiCreationRoute(
  source: BrepAiSourceRevision,
): source is BrepAiCreationRoute {
  return source.kind === 'creation';
}

export class BrepAiContextError extends Error {
  constructor(
    public readonly code: 'invalid_source_revision' | 'invalid_branch',
    message: string,
  ) {
    super(message);
    this.name = 'BrepAiContextError';
  }
}

function hasBrepProjectMarker(parts: unknown): boolean {
  return (
    Array.isArray(parts) &&
    parts.some(
      (part) =>
        part !== null &&
        typeof part === 'object' &&
        !Array.isArray(part) &&
        (part as { type?: unknown }).type === 'data-brep-project',
    )
  );
}

function hasExplicitBrepCreationIntent(message: BrepAiBranchMessage): boolean {
  if (message.role !== 'user') return false;
  if (
    typeof message.metadata !== 'object' ||
    message.metadata === null ||
    Array.isArray(message.metadata)
  ) {
    return false;
  }
  return (
    (message.metadata as { parametricSourceKind?: unknown })
      .parametricSourceKind === 'brep'
  );
}

function resolvePersistedBrepAiSource(
  messages: readonly BrepAiBranchMessage[],
): BrepAiPersistedSourceRevision | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!hasBrepProjectMarker(message.parts)) continue;

    if (message.role !== 'assistant') {
      throw new BrepAiContextError(
        'invalid_source_revision',
        `Native BRep source marker on message ${message.id} is not an assistant revision.`,
      );
    }

    const artifact = getBrepProjectArtifact(message.parts);
    if (!artifact) {
      throw new BrepAiContextError(
        'invalid_source_revision',
        `Native BRep source revision ${message.id} is invalid.`,
      );
    }

    const project = normalizeBrepAiProjectCandidate(artifact.source.source);
    return { kind: 'source', messageId: message.id, artifact, project };
  }

  return undefined;
}

/**
 * Resolve the native BRep route nearest to the active branch leaf.
 *
 * Persisted canonical source always wins. Only when no data-brep-project exists
 * may the root user message's explicit product metadata arm first-turn BRep
 * creation. Prompt text is intentionally ignored. The creation route carries no
 * previous project, so first-result validation cannot accidentally become a
 * follow-up identity check against fabricated state.
 */
export function resolveActiveBrepAiSource(
  messages: readonly BrepAiBranchMessage[],
): BrepAiSourceRevision | undefined {
  const persisted = resolvePersistedBrepAiSource(messages);
  if (persisted) return persisted;

  const firstMessage = messages[0];
  if (firstMessage && hasExplicitBrepCreationIntent(firstMessage)) {
    return { kind: 'creation', messageId: firstMessage.id };
  }

  return undefined;
}

/**
 * Build the exact root-to-leaf branch from persisted message-tree rows and
 * resolve the authoritative persisted BRep source used by product views.
 *
 * Product views intentionally ignore the first-turn creation route. Until the
 * AI result has been atomically persisted there is no canonical project to
 * render. Once a source exists, it is the sole authority.
 */
export function resolveActiveBrepAiSourceForLeaf(
  messages: readonly BrepAiTreeMessage[],
  leafMessageId: string,
): BrepAiPersistedSourceRevision | undefined {
  const byId = new Map<string, BrepAiTreeMessage>();
  for (const message of messages) {
    if (byId.has(message.id)) {
      throw new BrepAiContextError(
        'invalid_branch',
        `Duplicate message ${message.id} in native BRep branch data.`,
      );
    }
    byId.set(message.id, message);
  }

  if (!byId.has(leafMessageId)) {
    return undefined;
  }

  const reversedBranch: BrepAiBranchMessage[] = [];
  const visited = new Set<string>();
  let currentId: string | null = leafMessageId;

  while (currentId) {
    if (visited.has(currentId)) {
      throw new BrepAiContextError(
        'invalid_branch',
        `Cycle detected in native BRep message branch at ${currentId}.`,
      );
    }
    visited.add(currentId);

    const message = byId.get(currentId);
    if (!message) {
      throw new BrepAiContextError(
        'invalid_branch',
        `Native BRep message branch is missing ${currentId}.`,
      );
    }

    reversedBranch.push({
      id: message.id,
      role: message.role,
      parts: message.parts,
      metadata: message.metadata,
    });
    currentId = message.parent_message_id;
  }

  return resolvePersistedBrepAiSource(reversedBranch.reverse());
}

/** Serialize only canonical editable source semantics for model context. */
export function serializeBrepAiProjectContext(project: unknown): string {
  return JSON.stringify(normalizeBrepAiProjectCandidate(project), null, 2);
}
