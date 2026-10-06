import { createBrepGrasshopperContract } from '@shared/brepGrasshopperContract';
import { BREP_GRASSHOPPER_GHX_ARCHIVE_MAX_BYTES } from '@shared/brepGrasshopperGhxArchive';
import {
  validateBrepGrasshopperExecutableGhx,
  type BrepGrasshopperExecutableGhxDiagnostic,
} from '@shared/brepGrasshopperExecutableGhxValidation';
import type { BrepProject } from '@shared/brepProject';

export type BrepGrasshopperGhxImportResult = {
  parameterValues: Record<string, number>;
  changedParameterIds: string[];
};

export type BrepGrasshopperGhxFileLike = {
  size: number;
  text: () => Promise<string>;
};

export class BrepGrasshopperGhxImportError extends Error {
  constructor(
    readonly diagnostics: BrepGrasshopperExecutableGhxDiagnostic[],
  ) {
    const first = diagnostics[0];
    super(
      first
        ? `Returned Grasshopper GHX is not safely round-trippable (${first.code}): ${first.message}`
        : 'Returned Grasshopper GHX is not safely round-trippable.',
    );
    this.name = 'BrepGrasshopperGhxImportError';
  }
}

function importDiagnostic(
  code: string,
  message: string,
  path = 'ghx',
): BrepGrasshopperExecutableGhxDiagnostic {
  return { code, severity: 'error', message, path };
}

/**
 * Validate a returned GHX against the exact active immutable Brepia revision.
 * Only the strict v1 parameter-edit subset is recoverable. Unknown graph,
 * wiring, runtime or script mutations remain diagnostics and never become
 * canonical Brepia state.
 */
export async function importBrepGrasshopperGhx(
  project: BrepProject,
  sourceRevisionId: string,
  ghx: string,
): Promise<BrepGrasshopperGhxImportResult> {
  const contract = createBrepGrasshopperContract({
    project,
    sourceRevisionId,
  });
  const validation = await validateBrepGrasshopperExecutableGhx(
    ghx,
    contract,
    'returned',
  );
  if (!validation.accepted) {
    throw new BrepGrasshopperGhxImportError(validation.diagnostics);
  }

  const parameterValues: Record<string, number> = {};
  const changedParameterIds: string[] = [];
  for (const parameter of project.parameters) {
    const value = validation.parameters[parameter.id];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BrepGrasshopperGhxImportError([
        importDiagnostic(
          'missing_parameter_value',
          `Returned GHX did not recover a finite value for Brepia parameter ${parameter.id}.`,
          `parameter:${parameter.id}`,
        ),
      ]);
    }
    parameterValues[parameter.id] = value;
    if (value !== parameter.default) changedParameterIds.push(parameter.id);
  }

  return { parameterValues, changedParameterIds };
}

/**
 * Reject oversized browser files before File.text() allocates the complete GHX
 * string. The archive parser independently rechecks the encoded byte length so
 * this is an early resource bound, not a replacement for parser validation.
 */
export async function importBrepGrasshopperGhxFile(
  project: BrepProject,
  sourceRevisionId: string,
  file: BrepGrasshopperGhxFileLike,
): Promise<BrepGrasshopperGhxImportResult> {
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new BrepGrasshopperGhxImportError([
      importDiagnostic('invalid_file_size', 'Returned GHX file size is invalid.'),
    ]);
  }
  if (file.size > BREP_GRASSHOPPER_GHX_ARCHIVE_MAX_BYTES) {
    throw new BrepGrasshopperGhxImportError([
      importDiagnostic(
        'too_large',
        `Returned GHX exceeds the ${BREP_GRASSHOPPER_GHX_ARCHIVE_MAX_BYTES}-byte import limit.`,
      ),
    ]);
  }

  return importBrepGrasshopperGhx(project, sourceRevisionId, await file.text());
}
