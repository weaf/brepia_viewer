import type { AppUIMessage, BrepProjectArtifactData } from '@shared/chatAi';
import {
  brepAiBuildInputSchema,
  brepAiBuildOutputSchema,
  type BrepAiBuildInput,
  type BrepAiBuildOutput,
} from '@shared/brepAiTool';
import {
  BrepAiProjectError,
  validateBrepAiCreation,
  validateBrepAiFollowUp,
  type BrepProjectStructuralDiff,
} from '@shared/brepAiProject';
import {
  isBrepAiCreationRoute,
  type BrepAiSourceRevision,
} from '@shared/brepAiContext';
import { createBrepProjectArtifact } from '@shared/brepProjectArtifact';
import { renderInstructionTemplate } from '@shared/aiInstructionCatalog';
import { serializeBrepAiProjectContext } from '@shared/brepAiContext';
import { boundBrepRepairDiagnostic } from './opencodeAgentResult';
import {
  recordActiveBrepBuildAttemptFinished,
  recordActiveBrepBuildAttemptStarted,
} from './generationRunTelemetry';

const DEFAULT_BREP_CREATION_CONTEXT = `This turn was explicitly routed by the product to create a new native BRep project. No previous BRep project exists. Ignore OpenSCAD-specific creation instructions for this turn and return one complete canonical native BRep project in the final-result JSON envelope. The external transport does not expose build_brep_project as a callable tool: do not emit or imitate a build_brep_project tool call, <tool_call>, <arg_key>, or <arg_value> markup. Brepia validates the JSON envelope and converts its project into build_brep_project itself. Do not fabricate previous-project state, emit OpenSCAD/Python/build123d source, STEP, mesh/tessellation authority, filesystem paths, or raw topology indices. Use only the canonical BRep schema and supported semantic selectors.`;

export type ParametricBuildToolName =
  | 'build_parametric_model'
  | 'build_brep_project';

export type FinalizedBrepAiAssistant = {
  parts: AppUIMessage['parts'];
  artifact?: BrepProjectArtifactData;
  diff?: BrepProjectStructuralDiff;
};

export class BrepAiFinalizationError extends Error {
  constructor(
    public readonly code: 'missing_creation_artifact',
    message: string,
  ) {
    super(message);
    this.name = 'BrepAiFinalizationError';
  }
}

export function parametricBuildToolName(
  activeBrepSource: BrepAiSourceRevision | undefined,
): ParametricBuildToolName {
  return activeBrepSource ? 'build_brep_project' : 'build_parametric_model';
}

export function withBrepProjectSystemContext({
  systemPrompt,
  contextTemplate,
  creationContext,
  activeBrepSource,
}: {
  systemPrompt: string;
  contextTemplate: string;
  creationContext?: string;
  activeBrepSource: BrepAiSourceRevision | undefined;
}): string {
  if (!activeBrepSource) return systemPrompt;
  if (isBrepAiCreationRoute(activeBrepSource)) {
    const context = creationContext?.trim() || DEFAULT_BREP_CREATION_CONTEXT;
    return `${systemPrompt.trim()}\n\n${context}`;
  }
  const context = renderInstructionTemplate(contextTemplate, {
    projectJson: serializeBrepAiProjectContext(activeBrepSource.project),
  });
  return `${systemPrompt.trim()}\n\n${context.trim()}`;
}

function brepBuildTelemetryFailure(error: unknown): {
  errorCode: string;
  errorMessage?: string;
} {
  if (error instanceof BrepAiProjectError) {
    return { errorCode: error.code, errorMessage: error.message };
  }
  if (error instanceof Error) {
    return { errorCode: error.name || 'build_rejected' };
  }
  return { errorCode: 'build_rejected' };
}

export function executeBrepAiBuild({
  activeBrepSource,
  input,
  onAcceptedInput,
}: {
  activeBrepSource: BrepAiSourceRevision;
  input: unknown;
  onAcceptedInput?: (input: BrepAiBuildInput) => void;
}): BrepAiBuildOutput {
  const telemetryAttempt = recordActiveBrepBuildAttemptStarted();
  try {
    const parsed = brepAiBuildInputSchema.parse(input) as BrepAiBuildInput;
    const message = isBrepAiCreationRoute(activeBrepSource)
      ? (() => {
          validateBrepAiCreation(parsed.project);
          return 'Created canonical native BRep project.';
        })()
      : validateBrepAiFollowUp(activeBrepSource.project, parsed.project).diff
          .summary;
    const output = brepAiBuildOutputSchema.parse({
      status: 'success',
      message,
    });
    // Keep the last successfully validated candidate in request-local server
    // state. Persistence must not depend on how the AI SDK later reconstructs
    // the UI-message tool part in onFinish.
    onAcceptedInput?.(parsed);
    recordActiveBrepBuildAttemptFinished(telemetryAttempt, { accepted: true });
    return output;
  } catch (error) {
    recordActiveBrepBuildAttemptFinished(telemetryAttempt, {
      accepted: false,
      ...brepBuildTelemetryFailure(error),
    });
    throw error;
  }
}

function finalSuccessfulBuildInput(
  parts: AppUIMessage['parts'],
): BrepAiBuildInput | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (
      part.type !== 'tool-build_brep_project' ||
      part.state !== 'output-available'
    ) {
      continue;
    }
    brepAiBuildOutputSchema.parse(part.output);
    return brepAiBuildInputSchema.parse(part.input) as BrepAiBuildInput;
  }
  return undefined;
}

function finalBrepFailureDiagnostic(
  parts: AppUIMessage['parts'],
): string | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (
      part.type === 'tool-build_brep_project' &&
      part.state === 'output-error' &&
      typeof part.errorText === 'string' &&
      part.errorText.trim()
    ) {
      return boundBrepRepairDiagnostic(part.errorText);
    }
    if (part.type === 'text' && part.text.trim()) {
      return boundBrepRepairDiagnostic(part.text);
    }
  }
  return undefined;
}

/**
 * Revalidate the final successful BRep candidate against the exact source
 * snapshot used for generation, or as standalone canonical creation when the
 * turn was explicitly armed for first-source BRep creation. Then attach one
 * canonical data-brep-project part to the same immutable assistant response.
 * The request-local accepted candidate is authoritative when available;
 * scanning the UI message remains a compatibility fallback only. Earlier build
 * calls remain diagnostics and never become competing source revisions.
 */
export function finalizeBrepAiAssistantParts({
  parts,
  activeBrepSource,
  acceptedBuildInput,
}: {
  parts: AppUIMessage['parts'];
  activeBrepSource: BrepAiSourceRevision | undefined;
  acceptedBuildInput?: BrepAiBuildInput;
}): FinalizedBrepAiAssistant {
  if (!activeBrepSource) return { parts };

  const finalInput = acceptedBuildInput ?? finalSuccessfulBuildInput(parts);
  if (!finalInput) {
    if (isBrepAiCreationRoute(activeBrepSource)) {
      const diagnostic = finalBrepFailureDiagnostic(parts);
      throw new BrepAiFinalizationError(
        'missing_creation_artifact',
        [
          'Native BRep creation finished without a canonical project artifact.',
          diagnostic ? `Final diagnostic: ${diagnostic}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    }
    return { parts };
  }

  let project: ReturnType<typeof validateBrepAiCreation>['project'];
  let diff: BrepProjectStructuralDiff | undefined;
  if (isBrepAiCreationRoute(activeBrepSource)) {
    project = validateBrepAiCreation(finalInput.project).project;
  } else {
    const validation = validateBrepAiFollowUp(
      activeBrepSource.project,
      finalInput.project,
    );
    project = validation.project;
    diff = validation.diff;
  }

  const artifact = createBrepProjectArtifact({
    title: finalInput.title,
    version: finalInput.version,
    source: { kind: 'brep', source: project },
  });
  const withoutPriorBrepData = parts.filter(
    (part) => part.type !== 'data-brep-project',
  ) as AppUIMessage['parts'];

  return {
    parts: [
      ...withoutPriorBrepData,
      { type: 'data-brep-project', data: artifact },
    ],
    artifact,
    ...(diff ? { diff } : {}),
  };
}
