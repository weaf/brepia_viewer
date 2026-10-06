import {
  normalizeBrepGrasshopperContract,
  type BrepGrasshopperContract,
} from './brepGrasshopperContract.ts';
import { createBrepGrasshopperPackagePlan } from './brepGrasshopperPackagePlan.ts';

export const BREP_GRASSHOPPER_RECONCILIATION_KIND =
  'brepia-grasshopper-reconciliation' as const;
export const BREP_GRASSHOPPER_RECONCILIATION_SCHEMA_VERSION = 1 as const;
export const BREP_GRASSHOPPER_RECONCILIATION_MAX_BYTES = 4 * 1024 * 1024;
export const BREP_GRASSHOPPER_EXTERNAL_OBJECT_MAX_COUNT = 2_048;
export const BREP_GRASSHOPPER_EXTERNAL_CONNECTION_MAX_COUNT = 8_192;

const TEXT_MAX_CHARS = 512;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BrepGrasshopperParameterObservationInput = {
  id: string;
  value?: number;
  sourceObjectGuid?: string;
};

export type BrepGrasshopperExternalObjectEvidenceInput = {
  instanceGuid: string;
  componentGuid?: string;
  name?: string;
  nickname?: string;
};

export type BrepGrasshopperExternalConnectionEvidenceInput = {
  fromObjectGuid?: string;
  fromParamGuid: string;
  toObjectGuid?: string;
  toParamGuid: string;
};

export type BrepGrasshopperReconciliationInput = {
  contract: unknown;
  observedComponentInstanceGuid: string;
  parameters?: BrepGrasshopperParameterObservationInput[];
  placementSourceObjectGuid?: string | null;
  externalEvidence?: {
    completeness?: 'partial' | 'document-scan';
    objects?: BrepGrasshopperExternalObjectEvidenceInput[];
    connections?: BrepGrasshopperExternalConnectionEvidenceInput[];
  };
};

export type BrepGrasshopperReconciledParameter = {
  id: string;
  expectedControlInstanceGuid: string;
  valueStatus: 'resolved' | 'unresolved';
  value?: number;
  sourceOwnership:
    | 'generated-brepia-control'
    | 'external-grasshopper-source'
    | 'unconnected-or-unknown';
  sourceObjectGuid?: string;
};

export type BrepGrasshopperExternalObjectEvidence = {
  instanceGuid: string;
  componentGuid?: string;
  name?: string;
  nickname?: string;
};

export type BrepGrasshopperExternalConnectionEvidence = {
  fromObjectGuid?: string;
  fromParamGuid: string;
  toObjectGuid?: string;
  toParamGuid: string;
};

export type BrepGrasshopperReconciliationEnvelope = {
  kind: typeof BREP_GRASSHOPPER_RECONCILIATION_KIND;
  schemaVersion: typeof BREP_GRASSHOPPER_RECONCILIATION_SCHEMA_VERSION;
  model: BrepGrasshopperContract['model'];
  contract: BrepGrasshopperContract;
  componentIdentity: {
    expectedInstanceGuid: string;
    observedInstanceGuid: string;
    recognition: 'exact-generated-instance' | 'contract-recognized-instance';
  };
  parameters: BrepGrasshopperReconciledParameter[];
  placement: {
    inputId: 'placement';
    mode: 'project-placement' | 'grasshopper-source';
    sourceObjectGuid?: string;
  };
  externalEvidence: {
    authority: 'evidence-only';
    completeness: 'partial' | 'document-scan';
    objects: BrepGrasshopperExternalObjectEvidence[];
    connections: BrepGrasshopperExternalConnectionEvidence[];
  };
};

export type BrepGrasshopperReconciliationErrorCode =
  | 'invalid_reconciliation'
  | 'invalid_json'
  | 'unsupported_version'
  | 'too_large';

export class BrepGrasshopperReconciliationError extends Error {
  constructor(
    public readonly code: BrepGrasshopperReconciliationErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BrepGrasshopperReconciliationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') {
    throw new BrepGrasshopperReconciliationError(
      'invalid_reconciliation',
      `${field} must be text.`,
    );
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > TEXT_MAX_CHARS) {
    throw new BrepGrasshopperReconciliationError(
      'invalid_reconciliation',
      `${field} must be non-empty and at most ${TEXT_MAX_CHARS} characters.`,
    );
  }
  return normalized;
}

function normalizeGuid(value: unknown, field: string): string {
  const normalized = normalizeText(value, field);
  if (!normalized || !UUID.test(normalized)) {
    throw new BrepGrasshopperReconciliationError(
      'invalid_reconciliation',
      `${field} must be a UUID.`,
    );
  }
  return normalized.toLowerCase();
}

function normalizeOptionalGuid(value: unknown, field: string): string | undefined {
  return value == null ? undefined : normalizeGuid(value, field);
}

function assertCanonicalValue(
  value: number,
  parameter: BrepGrasshopperContract['source']['parameters'][number],
) {
  if (!Number.isFinite(value)) {
    throw new BrepGrasshopperReconciliationError(
      'invalid_reconciliation',
      `Observed value for ${parameter.id} must be finite.`,
    );
  }
  if (parameter.min != null && value < parameter.min) {
    throw new BrepGrasshopperReconciliationError(
      'invalid_reconciliation',
      `Observed value for ${parameter.id} is below its canonical minimum.`,
    );
  }
  if (parameter.max != null && value > parameter.max) {
    throw new BrepGrasshopperReconciliationError(
      'invalid_reconciliation',
      `Observed value for ${parameter.id} is above its canonical maximum.`,
    );
  }
}

function normalizeExternalObjects(
  value: BrepGrasshopperReconciliationInput['externalEvidence'],
): BrepGrasshopperExternalObjectEvidence[] {
  const objects = value?.objects ?? [];
  if (objects.length > BREP_GRASSHOPPER_EXTERNAL_OBJECT_MAX_COUNT) {
    throw new BrepGrasshopperReconciliationError(
      'too_large',
      `Grasshopper reconciliation external object evidence exceeds ${BREP_GRASSHOPPER_EXTERNAL_OBJECT_MAX_COUNT} objects.`,
    );
  }
  const seen = new Set<string>();
  return objects.map((object, index) => {
    const instanceGuid = normalizeGuid(
      object.instanceGuid,
      `externalEvidence.objects[${index}].instanceGuid`,
    );
    if (seen.has(instanceGuid)) {
      throw new BrepGrasshopperReconciliationError(
        'invalid_reconciliation',
        `Duplicate external Grasshopper object ${instanceGuid}.`,
      );
    }
    seen.add(instanceGuid);
    return {
      instanceGuid,
      ...(object.componentGuid != null
        ? {
            componentGuid: normalizeGuid(
              object.componentGuid,
              `externalEvidence.objects[${index}].componentGuid`,
            ),
          }
        : {}),
      ...(object.name != null
        ? { name: normalizeText(object.name, `externalEvidence.objects[${index}].name`) }
        : {}),
      ...(object.nickname != null
        ? {
            nickname: normalizeText(
              object.nickname,
              `externalEvidence.objects[${index}].nickname`,
            ),
          }
        : {}),
    };
  });
}

function normalizeExternalConnections(
  value: BrepGrasshopperReconciliationInput['externalEvidence'],
): BrepGrasshopperExternalConnectionEvidence[] {
  const connections = value?.connections ?? [];
  if (connections.length > BREP_GRASSHOPPER_EXTERNAL_CONNECTION_MAX_COUNT) {
    throw new BrepGrasshopperReconciliationError(
      'too_large',
      `Grasshopper reconciliation external connection evidence exceeds ${BREP_GRASSHOPPER_EXTERNAL_CONNECTION_MAX_COUNT} connections.`,
    );
  }
  const seen = new Set<string>();
  return connections.map((connection, index) => {
    const normalized: BrepGrasshopperExternalConnectionEvidence = {
      ...(connection.fromObjectGuid != null
        ? {
            fromObjectGuid: normalizeGuid(
              connection.fromObjectGuid,
              `externalEvidence.connections[${index}].fromObjectGuid`,
            ),
          }
        : {}),
      fromParamGuid: normalizeGuid(
        connection.fromParamGuid,
        `externalEvidence.connections[${index}].fromParamGuid`,
      ),
      ...(connection.toObjectGuid != null
        ? {
            toObjectGuid: normalizeGuid(
              connection.toObjectGuid,
              `externalEvidence.connections[${index}].toObjectGuid`,
            ),
          }
        : {}),
      toParamGuid: normalizeGuid(
        connection.toParamGuid,
        `externalEvidence.connections[${index}].toParamGuid`,
      ),
    };
    const key = `${normalized.fromObjectGuid ?? ''}:${normalized.fromParamGuid}->${normalized.toObjectGuid ?? ''}:${normalized.toParamGuid}`;
    if (seen.has(key)) {
      throw new BrepGrasshopperReconciliationError(
        'invalid_reconciliation',
        `Duplicate external Grasshopper connection evidence at index ${index}.`,
      );
    }
    seen.add(key);
    return normalized;
  });
}

export async function createBrepGrasshopperReconciliationEnvelope(
  input: BrepGrasshopperReconciliationInput,
): Promise<BrepGrasshopperReconciliationEnvelope> {
  let contract: BrepGrasshopperContract;
  try {
    contract = normalizeBrepGrasshopperContract(input.contract);
  } catch (error) {
    throw new BrepGrasshopperReconciliationError(
      'invalid_reconciliation',
      'Grasshopper reconciliation contains an invalid canonical Brepia contract.',
      error,
    );
  }

  const packagePlan = await createBrepGrasshopperPackagePlan(contract);
  const observedComponentInstanceGuid = normalizeGuid(
    input.observedComponentInstanceGuid,
    'observedComponentInstanceGuid',
  );
  const parameterObservations = new Map<string, BrepGrasshopperParameterObservationInput>();
  for (const [index, observation] of (input.parameters ?? []).entries()) {
    const id = normalizeText(observation.id, `parameters[${index}].id`);
    if (!id || parameterObservations.has(id)) {
      throw new BrepGrasshopperReconciliationError(
        'invalid_reconciliation',
        `Grasshopper reconciliation has a missing or duplicate parameter observation at index ${index}.`,
      );
    }
    if (!contract.source.parameters.some((parameter) => parameter.id === id)) {
      throw new BrepGrasshopperReconciliationError(
        'invalid_reconciliation',
        `Grasshopper reconciliation references unknown Brepia parameter ${id}.`,
      );
    }
    parameterObservations.set(id, observation);
  }

  const parameters = contract.source.parameters.map((parameter) => {
    const expectedControl = packagePlan.controls.find(
      (control) => control.inputId === parameter.id,
    );
    if (!expectedControl) {
      throw new BrepGrasshopperReconciliationError(
        'invalid_reconciliation',
        `Grasshopper package plan is missing Brepia parameter ${parameter.id}.`,
      );
    }
    const observation = parameterObservations.get(parameter.id);
    const sourceObjectGuid = observation?.sourceObjectGuid
      ? normalizeGuid(
          observation.sourceObjectGuid,
          `parameter ${parameter.id} sourceObjectGuid`,
        )
      : undefined;
    if (observation?.value != null) assertCanonicalValue(observation.value, parameter);

    return {
      id: parameter.id,
      expectedControlInstanceGuid: expectedControl.instanceGuid,
      valueStatus: observation?.value != null ? ('resolved' as const) : ('unresolved' as const),
      ...(observation?.value != null ? { value: observation.value } : {}),
      sourceOwnership:
        sourceObjectGuid == null
          ? ('unconnected-or-unknown' as const)
          : sourceObjectGuid === expectedControl.instanceGuid
            ? ('generated-brepia-control' as const)
            : ('external-grasshopper-source' as const),
      ...(sourceObjectGuid ? { sourceObjectGuid } : {}),
    };
  });

  const placementSourceObjectGuid = normalizeOptionalGuid(
    input.placementSourceObjectGuid,
    'placementSourceObjectGuid',
  );

  return {
    kind: BREP_GRASSHOPPER_RECONCILIATION_KIND,
    schemaVersion: BREP_GRASSHOPPER_RECONCILIATION_SCHEMA_VERSION,
    model: { ...contract.model },
    contract,
    componentIdentity: {
      expectedInstanceGuid: packagePlan.component.instanceGuid,
      observedInstanceGuid: observedComponentInstanceGuid,
      recognition:
        observedComponentInstanceGuid === packagePlan.component.instanceGuid
          ? 'exact-generated-instance'
          : 'contract-recognized-instance',
    },
    parameters,
    placement: {
      inputId: 'placement',
      mode: placementSourceObjectGuid ? 'grasshopper-source' : 'project-placement',
      ...(placementSourceObjectGuid ? { sourceObjectGuid: placementSourceObjectGuid } : {}),
    },
    externalEvidence: {
      authority: 'evidence-only',
      completeness: input.externalEvidence?.completeness ?? 'partial',
      objects: normalizeExternalObjects(input.externalEvidence),
      connections: normalizeExternalConnections(input.externalEvidence),
    },
  };
}

export async function normalizeBrepGrasshopperReconciliationEnvelope(
  value: unknown,
): Promise<BrepGrasshopperReconciliationEnvelope> {
  if (!isRecord(value)) {
    throw new BrepGrasshopperReconciliationError(
      'invalid_reconciliation',
      'Grasshopper reconciliation envelope must be an object.',
    );
  }
  if (value.kind !== BREP_GRASSHOPPER_RECONCILIATION_KIND) {
    throw new BrepGrasshopperReconciliationError(
      'invalid_reconciliation',
      `Grasshopper reconciliation kind must be ${BREP_GRASSHOPPER_RECONCILIATION_KIND}.`,
    );
  }
  if (value.schemaVersion !== BREP_GRASSHOPPER_RECONCILIATION_SCHEMA_VERSION) {
    if (typeof value.schemaVersion === 'number') {
      throw new BrepGrasshopperReconciliationError(
        'unsupported_version',
        `Unsupported Grasshopper reconciliation schema version: ${value.schemaVersion}.`,
      );
    }
    throw new BrepGrasshopperReconciliationError(
      'invalid_reconciliation',
      'Grasshopper reconciliation schemaVersion is required.',
    );
  }
  if (!isRecord(value.componentIdentity) || !Array.isArray(value.parameters)) {
    throw new BrepGrasshopperReconciliationError(
      'invalid_reconciliation',
      'Grasshopper reconciliation Brepia-owned state is incomplete.',
    );
  }
  if (!isRecord(value.placement) || !isRecord(value.externalEvidence)) {
    throw new BrepGrasshopperReconciliationError(
      'invalid_reconciliation',
      'Grasshopper reconciliation placement/external evidence is incomplete.',
    );
  }

  return createBrepGrasshopperReconciliationEnvelope({
    contract: value.contract,
    observedComponentInstanceGuid: value.componentIdentity.observedInstanceGuid as string,
    parameters: value.parameters.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new BrepGrasshopperReconciliationError(
          'invalid_reconciliation',
          `Grasshopper reconciliation parameter ${index} must be an object.`,
        );
      }
      return {
        id: entry.id as string,
        ...(entry.valueStatus === 'resolved' ? { value: entry.value as number } : {}),
        ...(entry.sourceObjectGuid != null
          ? { sourceObjectGuid: entry.sourceObjectGuid as string }
          : {}),
      };
    }),
    placementSourceObjectGuid:
      value.placement.mode === 'grasshopper-source'
        ? (value.placement.sourceObjectGuid as string)
        : null,
    externalEvidence: {
      completeness:
        value.externalEvidence.completeness === 'document-scan'
          ? 'document-scan'
          : 'partial',
      objects: Array.isArray(value.externalEvidence.objects)
        ? (value.externalEvidence.objects as BrepGrasshopperExternalObjectEvidenceInput[])
        : [],
      connections: Array.isArray(value.externalEvidence.connections)
        ? (value.externalEvidence.connections as BrepGrasshopperExternalConnectionEvidenceInput[])
        : [],
    },
  });
}

export async function serializeBrepGrasshopperReconciliationEnvelope(
  value: unknown,
): Promise<string> {
  return `${JSON.stringify(await normalizeBrepGrasshopperReconciliationEnvelope(value), null, 2)}\n`;
}

export async function parseBrepGrasshopperReconciliationJson(
  text: string,
): Promise<BrepGrasshopperReconciliationEnvelope> {
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > BREP_GRASSHOPPER_RECONCILIATION_MAX_BYTES) {
    throw new BrepGrasshopperReconciliationError(
      'too_large',
      `Grasshopper reconciliation exceeds ${BREP_GRASSHOPPER_RECONCILIATION_MAX_BYTES} bytes.`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new BrepGrasshopperReconciliationError(
      'invalid_json',
      'Grasshopper reconciliation is not valid JSON.',
      error,
    );
  }
  return normalizeBrepGrasshopperReconciliationEnvelope(value);
}
