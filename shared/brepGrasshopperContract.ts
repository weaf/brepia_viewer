import {
  brepNodeValueKind,
  normalizeBrepProject,
  type BrepParameterUnit,
  type BrepProject,
  type BrepProjectObjectPointKind,
} from './brepProject.ts';

export const BREP_GRASSHOPPER_CONTRACT_KIND =
  'brepia-grasshopper-contract' as const;
export const BREP_GRASSHOPPER_CONTRACT_SCHEMA_VERSION = 1 as const;
export const BREP_GRASSHOPPER_CONTRACT_MAX_BYTES = 2_097_152;
export const BREP_GRASSHOPPER_PLACEMENT_INPUT_ID = 'placement' as const;

const REVISION_ID_MAX_CHARS = 160;

export type BrepGrasshopperAccess = 'item' | 'list';

export type BrepGrasshopperNumberInput = {
  id: string;
  label: string;
  type: 'number';
  access: 'item';
  unit: BrepParameterUnit;
  default: number;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  fallback: 'project-default';
};

export type BrepGrasshopperPlacementInput = {
  id: typeof BREP_GRASSHOPPER_PLACEMENT_INPUT_ID;
  label: 'Plane';
  type: 'plane';
  access: 'item';
  description: string;
  fallback: 'project-placement';
};

export type BrepGrasshopperInput =
  | BrepGrasshopperNumberInput
  | BrepGrasshopperPlacementInput;

export type BrepGrasshopperBrepOutput = {
  id: 'result' | 'footprint' | 'clearanceEnvelope' | 'maintenanceEnvelope';
  label: string;
  type: 'brep';
  access: BrepGrasshopperAccess;
  optional: boolean;
  semantic:
    | 'primary-result'
    | 'footprint'
    | 'clearance-envelope'
    | 'maintenance-envelope';
};

export type BrepGrasshopperSemanticPointOutput = {
  id: 'connectionPoints' | 'mountingPoints' | 'cablePoints';
  label: string;
  type: 'semantic-point';
  access: 'list';
  pointKind: BrepProjectObjectPointKind;
  optional: false;
};

export type BrepGrasshopperMetadataOutput = {
  id: 'metadata';
  label: 'Metadata';
  type: 'project-metadata';
  access: 'item';
  optional: false;
};

export type BrepGrasshopperOutput =
  | BrepGrasshopperBrepOutput
  | BrepGrasshopperSemanticPointOutput
  | BrepGrasshopperMetadataOutput;

export type BrepGrasshopperPlacementSemantics = {
  inputId: typeof BREP_GRASSHOPPER_PLACEMENT_INPUT_ID;
  unconnected: 'resolved-project-placement';
  connected: 'replace-project-placement';
  sourceGeometrySpace: 'component-local';
  application: 'transform-all-project-outputs-to-target-plane';
  axisMeaning: 'orientation-only';
};

export type BrepGrasshopperDiagnostics = {
  mode: 'grasshopper-runtime-messages';
  warningSeverity: 'warning';
  errorSeverity: 'error';
};

export type BrepGrasshopperModelIdentity = {
  projectId: string;
  projectName: string;
  projectSchemaVersion: number;
  sourceRevisionId: string;
};

export type BrepGrasshopperContract = {
  kind: typeof BREP_GRASSHOPPER_CONTRACT_KIND;
  schemaVersion: typeof BREP_GRASSHOPPER_CONTRACT_SCHEMA_VERSION;
  model: BrepGrasshopperModelIdentity;
  source: BrepProject;
  interface: {
    inputs: BrepGrasshopperInput[];
    outputs: BrepGrasshopperOutput[];
  };
  placement: BrepGrasshopperPlacementSemantics;
  diagnostics: BrepGrasshopperDiagnostics;
};

export type BrepGrasshopperContractErrorCode =
  | 'invalid_contract'
  | 'invalid_json'
  | 'unsupported_version'
  | 'too_large';

export class BrepGrasshopperContractError extends Error {
  constructor(
    public readonly code: BrepGrasshopperContractErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BrepGrasshopperContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeRevisionId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BrepGrasshopperContractError(
      'invalid_contract',
      'Grasshopper contract sourceRevisionId must be text.',
    );
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > REVISION_ID_MAX_CHARS) {
    throw new BrepGrasshopperContractError(
      'invalid_contract',
      `Grasshopper contract sourceRevisionId must be non-empty and at most ${REVISION_ID_MAX_CHARS} characters.`,
    );
  }
  return normalized;
}

function numberInput(
  parameter: BrepProject['parameters'][number],
): BrepGrasshopperNumberInput {
  return {
    id: parameter.id,
    label: parameter.label,
    type: 'number',
    access: 'item',
    unit: parameter.unit,
    default: parameter.default,
    ...(parameter.min != null ? { min: parameter.min } : {}),
    ...(parameter.max != null ? { max: parameter.max } : {}),
    ...(parameter.step != null ? { step: parameter.step } : {}),
    ...(parameter.description ? { description: parameter.description } : {}),
    fallback: 'project-default',
  };
}

function standardOutputs(source: BrepProject): BrepGrasshopperOutput[] {
  const resultNode = source.nodes.find((node) => node.id === source.resultNodeId)!;
  const resultAccess: BrepGrasshopperAccess =
    brepNodeValueKind(resultNode) === 'instanceSet' ? 'list' : 'item';
  return [
    {
      id: 'result',
      label: 'Result',
      type: 'brep',
      access: resultAccess,
      optional: false,
      semantic: 'primary-result',
    },
    {
      id: 'footprint',
      label: 'Footprint',
      type: 'brep',
      access: 'item',
      optional: true,
      semantic: 'footprint',
    },
    {
      id: 'clearanceEnvelope',
      label: 'Clearance',
      type: 'brep',
      access: 'item',
      optional: true,
      semantic: 'clearance-envelope',
    },
    {
      id: 'maintenanceEnvelope',
      label: 'Maintenance',
      type: 'brep',
      access: 'item',
      optional: true,
      semantic: 'maintenance-envelope',
    },
    {
      id: 'connectionPoints',
      label: 'Connections',
      type: 'semantic-point',
      access: 'list',
      pointKind: 'connection',
      optional: false,
    },
    {
      id: 'mountingPoints',
      label: 'Mounting',
      type: 'semantic-point',
      access: 'list',
      pointKind: 'mounting',
      optional: false,
    },
    {
      id: 'cablePoints',
      label: 'Cable',
      type: 'semantic-point',
      access: 'list',
      pointKind: 'cable',
      optional: false,
    },
    {
      id: 'metadata',
      label: 'Metadata',
      type: 'project-metadata',
      access: 'item',
      optional: false,
    },
  ];
}

function buildContract(
  source: BrepProject,
  sourceRevisionId: string,
): BrepGrasshopperContract {
  const inputs: BrepGrasshopperInput[] = [
    ...source.parameters.map(numberInput),
    {
      id: BREP_GRASSHOPPER_PLACEMENT_INPUT_ID,
      label: 'Plane',
      type: 'plane',
      access: 'item',
      description:
        'Target insertion plane. When unconnected, Brepia resolves the project placement under the current parameter values.',
      fallback: 'project-placement',
    },
  ];

  return {
    kind: BREP_GRASSHOPPER_CONTRACT_KIND,
    schemaVersion: BREP_GRASSHOPPER_CONTRACT_SCHEMA_VERSION,
    model: {
      projectId: source.id,
      projectName: source.name,
      projectSchemaVersion: source.schemaVersion,
      sourceRevisionId,
    },
    source,
    interface: {
      inputs,
      outputs: standardOutputs(source),
    },
    placement: {
      inputId: BREP_GRASSHOPPER_PLACEMENT_INPUT_ID,
      unconnected: 'resolved-project-placement',
      connected: 'replace-project-placement',
      sourceGeometrySpace: 'component-local',
      application: 'transform-all-project-outputs-to-target-plane',
      axisMeaning: 'orientation-only',
    },
    diagnostics: {
      mode: 'grasshopper-runtime-messages',
      warningSeverity: 'warning',
      errorSeverity: 'error',
    },
  };
}

export function createBrepGrasshopperContract({
  project,
  sourceRevisionId,
}: {
  project: unknown;
  sourceRevisionId: string;
}): BrepGrasshopperContract {
  let source: BrepProject;
  try {
    source = normalizeBrepProject(project);
  } catch (error) {
    throw new BrepGrasshopperContractError(
      'invalid_contract',
      'Grasshopper contract source BRep project is invalid.',
      error,
    );
  }
  return buildContract(source, normalizeRevisionId(sourceRevisionId));
}

/**
 * Normalize a portable generated contract. The interface, placement and
 * diagnostics sections are deliberately rebuilt from canonical source rather
 * than trusted as an independent authority.
 */
export function normalizeBrepGrasshopperContract(
  value: unknown,
): BrepGrasshopperContract {
  if (!isRecord(value)) {
    throw new BrepGrasshopperContractError(
      'invalid_contract',
      'Grasshopper contract must be an object.',
    );
  }
  if (value.kind !== BREP_GRASSHOPPER_CONTRACT_KIND) {
    throw new BrepGrasshopperContractError(
      'invalid_contract',
      `Grasshopper contract kind must be ${BREP_GRASSHOPPER_CONTRACT_KIND}.`,
    );
  }
  if (value.schemaVersion !== BREP_GRASSHOPPER_CONTRACT_SCHEMA_VERSION) {
    if (typeof value.schemaVersion === 'number') {
      throw new BrepGrasshopperContractError(
        'unsupported_version',
        `Unsupported Grasshopper contract schema version: ${value.schemaVersion}.`,
      );
    }
    throw new BrepGrasshopperContractError(
      'invalid_contract',
      'Grasshopper contract schemaVersion is required.',
    );
  }
  if (!isRecord(value.model)) {
    throw new BrepGrasshopperContractError(
      'invalid_contract',
      'Grasshopper contract model identity is required.',
    );
  }

  let source: BrepProject;
  try {
    source = normalizeBrepProject(value.source);
  } catch (error) {
    throw new BrepGrasshopperContractError(
      'invalid_contract',
      'Grasshopper contract source BRep project is invalid.',
      error,
    );
  }

  const sourceRevisionId = normalizeRevisionId(value.model.sourceRevisionId);
  if (
    value.model.projectId !== source.id ||
    value.model.projectName !== source.name ||
    value.model.projectSchemaVersion !== source.schemaVersion
  ) {
    throw new BrepGrasshopperContractError(
      'invalid_contract',
      'Grasshopper contract model identity does not match its canonical BRep source.',
    );
  }

  return buildContract(source, sourceRevisionId);
}

export function serializeBrepGrasshopperContract(value: unknown): string {
  return `${JSON.stringify(normalizeBrepGrasshopperContract(value), null, 2)}\n`;
}

export function parseBrepGrasshopperContractJson(
  text: string,
): BrepGrasshopperContract {
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > BREP_GRASSHOPPER_CONTRACT_MAX_BYTES) {
    throw new BrepGrasshopperContractError(
      'too_large',
      `Grasshopper contract exceeds ${BREP_GRASSHOPPER_CONTRACT_MAX_BYTES} bytes.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new BrepGrasshopperContractError(
      'invalid_json',
      'Grasshopper contract is not valid JSON.',
      error,
    );
  }
  return normalizeBrepGrasshopperContract(value);
}
