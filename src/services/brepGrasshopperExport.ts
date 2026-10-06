import {
  createBrepGrasshopperContract,
  type BrepGrasshopperContract,
} from '@shared/brepGrasshopperContract';
import { compileBrepGrasshopperExecutableGhx } from '@shared/brepGrasshopperExecutableGhx';
import type { BrepProject } from '@shared/brepProject';

export type BrepGrasshopperGhxExport = {
  contract: BrepGrasshopperContract;
  ghx: string;
};

/**
 * Compile the active immutable canonical BRep revision into the deliberately
 * narrow zero-install GHX subset. Unsupported canonical geometry fails closed
 * in the shared compiler instead of being approximated for Grasshopper.
 */
export async function exportBrepGrasshopperGhx(
  project: BrepProject,
  sourceRevisionId: string,
): Promise<BrepGrasshopperGhxExport> {
  const contract = createBrepGrasshopperContract({
    project,
    sourceRevisionId,
  });
  const ghx = await compileBrepGrasshopperExecutableGhx(contract);
  return { contract, ghx };
}
