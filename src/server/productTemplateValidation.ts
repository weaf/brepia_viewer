import type { BrepEvaluationArtifact } from './brepEvaluation';
import { evaluateBrepProject } from './brepEvaluation';
import type { BrepEvaluationSuccess } from '@shared/brepProvider';
import type { BuiltinProductTemplateStaticValidation } from '@shared/productTemplateValidation';
import { validateBuiltinProductTemplateStatic } from '@shared/productTemplateValidation';

export type BuiltinProductTemplateNativeValidation = Readonly<{
  staticValidation: BuiltinProductTemplateStaticValidation;
  evaluation: BrepEvaluationSuccess;
  stepBytes: Uint8Array;
}>;

export class ProductTemplateNativeValidationError extends Error {
  constructor(
    public readonly code: 'result_kind_mismatch' | 'exact_step_missing',
    message: string,
  ) {
    super(message);
    this.name = 'ProductTemplateNativeValidationError';
  }
}

export async function validateBuiltinProductTemplateNative(
  value: unknown,
  signal?: AbortSignal,
): Promise<BuiltinProductTemplateNativeValidation> {
  const staticValidation = await validateBuiltinProductTemplateStatic(value);
  const artifact: BrepEvaluationArtifact = await evaluateBrepProject(
    staticValidation.template.source.source,
    undefined,
    signal,
  );

  if (artifact.result.status !== 'success') {
    throw new Error(
      `Native BRep evaluation unexpectedly returned failure for ${staticValidation.template.id}@${staticValidation.template.version}.`,
    );
  }

  if (artifact.result.resultKind !== staticValidation.expectedResultKind) {
    throw new ProductTemplateNativeValidationError(
      'result_kind_mismatch',
      `Built-in product template ${staticValidation.template.id}@${staticValidation.template.version} evaluated as ${artifact.result.resultKind}; expected ${staticValidation.expectedResultKind}.`,
    );
  }

  if (!artifact.result.exactExport.available || !artifact.stepBytes) {
    throw new ProductTemplateNativeValidationError(
      'exact_step_missing',
      `Built-in product template ${staticValidation.template.id}@${staticValidation.template.version} did not produce exact STEP.`,
    );
  }

  return Object.freeze({
    staticValidation,
    evaluation: artifact.result,
    stepBytes: artifact.stepBytes,
  });
}
