import type { AppUIMessage } from '@shared/chatAi';
import type { BrepAiSourceRevision } from '@shared/brepAiContext';
import type { BrepAiBuildInput } from '@shared/brepAiTool';
import {
  BrepAiFinalizationError,
  finalizeBrepAiAssistantParts,
} from './brepAiTurn';

export type BrepFinalizationRunFailureSink = {
  failed: (code: string) => Promise<void>;
};

export async function finalizeBrepAiAssistantPartsForRun({
  parts,
  activeBrepSource,
  acceptedBuildInput,
  generationRun,
}: {
  parts: AppUIMessage['parts'];
  activeBrepSource: BrepAiSourceRevision | undefined;
  acceptedBuildInput?: BrepAiBuildInput;
  generationRun: BrepFinalizationRunFailureSink;
}) {
  try {
    return finalizeBrepAiAssistantParts({
      parts,
      activeBrepSource,
      acceptedBuildInput,
    });
  } catch (error) {
    await generationRun.failed(
      error instanceof BrepAiFinalizationError
        ? error.code
        : 'brep_finalization_failed',
    );
    throw error;
  }
}
