import { chatTools, type AppTools } from '@shared/chatAi';
import type { BrepAiSourceRevision } from '@shared/brepAiContext';
import type { BrepAiBuildInput } from '@shared/brepAiTool';
import { executeBrepAiBuild } from './brepAiTurn';

export type BrepBuildAttemptDiagnostic = {
  accepted: boolean;
  durationMs: number;
  error?: unknown;
};

/**
 * Native BRep tools execute on the chat server because their only operation is
 * canonical snapshot validation/diffing. They never invoke OCCT/build123d.
 * `answer_user` is also server-resolved here so a BRep turn has no browser-side
 * pending tool lifecycle that could overwrite the canonical source data part.
 */
export function brepParametricTools({
  activeBrepSource,
  buildDescription,
  answerDescription,
  onAcceptedBuild,
  onBuildAttempt,
}: {
  activeBrepSource: BrepAiSourceRevision;
  buildDescription: string;
  answerDescription: string;
  onAcceptedBuild?: (input: BrepAiBuildInput) => void;
  onBuildAttempt?: (diagnostic: BrepBuildAttemptDiagnostic) => void;
}) {
  return {
    build_brep_project: {
      ...chatTools.build_brep_project,
      description: buildDescription,
      execute: async (input: AppTools['build_brep_project']['input']) => {
        const startedAt = Date.now();
        try {
          const output = executeBrepAiBuild({
            activeBrepSource,
            input,
            onAcceptedInput: onAcceptedBuild,
          });
          onBuildAttempt?.({
            accepted: true,
            durationMs: Date.now() - startedAt,
          });
          return output;
        } catch (error) {
          onBuildAttempt?.({
            accepted: false,
            durationMs: Date.now() - startedAt,
            error,
          });
          throw error;
        }
      },
    },
    answer_user: {
      ...chatTools.answer_user,
      description: answerDescription,
      execute: async (input: AppTools['answer_user']['input']) => input,
    },
  };
}
