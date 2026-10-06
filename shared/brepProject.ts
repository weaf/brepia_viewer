import {
  BREP_SCALAR_MAX_ABS_VALUE,
  BrepScalarEvaluationError,
  BrepScalarValidationError,
  normalizeBrepScalarValue,
  resolveBrepScalar,
  validateBrepProjectScalarDefaults,
} from './brepScalar.ts';
import {
  validateBrepClosedPolylineProfilePoints,
  validateBrepMultiLoopProfileGeometry,
  type BrepResolvedProfileLoop,
} from './brepProfileGeometry.ts';

export const BREP_PROJECT_SCHEMA_VERSION = 1 as const;
export const BREP_PROJECT_MAX_PARAMETERS = 128;
export const BREP_PROJECT_MAX_NODES = 256;
export const BREP_PROJECT_MAX_NODE_INPUTS = 32;
export const BREP_PROJECT_MAX_PATTERN_COUNT = 32;
export const BREP_PROJECT_MAX_RECTANGULAR_PATTERN_INSTANCES = 64;
export const BREP_PROJECT_MAX_PROFILE_POINTS = 32;
export const BREP_PROJECT_MAX_PROFILE_HOLES = 8;
export const BREP_PROJECT_MAX_PROFILE_TOTAL_POINTS = 128;
export const BREP_PROJECT_MAX_ID_CHARS = 64;
export const BREP_PROJECT_MAX_NAME_CHARS = 120;
export const BREP_PROJECT_MAX_DESCRIPTION_CHARS = 500;
export const BREP_PROJECT_MAX_ABS_SCALAR = BREP_SCALAR_MAX_ABS_VALUE;
export const BREP_PROJECT_MAX_METADATA_PROPERTIES = 64;
export const BREP_PROJECT_MAX_OBJECT_POINTS = 128;

export type BrepProjectUnitSystem = 'mm';
export type BrepParameterUnit = 'mm' | 'deg' | 'none';
export type BrepAxis = 'x' | 'y' | 'z';
export type BrepNodeValueKind = 'single' | 'instanceSet';

export type BrepParameterReference = {
  parameter: string;
};

export type BrepScalarBinaryExpression = {
  op: 'add' | 'sub' | 'mul' | 'div';
  args: [BrepScalar, BrepScalar];
};

export type BrepScalarNegateExpression = {
  op: 'neg';
  args: [BrepScalar];
};

export type BrepScalarExpression =
  BrepScalarBinaryExpression | BrepScalarNegateExpression;

export type BrepScalar = number | BrepParameterReference | BrepScalarExpression;
export type BrepVector3 = [BrepScalar, BrepScalar, BrepScalar];

/**
 * Kernel-neutral object placement. This maps directly to a future Grasshopper
 * Plane input without making Rhino a runtime dependency.
 */
export type BrepProjectPlacement = {
  origin: BrepVector3;
  xAxis: BrepVector3;
  yAxis: BrepVector3;
};

/** Metadata carried with the reusable project object, not kernel topology. */
export type BrepProjectMetadata = {
  objectType?: string;
  classification?: string;
  properties?: Record<string, string>;
};

export type BrepProjectObjectPointKind = 'connection' | 'mounting' | 'cable';

/** Stable local semantic point for future project/Rhino/Grasshopper composition. */
export type BrepProjectObjectPoint = {
  id: string;
  kind: BrepProjectObjectPointKind;
  position: BrepVector3;
  direction?: BrepVector3;
  label?: string;
};

/**
 * Optional semantic outputs beyond the primary resultNodeId. Geometry roles
 * reference ordinary canonical feature nodes rather than introducing a second
 * modeling graph or kernel-specific topology identity.
 */
export type BrepProjectObjectDefinition = {
  footprintNodeId?: string;
  clearanceEnvelopeNodeId?: string;
  maintenanceEnvelopeNodeId?: string;
  points?: BrepProjectObjectPoint[];
};

export type BrepPublishedNumberParameter = {
  id: string;
  label: string;
  type: 'number';
  unit: BrepParameterUnit;
  default: number;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
};

export type BrepEdgeSelector = {
  kind: 'parallelToAxis';
  axis: BrepAxis;
};

export type BrepBoxNode = {
  id: string;
  type: 'box';
  width: BrepScalar;
  depth: BrepScalar;
  height: BrepScalar;
};

export type BrepCylinderNode = {
  id: string;
  type: 'cylinder';
  radius: BrepScalar;
  height: BrepScalar;
};

export type BrepRectangleProfile = {
  type: 'rectangle';
  width: BrepScalar;
  height: BrepScalar;
};

export type BrepCircleProfile = {
  type: 'circle';
  radius: BrepScalar;
};

export type BrepClosedPolylineProfilePoint = {
  u: BrepScalar;
  v: BrepScalar;
};

export type BrepClosedPolylineProfile = {
  type: 'closedPolyline';
  points: BrepClosedPolylineProfilePoint[];
};

export type BrepProfileLoop =
  BrepRectangleProfile | BrepCircleProfile | BrepClosedPolylineProfile;

export type BrepProfileHole = {
  loop: BrepProfileLoop;
  offsetU: BrepScalar;
  offsetV: BrepScalar;
};

export type BrepProfile =
  | (BrepRectangleProfile & { holes?: BrepProfileHole[] })
  | (BrepCircleProfile & { holes?: BrepProfileHole[] })
  | (BrepClosedPolylineProfile & { holes?: BrepProfileHole[] });

export type BrepExtrudeNode = {
  id: string;
  type: 'extrude';
  profile: BrepProfile;
  axis: BrepAxis;
  depth: BrepScalar;
};

export type BrepRevolveNode = {
  id: string;
  type: 'revolve';
  profile: BrepProfile;
  axis: BrepAxis;
};

export type BrepPlanarElbow90Path = {
  type: 'planarElbow90';
  planeNormalAxis: BrepAxis;
  firstLegLength: BrepScalar;
  secondLegLength: BrepScalar;
  bendRadius: BrepScalar;
};

export type BrepSweepNode = {
  id: string;
  type: 'sweep';
  profile: BrepCircleProfile;
  path: BrepPlanarElbow90Path;
};

export type BrepTransformNode = {
  id: string;
  type: 'transform';
  input: string;
  translate?: BrepVector3;
  rotateDeg?: BrepVector3;
};

export type BrepMirrorNode = {
  id: string;
  type: 'mirror';
  input: string;
  normalAxis: BrepAxis;
  offset: BrepScalar;
};

export type BrepLinearPatternNode = {
  id: string;
  type: 'linearPattern';
  input: string;
  axis: BrepAxis;
  count: number;
  spacing: BrepScalar;
};

export type BrepRectangularPatternNode = {
  id: string;
  type: 'rectangularPattern';
  input: string;
  axisA: BrepAxis;
  axisB: BrepAxis;
  countA: number;
  countB: number;
  spacingA: BrepScalar;
  spacingB: BrepScalar;
};

export type BrepCircularPatternNode = {
  id: string;
  type: 'circularPattern';
  input: string;
  axis: BrepAxis;
  center: BrepVector3;
  count: number;
  angleStepDeg: BrepScalar;
};

export type BrepSubtractNode = {
  id: string;
  type: 'subtract';
  base: string;
  tools: string[];
};

export type BrepUnionNode = {
  id: string;
  type: 'union';
  inputs: string[];
};

export type BrepIntersectNode = {
  id: string;
  type: 'intersect';
  inputs: string[];
};

export type BrepFilletNode = {
  id: string;
  type: 'fillet';
  input: string;
  radius: BrepScalar;
  selector: BrepEdgeSelector;
};

export type BrepSelectNode = {
  id: string;
  type: 'select';
  selector: { parameter: string };
  off: string;
  on: string;
};

export type BrepNode =
  | BrepBoxNode
  | BrepCylinderNode
  | BrepExtrudeNode
  | BrepRevolveNode
  | BrepSweepNode
  | BrepTransformNode
  | BrepMirrorNode
  | BrepLinearPatternNode
  | BrepRectangularPatternNode
  | BrepCircularPatternNode
  | BrepSubtractNode
  | BrepUnionNode
  | BrepIntersectNode
  | BrepFilletNode
  | BrepSelectNode;

export type BrepProject = {
  schemaVersion: typeof BREP_PROJECT_SCHEMA_VERSION;
  id: string;
  name: string;
  units: BrepProjectUnitSystem;
  placement: BrepProjectPlacement;
  metadata?: BrepProjectMetadata;
  projectObject?: BrepProjectObjectDefinition;
  parameters: BrepPublishedNumberParameter[];
  nodes: BrepNode[];
  resultNodeId: string;
};

export type BrepProjectErrorCode =
  | 'invalid_schema'
  | 'invalid_id'
  | 'invalid_parameter'
  | 'invalid_metadata'
  | 'invalid_project_object'
  | 'too_many_parameters'
  | 'duplicate_parameter'
  | 'invalid_node'
  | 'too_many_nodes'
  | 'duplicate_node'
  | 'invalid_reference'
  | 'cycle'
  | 'missing_result';

export class BrepProjectError extends Error {
  constructor(
    public readonly code: BrepProjectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BrepProjectError';
  }
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const AXES = new Set<BrepAxis>(['x', 'y', 'z']);
const PARAMETER_UNITS = new Set<BrepParameterUnit>(['mm', 'deg', 'none']);
const PROJECT_OBJECT_POINT_KINDS = new Set<BrepProjectObjectPointKind>([
  'connection',
  'mounting',
  'cable',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeId(value: unknown, kind: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > BREP_PROJECT_MAX_ID_CHARS ||
    !ID_PATTERN.test(value)
  ) {
    throw new BrepProjectError(
      'invalid_id',
      `${kind} id must match ${ID_PATTERN} and be at most ${BREP_PROJECT_MAX_ID_CHARS} characters.`,
    );
  }
  return value;
}

function normalizeText(
  value: unknown,
  field: string,
  maxChars: number,
  required = true,
): string | undefined {
  if (value == null && !required) return undefined;
  if (typeof value !== 'string') {
    throw new BrepProjectError('invalid_schema', `${field} must be text.`);
  }
  const normalized = value.trim();
  if ((required && normalized.length === 0) || normalized.length > maxChars) {
    throw new BrepProjectError(
      'invalid_schema',
      `${field} must be ${required ? 'non-empty and ' : ''}at most ${maxChars} characters.`,
    );
  }
  return normalized;
}

function normalizeNumber(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > BREP_PROJECT_MAX_ABS_SCALAR
  ) {
    throw new BrepProjectError(
      'invalid_schema',
      `${field} must be a finite number with absolute value <= ${BREP_PROJECT_MAX_ABS_SCALAR}.`,
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function normalizeParameter(value: unknown): BrepPublishedNumberParameter {
  if (!isRecord(value) || value.type !== 'number') {
    throw new BrepProjectError(
      'invalid_parameter',
      'BRep published parameters must currently be numeric parameters.',
    );
  }

  const id = normalizeId(value.id, 'BRep parameter');
  const label = normalizeText(
    value.label,
    `BRep parameter ${id} label`,
    BREP_PROJECT_MAX_NAME_CHARS,
  )!;
  if (
    typeof value.unit !== 'string' ||
    !PARAMETER_UNITS.has(value.unit as BrepParameterUnit)
  ) {
    throw new BrepProjectError(
      'invalid_parameter',
      `BRep parameter ${id} unit must be mm, deg, or none.`,
    );
  }

  const defaultValue = normalizeNumber(
    value.default,
    `BRep parameter ${id} default`,
  );
  const min =
    value.min == null
      ? undefined
      : normalizeNumber(value.min, `BRep parameter ${id} min`);
  const max =
    value.max == null
      ? undefined
      : normalizeNumber(value.max, `BRep parameter ${id} max`);
  const step =
    value.step == null
      ? undefined
      : normalizeNumber(value.step, `BRep parameter ${id} step`);

  if (min != null && max != null && min > max) {
    throw new BrepProjectError(
      'invalid_parameter',
      `BRep parameter ${id} min cannot exceed max.`,
    );
  }
  if (min != null && defaultValue < min) {
    throw new BrepProjectError(
      'invalid_parameter',
      `BRep parameter ${id} default cannot be below min.`,
    );
  }
  if (max != null && defaultValue > max) {
    throw new BrepProjectError(
      'invalid_parameter',
      `BRep parameter ${id} default cannot exceed max.`,
    );
  }
  if (step != null && step <= 0) {
    throw new BrepProjectError(
      'invalid_parameter',
      `BRep parameter ${id} step must be greater than zero.`,
    );
  }

  const description = normalizeText(
    value.description,
    `BRep parameter ${id} description`,
    BREP_PROJECT_MAX_DESCRIPTION_CHARS,
    false,
  );

  return {
    id,
    label,
    type: 'number',
    unit: value.unit as BrepParameterUnit,
    default: defaultValue,
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {}),
    ...(step != null ? { step } : {}),
    ...(description ? { description } : {}),
  };
}

function normalizeScalar(
  value: unknown,
  field: string,
  parameterIds: ReadonlySet<string>,
  parameterUnits: ReadonlyMap<string, BrepParameterUnit>,
  allowedUnits: readonly BrepParameterUnit[],
): BrepScalar {
  try {
    return normalizeBrepScalarValue(value, {
      field,
      parameterIds,
      parameterUnits,
      allowedUnits,
      normalizeNumber,
      normalizeParameterId: normalizeId,
    });
  } catch (error) {
    if (error instanceof BrepScalarValidationError) {
      const code: BrepProjectErrorCode =
        error.code === 'invalid_scalar' ? 'invalid_node' : error.code;
      throw new BrepProjectError(code, error.message);
    }
    throw error;
  }
}

function normalizeVector3(
  value: unknown,
  field: string,
  parameterIds: ReadonlySet<string>,
  parameterUnits: ReadonlyMap<string, BrepParameterUnit>,
  allowedUnits: readonly BrepParameterUnit[],
): BrepVector3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new BrepProjectError(
      'invalid_node',
      `${field} must contain exactly three scalar values.`,
    );
  }
  return [
    normalizeScalar(
      value[0],
      `${field}[0]`,
      parameterIds,
      parameterUnits,
      allowedUnits,
    ),
    normalizeScalar(
      value[1],
      `${field}[1]`,
      parameterIds,
      parameterUnits,
      allowedUnits,
    ),
    normalizeScalar(
      value[2],
      `${field}[2]`,
      parameterIds,
      parameterUnits,
      allowedUnits,
    ),
  ];
}

function normalizePlacement(
  value: unknown,
  parameterIds: ReadonlySet<string>,
  parameterUnits: ReadonlyMap<string, BrepParameterUnit>,
): BrepProjectPlacement {
  if (value == null) {
    return { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] };
  }
  if (!isRecord(value)) {
    throw new BrepProjectError(
      'invalid_schema',
      'BRep project placement must be an object.',
    );
  }
  return {
    origin: normalizeVector3(
      value.origin,
      'BRep project placement origin',
      parameterIds,
      parameterUnits,
      ['mm'],
    ),
    xAxis: normalizeVector3(
      value.xAxis,
      'BRep project placement xAxis',
      parameterIds,
      parameterUnits,
      ['none'],
    ),
    yAxis: normalizeVector3(
      value.yAxis,
      'BRep project placement yAxis',
      parameterIds,
      parameterUnits,
      ['none'],
    ),
  };
}

function normalizeMetadata(value: unknown): BrepProjectMetadata | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    throw new BrepProjectError(
      'invalid_metadata',
      'BRep project metadata must be an object.',
    );
  }
  const objectType = normalizeText(
    value.objectType,
    'BRep project metadata objectType',
    BREP_PROJECT_MAX_NAME_CHARS,
    false,
  );
  const classification = normalizeText(
    value.classification,
    'BRep project metadata classification',
    BREP_PROJECT_MAX_NAME_CHARS,
    false,
  );
  let properties: Record<string, string> | undefined;
  if (value.properties != null) {
    if (!isRecord(value.properties)) {
      throw new BrepProjectError(
        'invalid_metadata',
        'BRep project metadata properties must be an object.',
      );
    }
    const entries = Object.entries(value.properties);
    if (entries.length > BREP_PROJECT_MAX_METADATA_PROPERTIES) {
      throw new BrepProjectError(
        'invalid_metadata',
        `BRep project metadata has more than ${BREP_PROJECT_MAX_METADATA_PROPERTIES} properties.`,
      );
    }
    properties = {};
    for (const [key, propertyValue] of entries.sort(([left], [right]) =>
      left.localeCompare(right, 'en-US'),
    )) {
      const normalizedKey = normalizeId(key, 'BRep metadata property');
      const normalizedValue = normalizeText(
        propertyValue,
        `BRep metadata property ${normalizedKey}`,
        BREP_PROJECT_MAX_DESCRIPTION_CHARS,
      )!;
      properties[normalizedKey] = normalizedValue;
    }
  }
  return {
    ...(objectType ? { objectType } : {}),
    ...(classification ? { classification } : {}),
    ...(properties && Object.keys(properties).length > 0 ? { properties } : {}),
  };
}

function normalizeProjectObject(
  value: unknown,
  parameterIds: ReadonlySet<string>,
  parameterUnits: ReadonlyMap<string, BrepParameterUnit>,
  nodeIds: ReadonlySet<string>,
): BrepProjectObjectDefinition | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    throw new BrepProjectError(
      'invalid_project_object',
      'BRep projectObject must be an object.',
    );
  }

  const normalizeRoleNode = (
    rawValue: unknown,
    field: keyof Pick<
      BrepProjectObjectDefinition,
      | 'footprintNodeId'
      | 'clearanceEnvelopeNodeId'
      | 'maintenanceEnvelopeNodeId'
    >,
  ): string | undefined => {
    if (rawValue == null) return undefined;
    const nodeId = normalizeId(rawValue, `BRep project-object ${field}`);
    if (!nodeIds.has(nodeId)) {
      throw new BrepProjectError(
        'invalid_reference',
        `BRep project-object ${field} references unknown node ${nodeId}.`,
      );
    }
    return nodeId;
  };

  const footprintNodeId = normalizeRoleNode(
    value.footprintNodeId,
    'footprintNodeId',
  );
  const clearanceEnvelopeNodeId = normalizeRoleNode(
    value.clearanceEnvelopeNodeId,
    'clearanceEnvelopeNodeId',
  );
  const maintenanceEnvelopeNodeId = normalizeRoleNode(
    value.maintenanceEnvelopeNodeId,
    'maintenanceEnvelopeNodeId',
  );

  let points: BrepProjectObjectPoint[] | undefined;
  if (value.points != null) {
    if (!Array.isArray(value.points)) {
      throw new BrepProjectError(
        'invalid_project_object',
        'BRep project-object points must be an array.',
      );
    }
    if (value.points.length > BREP_PROJECT_MAX_OBJECT_POINTS) {
      throw new BrepProjectError(
        'invalid_project_object',
        `BRep project-object points exceed ${BREP_PROJECT_MAX_OBJECT_POINTS}.`,
      );
    }

    const pointIds = new Set<string>();
    points = value.points.map((point, index) => {
      if (!isRecord(point)) {
        throw new BrepProjectError(
          'invalid_project_object',
          `BRep project-object points[${index}] must be an object.`,
        );
      }
      const pointId = normalizeId(point.id, 'BRep project-object point');
      if (pointIds.has(pointId)) {
        throw new BrepProjectError(
          'invalid_project_object',
          `Duplicate BRep project-object point id: ${pointId}.`,
        );
      }
      pointIds.add(pointId);

      if (
        typeof point.kind !== 'string' ||
        !PROJECT_OBJECT_POINT_KINDS.has(
          point.kind as BrepProjectObjectPointKind,
        )
      ) {
        throw new BrepProjectError(
          'invalid_project_object',
          `BRep project-object point ${pointId} kind must be connection, mounting, or cable.`,
        );
      }

      const label = normalizeText(
        point.label,
        `BRep project-object point ${pointId} label`,
        BREP_PROJECT_MAX_NAME_CHARS,
        false,
      );

      return {
        id: pointId,
        kind: point.kind as BrepProjectObjectPointKind,
        position: normalizeVector3(
          point.position,
          `BRep project-object point ${pointId} position`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
        ...(point.direction != null
          ? {
              direction: normalizeVector3(
                point.direction,
                `BRep project-object point ${pointId} direction`,
                parameterIds,
                parameterUnits,
                ['none'],
              ),
            }
          : {}),
        ...(label ? { label } : {}),
      };
    });
    points.sort((left, right) => left.id.localeCompare(right.id, 'en-US'));
    if (points.length === 0) points = undefined;
  }

  const normalized: BrepProjectObjectDefinition = {
    ...(footprintNodeId ? { footprintNodeId } : {}),
    ...(clearanceEnvelopeNodeId ? { clearanceEnvelopeNodeId } : {}),
    ...(maintenanceEnvelopeNodeId ? { maintenanceEnvelopeNodeId } : {}),
    ...(points ? { points } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeNodeReference(value: unknown, field: string): string {
  return normalizeId(value, field);
}

function normalizeBooleanInputs(
  value: unknown,
  nodeId: string,
  kind: 'union' | 'intersect',
): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > BREP_PROJECT_MAX_NODE_INPUTS
  ) {
    throw new BrepProjectError(
      'invalid_node',
      `BRep ${kind} ${nodeId} must contain between 2 and ${BREP_PROJECT_MAX_NODE_INPUTS} input references.`,
    );
  }
  const inputs = value.map((input, index) =>
    normalizeNodeReference(input, `BRep ${kind} ${nodeId} inputs[${index}]`),
  );
  if (new Set(inputs).size !== inputs.length) {
    throw new BrepProjectError(
      'invalid_node',
      `BRep ${kind} ${nodeId} cannot contain duplicate input references.`,
    );
  }
  return inputs;
}

function normalizeEdgeSelector(
  value: unknown,
  nodeId: string,
): BrepEdgeSelector {
  if (!isRecord(value) || value.kind !== 'parallelToAxis') {
    throw new BrepProjectError(
      'invalid_node',
      `BRep fillet ${nodeId} currently requires a parallelToAxis edge selector.`,
    );
  }
  if (typeof value.axis !== 'string' || !AXES.has(value.axis as BrepAxis)) {
    throw new BrepProjectError(
      'invalid_node',
      `BRep fillet ${nodeId} selector axis must be x, y, or z.`,
    );
  }
  return { kind: 'parallelToAxis', axis: value.axis as BrepAxis };
}

function normalizeProfileLoop(
  value: unknown,
  owner: string,
  parameterIds: ReadonlySet<string>,
  parameterUnits: ReadonlyMap<string, BrepParameterUnit>,
  rejectNestedHoles = false,
): BrepProfileLoop {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new BrepProjectError(
      'invalid_node',
      `${owner} profile must be a typed object.`,
    );
  }
  if (
    rejectNestedHoles &&
    Object.prototype.hasOwnProperty.call(value, 'holes')
  ) {
    throw new BrepProjectError(
      'invalid_node',
      `${owner} profile loop cannot contain nested holes.`,
    );
  }

  switch (value.type) {
    case 'rectangle':
      return {
        type: 'rectangle',
        width: normalizeScalar(
          value.width,
          `${owner} rectangle profile width`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
        height: normalizeScalar(
          value.height,
          `${owner} rectangle profile height`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
      };
    case 'circle':
      return {
        type: 'circle',
        radius: normalizeScalar(
          value.radius,
          `${owner} circle profile radius`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
      };
    case 'closedPolyline': {
      if (
        !Array.isArray(value.points) ||
        value.points.length < 3 ||
        value.points.length > BREP_PROJECT_MAX_PROFILE_POINTS
      ) {
        throw new BrepProjectError(
          'invalid_node',
          `${owner} closedPolyline profile must contain between 3 and ${BREP_PROJECT_MAX_PROFILE_POINTS} points.`,
        );
      }
      const points = value.points.map((point, index) => {
        if (!isRecord(point)) {
          throw new BrepProjectError(
            'invalid_node',
            `${owner} closedPolyline profile point ${index} must be an object.`,
          );
        }
        return {
          u: normalizeScalar(
            point.u,
            `${owner} closedPolyline profile points[${index}].u`,
            parameterIds,
            parameterUnits,
            ['mm'],
          ),
          v: normalizeScalar(
            point.v,
            `${owner} closedPolyline profile points[${index}].v`,
            parameterIds,
            parameterUnits,
            ['mm'],
          ),
        };
      });
      return { type: 'closedPolyline', points };
    }
    default:
      throw new BrepProjectError(
        'invalid_node',
        `${owner} profile type must be rectangle, circle, or closedPolyline.`,
      );
  }
}

function profileLoopPointCount(loop: BrepProfileLoop): number {
  return loop.type === 'closedPolyline' ? loop.points.length : 0;
}

function normalizeProfile(
  value: unknown,
  nodeId: string,
  operation: 'extrude' | 'revolve',
  parameterIds: ReadonlySet<string>,
  parameterUnits: ReadonlyMap<string, BrepParameterUnit>,
): BrepProfile {
  if (!isRecord(value)) {
    throw new BrepProjectError(
      'invalid_node',
      `BRep ${operation} ${nodeId} profile must be a typed object.`,
    );
  }

  const owner = `BRep ${operation} ${nodeId}`;
  const outer = normalizeProfileLoop(
    value,
    owner,
    parameterIds,
    parameterUnits,
  );
  if (!Object.prototype.hasOwnProperty.call(value, 'holes')) return outer;
  if (!Array.isArray(value.holes)) {
    throw new BrepProjectError(
      'invalid_node',
      `${owner} profile holes must be an array when present.`,
    );
  }
  if (value.holes.length === 0) return outer;
  if (operation === 'revolve') {
    throw new BrepProjectError(
      'invalid_node',
      `BRep revolve ${nodeId} does not support profile holes in the bounded first multi-loop slice.`,
    );
  }
  if (value.holes.length > BREP_PROJECT_MAX_PROFILE_HOLES) {
    throw new BrepProjectError(
      'invalid_node',
      `BRep extrude ${nodeId} profile cannot contain more than ${BREP_PROJECT_MAX_PROFILE_HOLES} holes.`,
    );
  }

  const holes = value.holes.map((hole, index): BrepProfileHole => {
    if (!isRecord(hole)) {
      throw new BrepProjectError(
        'invalid_node',
        `BRep extrude ${nodeId} hole ${index} must be an object.`,
      );
    }
    return {
      loop: normalizeProfileLoop(
        hole.loop,
        `BRep extrude ${nodeId} hole ${index}`,
        parameterIds,
        parameterUnits,
        true,
      ),
      offsetU: normalizeScalar(
        hole.offsetU,
        `BRep extrude ${nodeId} hole ${index} offsetU`,
        parameterIds,
        parameterUnits,
        ['mm'],
      ),
      offsetV: normalizeScalar(
        hole.offsetV,
        `BRep extrude ${nodeId} hole ${index} offsetV`,
        parameterIds,
        parameterUnits,
        ['mm'],
      ),
    };
  });

  const totalPoints =
    profileLoopPointCount(outer) +
    holes.reduce((sum, hole) => sum + profileLoopPointCount(hole.loop), 0);
  if (totalPoints > BREP_PROJECT_MAX_PROFILE_TOTAL_POINTS) {
    throw new BrepProjectError(
      'invalid_node',
      `BRep extrude ${nodeId} profile cannot contain more than ${BREP_PROJECT_MAX_PROFILE_TOTAL_POINTS} explicit closedPolyline points across outer and holes.`,
    );
  }

  return { ...outer, holes } as BrepProfile;
}

function normalizeNode(
  value: unknown,
  parameterIds: ReadonlySet<string>,
  parameterUnits: ReadonlyMap<string, BrepParameterUnit>,
): BrepNode {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new BrepProjectError(
      'invalid_node',
      'BRep nodes must be typed objects.',
    );
  }

  const id = normalizeId(value.id, 'BRep node');

  switch (value.type) {
    case 'box':
      return {
        id,
        type: 'box',
        width: normalizeScalar(
          value.width,
          `BRep box ${id} width`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
        depth: normalizeScalar(
          value.depth,
          `BRep box ${id} depth`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
        height: normalizeScalar(
          value.height,
          `BRep box ${id} height`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
      };

    case 'cylinder':
      return {
        id,
        type: 'cylinder',
        radius: normalizeScalar(
          value.radius,
          `BRep cylinder ${id} radius`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
        height: normalizeScalar(
          value.height,
          `BRep cylinder ${id} height`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
      };

    case 'extrude': {
      if (typeof value.axis !== 'string' || !AXES.has(value.axis as BrepAxis)) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep extrude ${id} axis must be x, y, or z.`,
        );
      }
      return {
        id,
        type: 'extrude',
        profile: normalizeProfile(
          value.profile,
          id,
          'extrude',
          parameterIds,
          parameterUnits,
        ),
        axis: value.axis as BrepAxis,
        depth: normalizeScalar(
          value.depth,
          `BRep extrude ${id} depth`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
      };
    }

    case 'revolve': {
      if (typeof value.axis !== 'string' || !AXES.has(value.axis as BrepAxis)) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep revolve ${id} axis must be x, y, or z.`,
        );
      }
      return {
        id,
        type: 'revolve',
        profile: normalizeProfile(
          value.profile,
          id,
          'revolve',
          parameterIds,
          parameterUnits,
        ),
        axis: value.axis as BrepAxis,
      };
    }

    case 'sweep': {
      if (!isRecord(value.profile) || value.profile.type !== 'circle') {
        throw new BrepProjectError(
          'invalid_node',
          `BRep sweep ${id} profile must be one circle profile.`,
        );
      }
      if (!isRecord(value.path) || value.path.type !== 'planarElbow90') {
        throw new BrepProjectError(
          'invalid_node',
          `BRep sweep ${id} path must be planarElbow90.`,
        );
      }
      if (
        typeof value.path.planeNormalAxis !== 'string' ||
        !AXES.has(value.path.planeNormalAxis as BrepAxis)
      ) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep sweep ${id} planeNormalAxis must be x, y, or z.`,
        );
      }
      if (
        Object.keys(value.profile).some(
          (key) => !['type', 'radius'].includes(key),
        )
      ) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep sweep ${id} circle profile contains unsupported fields.`,
        );
      }
      if (
        Object.keys(value.path).some(
          (key) =>
            ![
              'type',
              'planeNormalAxis',
              'firstLegLength',
              'secondLegLength',
              'bendRadius',
            ].includes(key),
        )
      ) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep sweep ${id} planarElbow90 path contains unsupported fields.`,
        );
      }
      return {
        id,
        type: 'sweep',
        profile: {
          type: 'circle',
          radius: normalizeScalar(
            value.profile.radius,
            `BRep sweep ${id} profile radius`,
            parameterIds,
            parameterUnits,
            ['mm'],
          ),
        },
        path: {
          type: 'planarElbow90',
          planeNormalAxis: value.path.planeNormalAxis as BrepAxis,
          firstLegLength: normalizeScalar(
            value.path.firstLegLength,
            `BRep sweep ${id} firstLegLength`,
            parameterIds,
            parameterUnits,
            ['mm'],
          ),
          secondLegLength: normalizeScalar(
            value.path.secondLegLength,
            `BRep sweep ${id} secondLegLength`,
            parameterIds,
            parameterUnits,
            ['mm'],
          ),
          bendRadius: normalizeScalar(
            value.path.bendRadius,
            `BRep sweep ${id} bendRadius`,
            parameterIds,
            parameterUnits,
            ['mm'],
          ),
        },
      };
    }

    case 'transform': {
      if (value.translate == null && value.rotateDeg == null) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep transform ${id} must define translate and/or rotateDeg.`,
        );
      }
      return {
        id,
        type: 'transform',
        input: normalizeNodeReference(
          value.input,
          `BRep transform ${id} input`,
        ),
        ...(value.translate != null
          ? {
              translate: normalizeVector3(
                value.translate,
                `BRep transform ${id} translate`,
                parameterIds,
                parameterUnits,
                ['mm'],
              ),
            }
          : {}),
        ...(value.rotateDeg != null
          ? {
              rotateDeg: normalizeVector3(
                value.rotateDeg,
                `BRep transform ${id} rotateDeg`,
                parameterIds,
                parameterUnits,
                ['deg'],
              ),
            }
          : {}),
      };
    }

    case 'mirror': {
      if (
        typeof value.normalAxis !== 'string' ||
        !AXES.has(value.normalAxis as BrepAxis)
      ) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep mirror ${id} normalAxis must be x, y, or z.`,
        );
      }
      return {
        id,
        type: 'mirror',
        input: normalizeNodeReference(value.input, `BRep mirror ${id} input`),
        normalAxis: value.normalAxis as BrepAxis,
        offset: normalizeScalar(
          value.offset,
          `BRep mirror ${id} offset`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
      };
    }

    case 'linearPattern': {
      if (typeof value.axis !== 'string' || !AXES.has(value.axis as BrepAxis)) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep linearPattern ${id} axis must be x, y, or z.`,
        );
      }
      if (
        typeof value.count !== 'number' ||
        !Number.isInteger(value.count) ||
        value.count < 2 ||
        value.count > BREP_PROJECT_MAX_PATTERN_COUNT
      ) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep linearPattern ${id} count must be a literal integer between 2 and ${BREP_PROJECT_MAX_PATTERN_COUNT}.`,
        );
      }
      return {
        id,
        type: 'linearPattern',
        input: normalizeNodeReference(
          value.input,
          `BRep linearPattern ${id} input`,
        ),
        axis: value.axis as BrepAxis,
        count: value.count,
        spacing: normalizeScalar(
          value.spacing,
          `BRep linearPattern ${id} spacing`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
      };
    }

    case 'rectangularPattern': {
      if (
        typeof value.axisA !== 'string' ||
        !AXES.has(value.axisA as BrepAxis) ||
        typeof value.axisB !== 'string' ||
        !AXES.has(value.axisB as BrepAxis)
      ) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep rectangularPattern ${id} axisA and axisB must each be x, y, or z.`,
        );
      }
      if (value.axisA === value.axisB) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep rectangularPattern ${id} axisA and axisB must be different axes.`,
        );
      }
      const countFields = [
        ['countA', value.countA],
        ['countB', value.countB],
      ] as const;
      for (const [field, count] of countFields) {
        if (
          typeof count !== 'number' ||
          !Number.isInteger(count) ||
          count < 2 ||
          count > BREP_PROJECT_MAX_PATTERN_COUNT
        ) {
          throw new BrepProjectError(
            'invalid_node',
            `BRep rectangularPattern ${id} ${field} must be a literal integer between 2 and ${BREP_PROJECT_MAX_PATTERN_COUNT}.`,
          );
        }
      }
      const countA = value.countA as number;
      const countB = value.countB as number;
      if (countA * countB > BREP_PROJECT_MAX_RECTANGULAR_PATTERN_INSTANCES) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep rectangularPattern ${id} countA * countB must not exceed ${BREP_PROJECT_MAX_RECTANGULAR_PATTERN_INSTANCES}.`,
        );
      }
      return {
        id,
        type: 'rectangularPattern',
        input: normalizeNodeReference(
          value.input,
          `BRep rectangularPattern ${id} input`,
        ),
        axisA: value.axisA as BrepAxis,
        axisB: value.axisB as BrepAxis,
        countA,
        countB,
        spacingA: normalizeScalar(
          value.spacingA,
          `BRep rectangularPattern ${id} spacingA`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
        spacingB: normalizeScalar(
          value.spacingB,
          `BRep rectangularPattern ${id} spacingB`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
      };
    }

    case 'circularPattern': {
      if (typeof value.axis !== 'string' || !AXES.has(value.axis as BrepAxis)) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep circularPattern ${id} axis must be x, y, or z.`,
        );
      }
      if (
        typeof value.count !== 'number' ||
        !Number.isInteger(value.count) ||
        value.count < 2 ||
        value.count > BREP_PROJECT_MAX_PATTERN_COUNT
      ) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep circularPattern ${id} count must be a literal integer between 2 and ${BREP_PROJECT_MAX_PATTERN_COUNT}.`,
        );
      }
      return {
        id,
        type: 'circularPattern',
        input: normalizeNodeReference(
          value.input,
          `BRep circularPattern ${id} input`,
        ),
        axis: value.axis as BrepAxis,
        center: normalizeVector3(
          value.center,
          `BRep circularPattern ${id} center`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
        count: value.count,
        angleStepDeg: normalizeScalar(
          value.angleStepDeg,
          `BRep circularPattern ${id} angleStepDeg`,
          parameterIds,
          parameterUnits,
          ['deg'],
        ),
      };
    }

    case 'subtract': {
      if (
        !Array.isArray(value.tools) ||
        value.tools.length === 0 ||
        value.tools.length > BREP_PROJECT_MAX_NODE_INPUTS
      ) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep subtract ${id} must contain between 1 and ${BREP_PROJECT_MAX_NODE_INPUTS} tool references.`,
        );
      }
      const tools = value.tools.map((tool, index) =>
        normalizeNodeReference(tool, `BRep subtract ${id} tools[${index}]`),
      );
      if (new Set(tools).size !== tools.length) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep subtract ${id} cannot contain duplicate tool references.`,
        );
      }
      return {
        id,
        type: 'subtract',
        base: normalizeNodeReference(value.base, `BRep subtract ${id} base`),
        tools,
      };
    }

    case 'union':
    case 'intersect':
      return {
        id,
        type: value.type,
        inputs: normalizeBooleanInputs(value.inputs, id, value.type),
      };

    case 'fillet':
      return {
        id,
        type: 'fillet',
        input: normalizeNodeReference(value.input, `BRep fillet ${id} input`),
        radius: normalizeScalar(
          value.radius,
          `BRep fillet ${id} radius`,
          parameterIds,
          parameterUnits,
          ['mm'],
        ),
        selector: normalizeEdgeSelector(value.selector, id),
      };

    case 'select': {
      if (
        !isRecord(value.selector) ||
        typeof value.selector.parameter !== 'string' ||
        !parameterIds.has(value.selector.parameter)
      ) {
        throw new BrepProjectError(
          'invalid_node',
          `BRep select ${id} selector.parameter must reference a published parameter.`,
        );
      }
      const selectorParameter = value.selector.parameter;
      if (parameterUnits.get(selectorParameter) !== 'none') {
        throw new BrepProjectError(
          'invalid_node',
          `BRep select ${id} selector parameter must use unit none.`,
        );
      }
      return {
        id,
        type: 'select',
        selector: { parameter: selectorParameter },
        off: normalizeNodeReference(value.off, `BRep select ${id} off`),
        on: normalizeNodeReference(value.on, `BRep select ${id} on`),
      };
    }

    default:
      throw new BrepProjectError(
        'invalid_node',
        `Unsupported BRep node type: ${value.type}.`,
      );
  }
}

export function brepNodeValueKind(node: BrepNode): BrepNodeValueKind {
  return node.type === 'linearPattern' ||
    node.type === 'rectangularPattern' ||
    node.type === 'circularPattern'
    ? 'instanceSet'
    : 'single';
}

function nodeDependencies(node: BrepNode): string[] {
  switch (node.type) {
    case 'box':
    case 'cylinder':
    case 'extrude':
    case 'revolve':
    case 'sweep':
      return [];
    case 'transform':
    case 'mirror':
    case 'linearPattern':
    case 'rectangularPattern':
    case 'circularPattern':
    case 'fillet':
      return [node.input];
    case 'select':
      return [node.off, node.on];
    case 'subtract':
      return [node.base, ...node.tools];
    case 'union':
    case 'intersect':
      return node.inputs;
  }
}

function validateNodeReferencesAndCycles(nodes: BrepNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    for (const dependency of nodeDependencies(node)) {
      if (!byId.has(dependency)) {
        throw new BrepProjectError(
          'invalid_reference',
          `BRep node ${node.id} references unknown node ${dependency}.`,
        );
      }
    }
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (nodeId: string) => {
    const current = state.get(nodeId);
    if (current === 'done') return;
    if (current === 'visiting') {
      throw new BrepProjectError(
        'cycle',
        `BRep project dependency graph contains a cycle at ${nodeId}.`,
      );
    }

    state.set(nodeId, 'visiting');
    for (const dependency of nodeDependencies(byId.get(nodeId)!))
      visit(dependency);
    state.set(nodeId, 'done');
  };

  for (const node of nodes) visit(node.id);
}

function validateNodeValueCompatibility(
  nodes: BrepNode[],
  projectObject: BrepProjectObjectDefinition | undefined,
): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const requireSingle = (
    owner: BrepNode,
    dependencyId: string,
    field: string,
  ) => {
    const dependency = byId.get(dependencyId)!;
    if (brepNodeValueKind(dependency) !== 'single') {
      throw new BrepProjectError(
        'invalid_node',
        `BRep ${owner.type} ${owner.id} ${field} requires a single-shape node; ${dependencyId} is an instance set.`,
      );
    }
  };

  for (const node of nodes) {
    switch (node.type) {
      case 'box':
      case 'cylinder':
      case 'extrude':
      case 'revolve':
      case 'sweep':
        break;
      case 'transform':
      case 'mirror':
      case 'fillet':
      case 'linearPattern':
      case 'rectangularPattern':
      case 'circularPattern':
        requireSingle(node, node.input, 'input');
        break;
      case 'select':
        requireSingle(node, node.off, 'off');
        requireSingle(node, node.on, 'on');
        break;
      case 'subtract':
        requireSingle(node, node.base, 'base');
        break;
      case 'union':
      case 'intersect':
        node.inputs.forEach((input, index) =>
          requireSingle(node, input, `inputs[${index}]`),
        );
        break;
    }
  }

  const rolePairs = [
    ['footprintNodeId', projectObject?.footprintNodeId],
    ['clearanceEnvelopeNodeId', projectObject?.clearanceEnvelopeNodeId],
    ['maintenanceEnvelopeNodeId', projectObject?.maintenanceEnvelopeNodeId],
  ] as const;
  for (const [field, nodeId] of rolePairs) {
    if (!nodeId) continue;
    if (brepNodeValueKind(byId.get(nodeId)!) !== 'single') {
      throw new BrepProjectError(
        'invalid_project_object',
        `BRep project-object ${field} must reference a single-shape node; ${nodeId} is an instance set.`,
      );
    }
  }
}

export function validateBrepLinearPatternSpacingValues(
  project: BrepProject,
  parameterValues: Readonly<Record<string, number>>,
): void {
  for (const node of project.nodes) {
    if (node.type !== 'linearPattern') continue;
    const spacing = resolveBrepScalar(node.spacing, parameterValues);
    if (spacing === 0) {
      throw new BrepScalarEvaluationError(
        `BRep linearPattern ${node.id} spacing must resolve to a non-zero millimetre value.`,
      );
    }
  }
}

export function validateBrepRectangularPatternSpacingValues(
  project: BrepProject,
  parameterValues: Readonly<Record<string, number>>,
): void {
  for (const node of project.nodes) {
    if (node.type !== 'rectangularPattern') continue;
    const spacingA = resolveBrepScalar(node.spacingA, parameterValues);
    const spacingB = resolveBrepScalar(node.spacingB, parameterValues);
    if (spacingA === 0) {
      throw new BrepScalarEvaluationError(
        `BRep rectangularPattern ${node.id} spacingA must resolve to a non-zero millimetre value.`,
      );
    }
    if (spacingB === 0) {
      throw new BrepScalarEvaluationError(
        `BRep rectangularPattern ${node.id} spacingB must resolve to a non-zero millimetre value.`,
      );
    }
  }
}

export function validateBrepCircularPatternAngleValues(
  project: BrepProject,
  parameterValues: Readonly<Record<string, number>>,
): void {
  for (const node of project.nodes) {
    if (node.type !== 'circularPattern') continue;
    const angleStepDeg = resolveBrepScalar(node.angleStepDeg, parameterValues);
    if (angleStepDeg === 0) {
      throw new BrepScalarEvaluationError(
        `BRep circularPattern ${node.id} angleStepDeg must resolve to a non-zero degree value.`,
      );
    }
    if (Math.abs(angleStepDeg) * node.count > 360) {
      throw new BrepScalarEvaluationError(
        `BRep circularPattern ${node.id} abs(angleStepDeg) * count must not exceed 360 degrees.`,
      );
    }
  }
}

function requirePositiveExtrudeValue(value: number, field: string): void {
  if (value <= 0) {
    throw new BrepScalarEvaluationError(
      `${field} must resolve to a positive millimetre value.`,
    );
  }
}

function resolveExtrudeProfileLoop(
  loop: BrepProfileLoop,
  nodeId: string,
  parameterValues: Readonly<Record<string, number>>,
  offsetU = 0,
  offsetV = 0,
  holeIndex?: number,
): BrepResolvedProfileLoop {
  const owner =
    holeIndex == null
      ? `BRep extrude ${nodeId}`
      : `BRep extrude ${nodeId} hole ${holeIndex}`;

  switch (loop.type) {
    case 'rectangle': {
      const width = resolveBrepScalar(loop.width, parameterValues);
      const height = resolveBrepScalar(loop.height, parameterValues);
      requirePositiveExtrudeValue(width, `${owner} rectangle profile width`);
      requirePositiveExtrudeValue(height, `${owner} rectangle profile height`);
      return {
        type: 'rectangle',
        centerU: offsetU,
        centerV: offsetV,
        width,
        height,
      };
    }
    case 'circle': {
      const radius = resolveBrepScalar(loop.radius, parameterValues);
      requirePositiveExtrudeValue(radius, `${owner} circle profile radius`);
      return {
        type: 'circle',
        centerU: offsetU,
        centerV: offsetV,
        radius,
      };
    }
    case 'closedPolyline': {
      const points = loop.points.map(
        (point) =>
          [
            resolveBrepScalar(point.u, parameterValues) + offsetU,
            resolveBrepScalar(point.v, parameterValues) + offsetV,
          ] as const,
      );
      validateBrepClosedPolylineProfilePoints(
        points,
        holeIndex == null ? nodeId : `${nodeId} hole ${holeIndex}`,
        'extrude',
      );
      return { type: 'closedPolyline', points };
    }
  }
}

export function validateBrepExtrudeProfileValues(
  project: BrepProject,
  parameterValues: Readonly<Record<string, number>>,
): void {
  for (const node of project.nodes) {
    if (node.type !== 'extrude') continue;

    requirePositiveExtrudeValue(
      resolveBrepScalar(node.depth, parameterValues),
      `BRep extrude ${node.id} depth`,
    );

    const outer = resolveExtrudeProfileLoop(
      node.profile,
      node.id,
      parameterValues,
    );
    const holes = (node.profile.holes ?? []).map((hole, index) => {
      const offsetU = resolveBrepScalar(hole.offsetU, parameterValues);
      const offsetV = resolveBrepScalar(hole.offsetV, parameterValues);
      return resolveExtrudeProfileLoop(
        hole.loop,
        node.id,
        parameterValues,
        offsetU,
        offsetV,
        index,
      );
    });
    validateBrepMultiLoopProfileGeometry(outer, holes, node.id);
  }
}

export function validateBrepRevolveProfileValues(
  project: BrepProject,
  parameterValues: Readonly<Record<string, number>>,
): void {
  for (const node of project.nodes) {
    if (node.type !== 'revolve') continue;

    if (node.profile.holes?.length) {
      throw new BrepScalarEvaluationError(
        `BRep revolve ${node.id} does not support profile holes in the bounded first multi-loop slice.`,
      );
    }

    if (node.profile.type !== 'closedPolyline') {
      throw new BrepScalarEvaluationError(
        `BRep revolve ${node.id} currently requires a closedPolyline profile because centered rectangle and circle profiles cross the rotation axis.`,
      );
    }

    const points = node.profile.points.map(
      (point) =>
        [
          resolveBrepScalar(point.u, parameterValues),
          resolveBrepScalar(point.v, parameterValues),
        ] as const,
    );
    validateBrepClosedPolylineProfilePoints(points, node.id, 'revolve');

    if (points.some((point) => point[1] < 0)) {
      throw new BrepScalarEvaluationError(
        `BRep revolve ${node.id} profile must keep radial v >= 0 and must not cross the rotation axis.`,
      );
    }

    const touchesAxis = points.some((point) => point[1] === 0);
    if (!touchesAxis) continue;

    const hasAxisSegment = points.some((point, index) => {
      const next = points[(index + 1) % points.length]!;
      return point[1] === 0 && next[1] === 0;
    });
    if (!hasAxisSegment) {
      throw new BrepScalarEvaluationError(
        `BRep revolve ${node.id} profile may touch the rotation axis only through a non-zero-length boundary segment on v = 0.`,
      );
    }
  }
}

export function validateBrepSweepValues(
  project: BrepProject,
  parameterValues: Readonly<Record<string, number>>,
): void {
  for (const node of project.nodes) {
    if (node.type !== 'sweep') continue;

    const profileRadius = resolveBrepScalar(
      node.profile.radius,
      parameterValues,
    );
    const firstLegLength = resolveBrepScalar(
      node.path.firstLegLength,
      parameterValues,
    );
    const secondLegLength = resolveBrepScalar(
      node.path.secondLegLength,
      parameterValues,
    );
    const bendRadius = resolveBrepScalar(node.path.bendRadius, parameterValues);

    for (const [field, value] of [
      ['profile radius', profileRadius],
      ['firstLegLength', firstLegLength],
      ['secondLegLength', secondLegLength],
      ['bendRadius', bendRadius],
    ] as const) {
      if (value <= 0) {
        throw new BrepScalarEvaluationError(
          `BRep sweep ${node.id} ${field} must resolve to a positive millimetre value.`,
        );
      }
    }

    if (profileRadius >= bendRadius) {
      throw new BrepScalarEvaluationError(
        `BRep sweep ${node.id} profile radius must resolve smaller than bendRadius.`,
      );
    }
  }
}

export function normalizeBrepProject(project: unknown): BrepProject {
  if (
    !isRecord(project) ||
    project.schemaVersion !== BREP_PROJECT_SCHEMA_VERSION ||
    !Array.isArray(project.parameters) ||
    !Array.isArray(project.nodes) ||
    project.units !== 'mm'
  ) {
    throw new BrepProjectError(
      'invalid_schema',
      `BRep project schemaVersion must be ${BREP_PROJECT_SCHEMA_VERSION} and units must be mm.`,
    );
  }

  if (project.parameters.length > BREP_PROJECT_MAX_PARAMETERS) {
    throw new BrepProjectError(
      'too_many_parameters',
      `BRep project exceeds ${BREP_PROJECT_MAX_PARAMETERS} published parameters.`,
    );
  }
  if (
    project.nodes.length === 0 ||
    project.nodes.length > BREP_PROJECT_MAX_NODES
  ) {
    throw new BrepProjectError(
      'too_many_nodes',
      `BRep project must contain between 1 and ${BREP_PROJECT_MAX_NODES} nodes.`,
    );
  }

  const id = normalizeId(project.id, 'BRep project');
  const name = normalizeText(
    project.name,
    'BRep project name',
    BREP_PROJECT_MAX_NAME_CHARS,
  )!;

  const parameters = project.parameters.map(normalizeParameter);
  const parameterIds = new Set<string>();
  const parameterUnits = new Map<string, BrepParameterUnit>();
  for (const parameter of parameters) {
    if (parameterIds.has(parameter.id)) {
      throw new BrepProjectError(
        'duplicate_parameter',
        `Duplicate BRep published parameter id: ${parameter.id}.`,
      );
    }
    parameterIds.add(parameter.id);
    parameterUnits.set(parameter.id, parameter.unit);
  }

  const placement = normalizePlacement(
    project.placement,
    parameterIds,
    parameterUnits,
  );
  const metadata = normalizeMetadata(project.metadata);
  const nodes = project.nodes.map((node) =>
    normalizeNode(node, parameterIds, parameterUnits),
  );
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      throw new BrepProjectError(
        'duplicate_node',
        `Duplicate BRep node id: ${node.id}.`,
      );
    }
    nodeIds.add(node.id);
  }

  validateNodeReferencesAndCycles(nodes);

  const resultNodeId = normalizeId(project.resultNodeId, 'BRep result node');
  if (!nodeIds.has(resultNodeId)) {
    throw new BrepProjectError(
      'missing_result',
      `BRep project result node is missing: ${resultNodeId}.`,
    );
  }

  const projectObject = normalizeProjectObject(
    project.projectObject,
    parameterIds,
    parameterUnits,
    nodeIds,
  );
  validateNodeValueCompatibility(nodes, projectObject);

  parameters.sort((left, right) => left.id.localeCompare(right.id, 'en-US'));
  nodes.sort((left, right) => left.id.localeCompare(right.id, 'en-US'));

  const normalized: BrepProject = {
    schemaVersion: BREP_PROJECT_SCHEMA_VERSION,
    id,
    name,
    units: 'mm',
    placement,
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(projectObject ? { projectObject } : {}),
    parameters,
    nodes,
    resultNodeId,
  };

  try {
    validateBrepProjectScalarDefaults(normalized);
    const defaultParameterValues = Object.fromEntries(
      normalized.parameters.map((parameter) => [
        parameter.id,
        parameter.default,
      ]),
    );
    validateBrepLinearPatternSpacingValues(normalized, defaultParameterValues);
    validateBrepRectangularPatternSpacingValues(
      normalized,
      defaultParameterValues,
    );
    validateBrepCircularPatternAngleValues(normalized, defaultParameterValues);
    validateBrepExtrudeProfileValues(normalized, defaultParameterValues);
    validateBrepRevolveProfileValues(normalized, defaultParameterValues);
    validateBrepSweepValues(normalized, defaultParameterValues);
  } catch (error) {
    if (error instanceof BrepScalarEvaluationError) {
      throw new BrepProjectError('invalid_parameter', error.message);
    }
    throw error;
  }

  return normalized;
}
