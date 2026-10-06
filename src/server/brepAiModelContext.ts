import type { AppUIMessage } from '@shared/chatAi';
import {
  isBrepAiCreationRoute,
  type BrepAiSourceRevision,
} from '@shared/brepAiContext';

const BREP_HISTORY_SUMMARY_MAX_CHARS = 512;
const BREP_BUILD_TOOL_NAME = 'build_brep_project';

export type BrepAiModelContextProjectionDiagnostics = {
  applied: boolean;
  inputMessageCount: number;
  outputMessageCount: number;
  removedBuildToolParts: number;
  removedBrepSnapshotParts: number;
  removedBuildReasoningParts: number;
  summarizedAcceptedBuilds: number;
  removedBuildInputBytes: number;
  removedBuildOutputBytes: number;
  removedSnapshotBytes: number;
  removedBuildReasoningBytes: number;
};

export type BrepAiModelContextProjection = {
  messages: AppUIMessage[];
  diagnostics: BrepAiModelContextProjectionDiagnostics;
};

export type BrepProviderModelContextProjectionDiagnostics = {
  applied: boolean;
  inputMessageCount: number;
  outputMessageCount: number;
  removedToolCalls: number;
  removedToolResults: number;
  removedBuildReasoningParts: number;
  insertedRevisionSummaries: number;
  removedToolInputBytes: number;
  removedToolOutputBytes: number;
  removedBuildReasoningBytes: number;
};

export type BrepProviderModelContextProjection = {
  messages: unknown[];
  branchDiagnostics: BrepAiModelContextProjectionDiagnostics;
  providerDiagnostics: BrepProviderModelContextProjectionDiagnostics;
};

type FollowUpBranchProjection = BrepAiModelContextProjection & {
  summariesByToolCallId: Map<string, string>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength;
  } catch {
    return 0;
  }
}

function textBytes(value: unknown): number {
  return typeof value === 'string'
    ? new TextEncoder().encode(value).byteLength
    : 0;
}

function compactAcceptedBuildSummary(part: unknown): string | undefined {
  const record = asRecord(part);
  if (
    record?.type !== 'tool-build_brep_project' ||
    record.state !== 'output-available'
  ) {
    return undefined;
  }

  const output = asRecord(record.output);
  if (output?.status !== 'success' || typeof output.message !== 'string') {
    return undefined;
  }

  const normalized = output.message.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  const bounded =
    normalized.length <= BREP_HISTORY_SUMMARY_MAX_CHARS
      ? normalized
      : `${normalized.slice(0, BREP_HISTORY_SUMMARY_MAX_CHARS - 1)}…`;
  return `Prior accepted Native BRep revision: ${bounded}`;
}

function projectFollowUpBranch(
  messages: readonly AppUIMessage[],
): FollowUpBranchProjection {
  const diagnostics: BrepAiModelContextProjectionDiagnostics = {
    applied: true,
    inputMessageCount: messages.length,
    outputMessageCount: messages.length,
    removedBuildToolParts: 0,
    removedBrepSnapshotParts: 0,
    removedBuildReasoningParts: 0,
    summarizedAcceptedBuilds: 0,
    removedBuildInputBytes: 0,
    removedBuildOutputBytes: 0,
    removedSnapshotBytes: 0,
    removedBuildReasoningBytes: 0,
  };
  const summariesByToolCallId = new Map<string, string>();
  const projected: AppUIMessage[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant') {
      // Preserve user intent, including the current leaf turn, byte-for-byte at
      // the UI-message layer. Image projection belongs to C4, not C3/C6.
      projected.push(message);
      continue;
    }

    const containsBrepBuild = message.parts.some(
      (part) => part.type === 'tool-build_brep_project',
    );
    const parts: AppUIMessage['parts'] = [];
    for (const part of message.parts) {
      if (part.type === 'data-brep-project') {
        diagnostics.removedBrepSnapshotParts += 1;
        diagnostics.removedSnapshotBytes += jsonBytes(part.data);
        continue;
      }

      if (containsBrepBuild && part.type === 'reasoning') {
        diagnostics.removedBuildReasoningParts += 1;
        diagnostics.removedBuildReasoningBytes += textBytes(part.text);
        continue;
      }

      if (part.type === 'tool-build_brep_project') {
        diagnostics.removedBuildToolParts += 1;
        if ('input' in part && part.input !== undefined) {
          diagnostics.removedBuildInputBytes += jsonBytes(part.input);
        }
        if ('output' in part && part.output !== undefined) {
          diagnostics.removedBuildOutputBytes += jsonBytes(part.output);
        }

        const summary = compactAcceptedBuildSummary(part);
        if (summary) {
          parts.push({ type: 'text', text: summary });
          diagnostics.summarizedAcceptedBuilds += 1;
          if (
            'toolCallId' in part &&
            typeof part.toolCallId === 'string' &&
            part.toolCallId
          ) {
            summariesByToolCallId.set(part.toolCallId, summary);
          }
        }
        continue;
      }

      parts.push(part);
    }

    // A source-only assistant message (for example an imported canonical
    // revision) contributes no additional provider intent once the current
    // canonical source is injected separately, so omit an empty shell.
    if (parts.length > 0) projected.push({ ...message, parts });
  }

  diagnostics.outputMessageCount = projected.length;
  return { messages: projected, diagnostics, summariesByToolCallId };
}

function noopBranchProjection(
  messages: readonly AppUIMessage[],
): FollowUpBranchProjection {
  return {
    messages: [...messages],
    diagnostics: {
      applied: false,
      inputMessageCount: messages.length,
      outputMessageCount: messages.length,
      removedBuildToolParts: 0,
      removedBrepSnapshotParts: 0,
      removedBuildReasoningParts: 0,
      summarizedAcceptedBuilds: 0,
      removedBuildInputBytes: 0,
      removedBuildOutputBytes: 0,
      removedSnapshotBytes: 0,
      removedBuildReasoningBytes: 0,
    },
    summariesByToolCallId: new Map(),
  };
}

/**
 * Build a request-local UI-message projection for Native BRep follow-up turns.
 * Durable UI/message history remains untouched and remains the source used for
 * branch/source resolution.
 */
export function projectBrepAiModelContext({
  messages,
  activeBrepSource,
}: {
  messages: readonly AppUIMessage[];
  activeBrepSource: BrepAiSourceRevision | undefined;
}): BrepAiModelContextProjection {
  const projection =
    activeBrepSource && !isBrepAiCreationRoute(activeBrepSource)
      ? projectFollowUpBranch(messages)
      : noopBranchProjection(messages);
  return {
    messages: projection.messages,
    diagnostics: projection.diagnostics,
  };
}

/**
 * Project the already-converted provider message array for a persisted Native
 * BRep follow-up. This is a second, provider-facing safety boundary: complete
 * historical build_brep_project tool inputs/results are removed even if SDK
 * conversion details change, while bounded success summaries are retained.
 *
 * Historical assistant reasoning attached to a superseded BRep build is also
 * omitted. It is neither user intent nor geometry authority; the bounded
 * revision summary plus the separately injected current canonical project are
 * the provider working-memory representation for that accepted revision.
 *
 * The current canonical BRep is deliberately not reconstructed here. It is
 * injected exactly once through the authoritative BRep system context.
 */
export function projectBrepProviderModelMessages({
  modelMessages,
  branchMessages,
  enabled,
}: {
  modelMessages: readonly unknown[];
  branchMessages: readonly AppUIMessage[];
  enabled: boolean;
}): BrepProviderModelContextProjection {
  const branchProjection = enabled
    ? projectFollowUpBranch(branchMessages)
    : noopBranchProjection(branchMessages);
  const providerDiagnostics: BrepProviderModelContextProjectionDiagnostics = {
    applied: enabled,
    inputMessageCount: modelMessages.length,
    outputMessageCount: modelMessages.length,
    removedToolCalls: 0,
    removedToolResults: 0,
    removedBuildReasoningParts: 0,
    insertedRevisionSummaries: 0,
    removedToolInputBytes: 0,
    removedToolOutputBytes: 0,
    removedBuildReasoningBytes: 0,
  };

  if (!enabled) {
    return {
      messages: [...modelMessages],
      branchDiagnostics: branchProjection.diagnostics,
      providerDiagnostics,
    };
  }

  const projected: unknown[] = [];
  for (const message of modelMessages) {
    const record = asRecord(message);
    if (!record || !Array.isArray(record.content)) {
      projected.push(message);
      continue;
    }

    const containsBrepBuild = record.content.some((contentPart) => {
      const part = asRecord(contentPart);
      return part?.type === 'tool-call' && part.toolName === BREP_BUILD_TOOL_NAME;
    });
    const keptContent: unknown[] = [];
    const revisionSummaries: string[] = [];
    for (const contentPart of record.content) {
      const part = asRecord(contentPart);
      if (
        part?.type === 'tool-call' &&
        part.toolName === BREP_BUILD_TOOL_NAME
      ) {
        providerDiagnostics.removedToolCalls += 1;
        if (part.input !== undefined) {
          providerDiagnostics.removedToolInputBytes += jsonBytes(part.input);
        }
        continue;
      }

      if (containsBrepBuild && part?.type === 'reasoning') {
        providerDiagnostics.removedBuildReasoningParts += 1;
        providerDiagnostics.removedBuildReasoningBytes += textBytes(part.text);
        continue;
      }

      if (
        part?.type === 'tool-result' &&
        part.toolName === BREP_BUILD_TOOL_NAME
      ) {
        providerDiagnostics.removedToolResults += 1;
        if (part.output !== undefined) {
          providerDiagnostics.removedToolOutputBytes += jsonBytes(part.output);
        }
        const toolCallId =
          typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
        const summary = toolCallId
          ? branchProjection.summariesByToolCallId.get(toolCallId)
          : undefined;
        if (summary) revisionSummaries.push(summary);
        continue;
      }

      keptContent.push(contentPart);
    }

    if (keptContent.length > 0) {
      projected.push({ ...record, content: keptContent });
    }
    if (revisionSummaries.length > 0) {
      projected.push({
        role: 'assistant',
        content: revisionSummaries.join('\n'),
      });
      providerDiagnostics.insertedRevisionSummaries += revisionSummaries.length;
    }
  }

  providerDiagnostics.outputMessageCount = projected.length;
  return {
    messages: projected,
    branchDiagnostics: branchProjection.diagnostics,
    providerDiagnostics,
  };
}
