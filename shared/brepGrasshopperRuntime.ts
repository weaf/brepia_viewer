import {
  normalizeBrepGrasshopperContract,
  type BrepGrasshopperModelIdentity,
} from './brepGrasshopperContract';

export const BREP_GRASSHOPPER_EXACT_ARTIFACT_MANIFEST_KIND =
  'brepia-grasshopper-exact-artifacts' as const;
export const BREP_GRASSHOPPER_EXACT_ARTIFACT_MANIFEST_SCHEMA_VERSION = 1 as const;

export type BrepGrasshopperExactBrepRole =
  | 'result'
  | 'footprint'
  | 'clearanceEnvelope'
  | 'maintenanceEnvelope';

export type BrepGrasshopperExactArtifact = {
  role: BrepGrasshopperExactBrepRole;
  nodeId: string;
  format: 'step';
  representation: 'exact-brep';
  contentType: 'model/step';
  fileName: string;
};

export type BrepGrasshopperExactArtifactManifest = {
  kind: typeof BREP_GRASSHOPPER_EXACT_ARTIFACT_MANIFEST_KIND;
  schemaVersion: typeof BREP_GRASSHOPPER_EXACT_ARTIFACT_MANIFEST_SCHEMA_VERSION;
  model: BrepGrasshopperModelIdentity;
  artifacts: BrepGrasshopperExactArtifact[];
};

const ARTIFACT_FILENAMES: Record<BrepGrasshopperExactBrepRole, string> = {
  // Keep the Phase 5 exact-primary embedded filename stable for compatibility.
  result: 'brepia-primary.step',
  footprint: 'brepia-footprint.step',
  clearanceEnvelope: 'brepia-clearance-envelope.step',
  maintenanceEnvelope: 'brepia-maintenance-envelope.step',
};

export function brepGrasshopperExactArtifactFileName(
  role: BrepGrasshopperExactBrepRole,
): string {
  return ARTIFACT_FILENAMES[role];
}

function artifact(
  role: BrepGrasshopperExactBrepRole,
  nodeId: string,
): BrepGrasshopperExactArtifact {
  return {
    role,
    nodeId,
    format: 'step',
    representation: 'exact-brep',
    contentType: 'model/step',
    fileName: brepGrasshopperExactArtifactFileName(role),
  };
}

/**
 * Build the exact geometry hand-off manifest used by the Phase 7 runtime.
 *
 * The manifest is always reconstructed from the normalized Phase 6 contract.
 * Display labels and other derived interface fields can therefore never change
 * exact artifact identity. Optional role artifacts only exist when the
 * canonical BrepProject assigns a node to that project-object role.
 */
export function createBrepGrasshopperExactArtifactManifest(
  value: unknown,
): BrepGrasshopperExactArtifactManifest {
  const contract = normalizeBrepGrasshopperContract(value);
  const definition = contract.source.projectObject;
  const artifacts: BrepGrasshopperExactArtifact[] = [
    artifact('result', contract.source.resultNodeId),
  ];

  if (definition?.footprintNodeId) {
    artifacts.push(artifact('footprint', definition.footprintNodeId));
  }
  if (definition?.clearanceEnvelopeNodeId) {
    artifacts.push(
      artifact('clearanceEnvelope', definition.clearanceEnvelopeNodeId),
    );
  }
  if (definition?.maintenanceEnvelopeNodeId) {
    artifacts.push(
      artifact('maintenanceEnvelope', definition.maintenanceEnvelopeNodeId),
    );
  }

  return {
    kind: BREP_GRASSHOPPER_EXACT_ARTIFACT_MANIFEST_KIND,
    schemaVersion: BREP_GRASSHOPPER_EXACT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    model: { ...contract.model },
    artifacts,
  };
}
