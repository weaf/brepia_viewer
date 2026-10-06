import {
  normalizeBrepGrasshopperContract,
  type BrepGrasshopperContract,
} from './brepGrasshopperContract.ts';
import { createBrepGrasshopperPackagePlan } from './brepGrasshopperPackagePlan.ts';
import type {
  BrepNode,
  BrepProjectObjectPoint,
  BrepScalar,
  BrepVector3,
} from './brepProject.ts';
import { isBrepParameterReference } from './brepScalar.ts';

export const BREP_GRASSHOPPER_RHINO_PYTHON3_COMPONENT_GUID =
  '719467e6-7cf5-4848-99b0-c5dd57e5442c';
export const BREP_GRASSHOPPER_RHINOCODE_LIBRARY_GUID =
  '066d0a87-236f-4eae-a0f4-9e42f5327962';
export const BREP_GRASSHOPPER_SCRIPT_PARAMETER_GUID =
  '08908df5-fa14-4982-9ab2-1aa0927566aa';
export const BREP_GRASSHOPPER_SCRIPT_DOUBLE_HINT_GUID =
  '19ff81a2-dc4f-4035-8de9-26224c561321';
export const BREP_GRASSHOPPER_SCRIPT_OBJECT_HINT_GUID =
  '6a184b65-baa3-42d1-a548-3915b401de53';

const SCRIPT_PLAN_NAMESPACE = 'brepia-grasshopper-rhino-script-v1';
const PYTHON_RESERVED_PORT_NAMES = new Set([
  'Result',
  'Footprint',
  'Clearance',
  'Maintenance',
  'Connections',
  'Mounting',
  'Cable',
  'Metadata',
]);

export type BrepGrasshopperRhinoScriptInput = {
  inputId: string;
  variableName: string;
  nickname: string;
  kind: 'number' | 'placement';
  instanceGuid: string;
  sourceObjectGuid: string | null;
  converterType: 'System.Double' | 'System.Object';
  typeHintGuid: string;
};

export type BrepGrasshopperRhinoScriptOutput = {
  outputId:
    | 'result'
    | 'footprint'
    | 'clearanceEnvelope'
    | 'maintenanceEnvelope'
    | 'connectionPoints'
    | 'mountingPoints'
    | 'cablePoints'
    | 'metadata';
  variableName: string;
  nickname: string;
  instanceGuid: string;
};

export type BrepGrasshopperRhinoScriptPlan = {
  kind: 'brepia-rhino-python3-script-plan';
  schemaVersion: 1;
  projectId: string;
  sourceRevisionId: string;
  componentInstanceGuid: string;
  componentNickname: string;
  inputs: BrepGrasshopperRhinoScriptInput[];
  outputs: BrepGrasshopperRhinoScriptOutput[];
  source: string;
  sourceSha256: string;
};

export class BrepGrasshopperRhinoScriptError extends Error {
  constructor(
    readonly code: 'unsupported_model' | 'invalid_model',
    message: string,
  ) {
    super(message);
    this.name = 'BrepGrasshopperRhinoScriptError';
  }
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function encodeStableSegments(parts: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const segments = [SCRIPT_PLAN_NAMESPACE, ...parts].map((part) =>
    encoder.encode(part),
  );
  const byteLength = segments.reduce(
    (total, segment) => total + 4 + segment.length,
    0,
  );
  const encoded = new Uint8Array(byteLength);
  const view = new DataView(encoded.buffer);
  let offset = 0;
  for (const segment of segments) {
    view.setUint32(offset, segment.length, false);
    offset += 4;
    encoded.set(segment, offset);
    offset += segment.length;
  }
  return encoded;
}

async function stableGuid(parts: string[]): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encodeStableSegments(parts)),
  );
  const uuid = digest.slice(0, 16);
  uuid[6] = ((uuid[6] ?? 0) & 0x0f) | 0x80;
  uuid[8] = ((uuid[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(uuid);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function pythonNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new BrepGrasshopperRhinoScriptError(
      'invalid_model',
      'Rhino script numeric literals must be finite.',
    );
  }
  return String(Object.is(value, -0) ? 0 : value);
}

function pythonPortName(
  inputId: string,
  index: number,
  used: Set<string>,
): string {
  const words = inputId
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  let base = words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join('');
  if (!base) base = `Param${index + 1}`;
  if (/^[0-9]/.test(base)) base = `Param${base}`;
  if (PYTHON_RESERVED_PORT_NAMES.has(base)) base = `Param${base}`;

  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function parameterVariables(
  contract: BrepGrasshopperContract,
): Map<string, string> {
  const used = new Set(PYTHON_RESERVED_PORT_NAMES);
  return new Map(
    contract.source.parameters.map((parameter, index) => [
      parameter.id,
      pythonPortName(parameter.id, index, used),
    ]),
  );
}

function scalarExpression(
  value: BrepScalar,
  variables: ReadonlyMap<string, string>,
): string {
  if (typeof value === 'number') return pythonNumber(value);
  if (isBrepParameterReference(value)) {
    const variable = variables.get(value.parameter);
    if (!variable) {
      throw new BrepGrasshopperRhinoScriptError(
        'invalid_model',
        `Unknown parameter reference ${value.parameter} in Rhino script generation.`,
      );
    }
    return `brepia_scalar(${variable})`;
  }

  const left = scalarExpression(value.args[0], variables);
  if (value.op === 'neg') return `brepia_neg(${left})`;
  const right = scalarExpression(value.args[1], variables);
  return `brepia_${value.op}(${left}, ${right})`;
}

function vectorExpression(
  value: BrepVector3,
  variables: ReadonlyMap<string, string>,
  kind: 'point' | 'vector',
): string {
  const type = kind === 'point' ? 'Point3d' : 'Vector3d';
  return `rg.${type}(${value
    .map((entry) => scalarExpression(entry, variables))
    .join(', ')})`;
}

function pythonString(value: string): string {
  return JSON.stringify(value);
}

function stableJson(value: unknown): string {
  if (
    value == null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  throw new BrepGrasshopperRhinoScriptError(
    'invalid_model',
    'Unsupported value in deterministic metadata serialization.',
  );
}

function pointConstruction(
  point: BrepProjectObjectPoint,
  variables: ReadonlyMap<string, string>,
): string {
  const position = vectorExpression(point.position, variables, 'point');
  return `brepia_transform_point(${position}, brepiaTransform)`;
}

function pointsForKind(
  contract: BrepGrasshopperContract,
  kind: BrepProjectObjectPoint['kind'],
  variables: ReadonlyMap<string, string>,
): string {
  const points = (contract.source.projectObject?.points ?? []).filter(
    (point) => point.kind === kind,
  );
  if (points.length === 0) return '[]';
  return `[${points
    .map((point) => pointConstruction(point, variables))
    .join(', ')}]`;
}

function filletAxisExpression(axis: 'x' | 'y' | 'z'): string {
  if (axis === 'x') return 'rg.Vector3d(1, 0, 0)';
  if (axis === 'y') return 'rg.Vector3d(0, 1, 0)';
  return 'rg.Vector3d(0, 0, 1)';
}

function linearPatternVectorExpression(
  axis: 'x' | 'y' | 'z',
  distance: string,
): string {
  if (axis === 'x') return `rg.Vector3d(${distance}, 0, 0)`;
  if (axis === 'y') return `rg.Vector3d(0, ${distance}, 0)`;
  return `rg.Vector3d(0, 0, ${distance})`;
}

function extrudePlaneExpressions(
  axis: 'x' | 'y' | 'z',
  depthVariable: string,
): { origin: string; xAxis: string; yAxis: string } {
  if (axis === 'x') {
    return {
      origin: `rg.Point3d(-${depthVariable} / 2.0, 0, 0)`,
      xAxis: 'rg.Vector3d(0, 1, 0)',
      yAxis: 'rg.Vector3d(0, 0, 1)',
    };
  }
  if (axis === 'y') {
    return {
      origin: `rg.Point3d(0, -${depthVariable} / 2.0, 0)`,
      xAxis: 'rg.Vector3d(0, 0, 1)',
      yAxis: 'rg.Vector3d(1, 0, 0)',
    };
  }
  return {
    origin: `rg.Point3d(0, 0, -${depthVariable} / 2.0)`,
    xAxis: 'rg.Vector3d(1, 0, 0)',
    yAxis: 'rg.Vector3d(0, 1, 0)',
  };
}

function revolveFrameExpressions(axis: 'x' | 'y' | 'z'): {
  xAxis: string;
  yAxis: string;
  axisVector: string;
} {
  if (axis === 'x') {
    return {
      xAxis: 'rg.Vector3d(1, 0, 0)',
      yAxis: 'rg.Vector3d(0, 1, 0)',
      axisVector: 'rg.Vector3d(1, 0, 0)',
    };
  }
  if (axis === 'y') {
    return {
      xAxis: 'rg.Vector3d(0, 1, 0)',
      yAxis: 'rg.Vector3d(0, 0, 1)',
      axisVector: 'rg.Vector3d(0, 1, 0)',
    };
  }
  return {
    xAxis: 'rg.Vector3d(0, 0, 1)',
    yAxis: 'rg.Vector3d(1, 0, 0)',
    axisVector: 'rg.Vector3d(0, 0, 1)',
  };
}

function sweepFrameExpressions(
  axis: 'x' | 'y' | 'z',
  firstLeg: string,
  secondLeg: string,
  bendRadius: string,
): {
  p0: string;
  p1: string;
  p2: string;
  p3: string;
  tangent: string;
  sectionXAxis: string;
  sectionYAxis: string;
} {
  if (axis === 'x') {
    return {
      p0: 'rg.Point3d(0, 0, 0)',
      p1: `rg.Point3d(0, ${firstLeg}, 0)`,
      p2: `rg.Point3d(0, ${firstLeg} + ${bendRadius}, ${bendRadius})`,
      p3: `rg.Point3d(0, ${firstLeg} + ${bendRadius}, ${bendRadius} + ${secondLeg})`,
      tangent: 'rg.Vector3d(0, 1, 0)',
      sectionXAxis: 'rg.Vector3d(0, 0, 1)',
      sectionYAxis: 'rg.Vector3d(1, 0, 0)',
    };
  }
  if (axis === 'y') {
    return {
      p0: 'rg.Point3d(0, 0, 0)',
      p1: `rg.Point3d(0, 0, ${firstLeg})`,
      p2: `rg.Point3d(${bendRadius}, 0, ${firstLeg} + ${bendRadius})`,
      p3: `rg.Point3d(${bendRadius} + ${secondLeg}, 0, ${firstLeg} + ${bendRadius})`,
      tangent: 'rg.Vector3d(0, 0, 1)',
      sectionXAxis: 'rg.Vector3d(1, 0, 0)',
      sectionYAxis: 'rg.Vector3d(0, 1, 0)',
    };
  }
  return {
    p0: 'rg.Point3d(0, 0, 0)',
    p1: `rg.Point3d(${firstLeg}, 0, 0)`,
    p2: `rg.Point3d(${firstLeg} + ${bendRadius}, ${bendRadius}, 0)`,
    p3: `rg.Point3d(${firstLeg} + ${bendRadius}, ${bendRadius} + ${secondLeg}, 0)`,
    tangent: 'rg.Vector3d(1, 0, 0)',
    sectionXAxis: 'rg.Vector3d(0, 1, 0)',
    sectionYAxis: 'rg.Vector3d(0, 0, 1)',
  };
}

function mirrorPlaneExpressions(
  axis: 'x' | 'y' | 'z',
  offset: string,
): { origin: string; normal: string } {
  if (axis === 'x') {
    return {
      origin: `rg.Point3d(float(${offset}), 0, 0)`,
      normal: 'rg.Vector3d(1, 0, 0)',
    };
  }
  if (axis === 'y') {
    return {
      origin: `rg.Point3d(0, float(${offset}), 0)`,
      normal: 'rg.Vector3d(0, 1, 0)',
    };
  }
  return {
    origin: `rg.Point3d(0, 0, float(${offset}))`,
    normal: 'rg.Vector3d(0, 0, 1)',
  };
}

function assertSupportedRhinoContract(contract: BrepGrasshopperContract): void {
  if (contract.source.nodes.length === 0) {
    throw new BrepGrasshopperRhinoScriptError(
      'unsupported_model',
      'Rhino script generation requires at least one canonical BRep node.',
    );
  }
}

type RhinoGraphSource = {
  source: string;
  nodeVariables: Map<string, string>;
};

function buildGraphSource(
  contract: BrepGrasshopperContract,
  variables: ReadonlyMap<string, string>,
): RhinoGraphSource {
  const entries = new Map<string, { node: BrepNode; index: number }>(
    contract.source.nodes.map((node, index) => [node.id, { node, index }]),
  );
  const nodeVariables = new Map(
    contract.source.nodes.map((node, index) => [node.id, `brepiaNode${index}`]),
  );
  const emitted = new Set<string>();
  const visiting = new Set<string>();
  const lines: string[] = [];

  const emitNode = (nodeId: string): string => {
    const entry = entries.get(nodeId);
    const variable = nodeVariables.get(nodeId);
    if (!entry || !variable) {
      throw new BrepGrasshopperRhinoScriptError(
        'invalid_model',
        `Rhino script generation cannot resolve canonical node ${nodeId}.`,
      );
    }
    if (emitted.has(nodeId)) return variable;
    if (visiting.has(nodeId)) {
      throw new BrepGrasshopperRhinoScriptError(
        'invalid_model',
        `Rhino script generation encountered a cycle at node ${nodeId}.`,
      );
    }
    visiting.add(nodeId);

    const node = entry.node;
    if (node.type === 'box') {
      const width = scalarExpression(node.width, variables);
      const depth = scalarExpression(node.depth, variables);
      const height = scalarExpression(node.height, variables);
      lines.push(`${variable}Width = float(${width})`);
      lines.push(`${variable}Depth = float(${depth})`);
      lines.push(`${variable}Height = float(${height})`);
      lines.push(
        `if ${variable}Width <= 0.0 or ${variable}Depth <= 0.0 or ${variable}Height <= 0.0:`,
      );
      lines.push(
        `    raise ValueError(${pythonString(`Brepia box node ${node.id} dimensions must be greater than zero.`)})`,
      );
      lines.push(`${variable} = rg.Box(`);
      lines.push('    rg.Plane.WorldXY,');
      lines.push(
        `    rg.Interval(-${variable}Width / 2.0, ${variable}Width / 2.0),`,
      );
      lines.push(
        `    rg.Interval(-${variable}Depth / 2.0, ${variable}Depth / 2.0),`,
      );
      lines.push(
        `    rg.Interval(-${variable}Height / 2.0, ${variable}Height / 2.0),`,
      );
      lines.push(').ToBrep()');
    } else if (node.type === 'cylinder') {
      const radius = scalarExpression(node.radius, variables);
      const height = scalarExpression(node.height, variables);
      lines.push(`${variable}Radius = float(${radius})`);
      lines.push(`${variable}Height = float(${height})`);
      lines.push(`if ${variable}Radius <= 0.0 or ${variable}Height <= 0.0:`);
      lines.push(
        `    raise ValueError(${pythonString(`Brepia cylinder node ${node.id} dimensions must be greater than zero.`)})`,
      );
      lines.push(
        `${variable}Cylinder = rg.Cylinder(rg.Circle(rg.Plane.WorldXY, ${variable}Radius), ${variable}Height)`,
      );
      lines.push(`${variable} = ${variable}Cylinder.ToBrep(True, True)`);
      lines.push(`if ${variable} is None:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not create Brepia cylinder node ${node.id}.`)})`,
      );
      lines.push(
        `if not ${variable}.Transform(rg.Transform.Translation(rg.Vector3d(0, 0, -${variable}Height / 2.0))):`,
      );
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not center Brepia cylinder node ${node.id}.`)})`,
      );
    } else if (node.type === 'extrude') {
      const depth = scalarExpression(node.depth, variables);
      const depthVariable = `${variable}Depth`;
      const plane = extrudePlaneExpressions(node.axis, depthVariable);
      lines.push(`${depthVariable} = float(${depth})`);
      lines.push(`if ${depthVariable} <= 0.0:`);
      lines.push(
        `    raise ValueError(${pythonString(`Brepia extrude node ${node.id} depth must be greater than zero.`)})`,
      );
      lines.push(
        `${variable}Plane = rg.Plane(${plane.origin}, ${plane.xAxis}, ${plane.yAxis})`,
      );
      lines.push(`if not ${variable}Plane.IsValid:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not construct profile plane for Brepia extrude node ${node.id}.`)})`,
      );

      if (node.profile.type === 'rectangle') {
        const width = scalarExpression(node.profile.width, variables);
        const height = scalarExpression(node.profile.height, variables);
        lines.push(`${variable}ProfileWidth = float(${width})`);
        lines.push(`${variable}ProfileHeight = float(${height})`);
        lines.push(
          `if ${variable}ProfileWidth <= 0.0 or ${variable}ProfileHeight <= 0.0:`,
        );
        lines.push(
          `    raise ValueError(${pythonString(`Brepia extrude node ${node.id} rectangle profile dimensions must be greater than zero.`)})`,
        );
        lines.push(`${variable}Profile = rg.Rectangle3d(`);
        lines.push(`    ${variable}Plane,`);
        lines.push(
          `    rg.Interval(-${variable}ProfileWidth / 2.0, ${variable}ProfileWidth / 2.0),`,
        );
        lines.push(
          `    rg.Interval(-${variable}ProfileHeight / 2.0, ${variable}ProfileHeight / 2.0),`,
        );
        lines.push(').ToNurbsCurve()');
      } else if (node.profile.type === 'circle') {
        const radius = scalarExpression(node.profile.radius, variables);
        lines.push(`${variable}ProfileRadius = float(${radius})`);
        lines.push(`if ${variable}ProfileRadius <= 0.0:`);
        lines.push(
          `    raise ValueError(${pythonString(`Brepia extrude node ${node.id} circle profile radius must be greater than zero.`)})`,
        );
        lines.push(
          `${variable}Profile = rg.Circle(${variable}Plane, ${variable}ProfileRadius).ToNurbsCurve()`,
        );
      } else {
        const pointExpressions = node.profile.points.map(
          (point) =>
            `${variable}Plane.PointAt(float(${scalarExpression(point.u, variables)}), float(${scalarExpression(point.v, variables)}))`,
        );
        lines.push(
          `${variable}ProfilePoints = [${pointExpressions.join(', ')}]`,
        );
        lines.push(
          `${variable}ProfilePoints.append(${variable}ProfilePoints[0])`,
        );
        lines.push(
          `${variable}Profile = rg.PolylineCurve(${variable}ProfilePoints)`,
        );
      }

      lines.push(
        `if ${variable}Profile is None or not ${variable}Profile.IsValid or not ${variable}Profile.IsClosed:`,
      );
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not construct a closed profile for Brepia extrude node ${node.id}.`)})`,
      );
      lines.push(
        `${variable}Extrusion = rg.Extrusion.Create(${variable}Profile, ${variable}Plane, ${depthVariable}, True)`,
      );
      lines.push(`if ${variable}Extrusion is None:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not create extrusion for Brepia node ${node.id}.`)})`,
      );
      lines.push(`${variable} = ${variable}Extrusion.ToBrep()`);
      lines.push(`if ${variable} is None or not ${variable}.IsSolid:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino extrusion for Brepia node ${node.id} did not produce one closed solid Brep.`)})`,
      );
    } else if (node.type === 'revolve') {
      if (node.profile.type !== 'closedPolyline') {
        throw new BrepGrasshopperRhinoScriptError(
          'invalid_model',
          `Rhino revolve node ${node.id} requires a closedPolyline profile in the bounded first slice.`,
        );
      }
      const frame = revolveFrameExpressions(node.axis);
      const uvExpressions = node.profile.points.map(
        (point) =>
          `(float(${scalarExpression(point.u, variables)}), float(${scalarExpression(point.v, variables)}))`,
      );
      lines.push(
        `${variable}Plane = rg.Plane(rg.Point3d(0, 0, 0), ${frame.xAxis}, ${frame.yAxis})`,
      );
      lines.push(`if not ${variable}Plane.IsValid:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not construct the canonical revolve profile plane for Brepia node ${node.id}.`)})`,
      );
      lines.push(`${variable}ProfileUV = [${uvExpressions.join(', ')}]`);
      lines.push(`if any(item[1] < 0.0 for item in ${variable}ProfileUV):`);
      lines.push(
        `    raise ValueError(${pythonString(`Brepia revolve node ${node.id} profile must keep radial v >= 0 and must not cross the rotation axis.`)})`,
      );
      lines.push(`if any(item[1] == 0.0 for item in ${variable}ProfileUV):`);
      lines.push(
        `    ${variable}AxisContact = any(${variable}ProfileUV[i][1] == 0.0 and ${variable}ProfileUV[(i + 1) % len(${variable}ProfileUV)][1] == 0.0 for i in range(len(${variable}ProfileUV)))`,
      );
      lines.push(`    if not ${variable}AxisContact:`);
      lines.push(
        `        raise ValueError(${pythonString(`Brepia revolve node ${node.id} profile may touch the rotation axis only through a non-zero-length boundary segment on v = 0.`)})`,
      );
      lines.push(
        `${variable}ProfilePoints = [${variable}Plane.PointAt(item[0], item[1]) for item in ${variable}ProfileUV]`,
      );
      lines.push(
        `${variable}ProfilePoints.append(${variable}ProfilePoints[0])`,
      );
      lines.push(
        `${variable}Profile = rg.PolylineCurve(${variable}ProfilePoints)`,
      );
      lines.push(
        `if ${variable}Profile is None or not ${variable}Profile.IsValid or not ${variable}Profile.IsClosed:`,
      );
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not construct a closed profile for Brepia revolve node ${node.id}.`)})`,
      );
      lines.push(
        `${variable}Axis = rg.Line(rg.Point3d(0, 0, 0), rg.Point3d(${frame.axisVector}.X, ${frame.axisVector}.Y, ${frame.axisVector}.Z))`,
      );
      lines.push(
        `${variable}RevSurface = rg.RevSurface.Create(${variable}Profile, ${variable}Axis)`,
      );
      lines.push(`if ${variable}RevSurface is None:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not create a full revolution surface for Brepia node ${node.id}.`)})`,
      );
      lines.push(
        `${variable} = rg.Brep.CreateFromRevSurface(${variable}RevSurface, False, False)`,
      );
      lines.push(`if ${variable} is None or not ${variable}.IsSolid:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino revolve for Brepia node ${node.id} did not produce one closed solid Brep.`)})`,
      );
    } else if (node.type === 'sweep') {
      const profileRadius = scalarExpression(node.profile.radius, variables);
      const firstLeg = scalarExpression(node.path.firstLegLength, variables);
      const secondLeg = scalarExpression(node.path.secondLegLength, variables);
      const bendRadius = scalarExpression(node.path.bendRadius, variables);
      const profileRadiusVariable = `${variable}ProfileRadius`;
      const firstLegVariable = `${variable}FirstLegLength`;
      const secondLegVariable = `${variable}SecondLegLength`;
      const bendRadiusVariable = `${variable}BendRadius`;
      const frame = sweepFrameExpressions(
        node.path.planeNormalAxis,
        firstLegVariable,
        secondLegVariable,
        bendRadiusVariable,
      );
      lines.push(`${profileRadiusVariable} = float(${profileRadius})`);
      lines.push(`${firstLegVariable} = float(${firstLeg})`);
      lines.push(`${secondLegVariable} = float(${secondLeg})`);
      lines.push(`${bendRadiusVariable} = float(${bendRadius})`);
      lines.push(
        `if ${profileRadiusVariable} <= 0.0 or ${firstLegVariable} <= 0.0 or ${secondLegVariable} <= 0.0 or ${bendRadiusVariable} <= 0.0:`,
      );
      lines.push(
        `    raise ValueError(${pythonString(`Brepia sweep node ${node.id} dimensions must be greater than zero.`)})`,
      );
      lines.push(`if ${profileRadiusVariable} >= ${bendRadiusVariable}:`);
      lines.push(
        `    raise ValueError(${pythonString(`Brepia sweep node ${node.id} profile radius must be smaller than bend radius.`)})`,
      );
      lines.push(`${variable}P0 = ${frame.p0}`);
      lines.push(`${variable}P1 = ${frame.p1}`);
      lines.push(`${variable}P2 = ${frame.p2}`);
      lines.push(`${variable}P3 = ${frame.p3}`);
      lines.push(
        `${variable}Arc = rg.Arc(${variable}P1, ${frame.tangent}, ${variable}P2)`,
      );
      lines.push(`if not ${variable}Arc.IsValid:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not construct the tangent 90 degree elbow arc for Brepia sweep node ${node.id}.`)})`,
      );
      lines.push(`${variable}Rail = rg.PolyCurve()`);
      lines.push(
        `if not ${variable}Rail.Append(rg.Line(${variable}P0, ${variable}P1)) or not ${variable}Rail.Append(${variable}Arc) or not ${variable}Rail.Append(rg.Line(${variable}P2, ${variable}P3)):`,
      );
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not construct the canonical rail for Brepia sweep node ${node.id}.`)})`,
      );
      lines.push(
        `${variable}SectionPlane = rg.Plane(${variable}P0, ${frame.sectionXAxis}, ${frame.sectionYAxis})`,
      );
      lines.push(`if not ${variable}SectionPlane.IsValid:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not construct the canonical section plane for Brepia sweep node ${node.id}.`)})`,
      );
      lines.push(
        `${variable}Profile = rg.Circle(${variable}SectionPlane, ${profileRadiusVariable}).ToNurbsCurve()`,
      );
      lines.push(
        `${variable}Parts = rg.Brep.CreateFromSweep(${variable}Rail, ${variable}Profile, False, brepiaTolerance)`,
      );
      lines.push(`if ${variable}Parts is None or len(${variable}Parts) != 1:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino sweep for Brepia node ${node.id} did not produce exactly one Brep.`)})`,
      );
      lines.push(
        `${variable} = ${variable}Parts[0].CapPlanarHoles(brepiaTolerance)`,
      );
      lines.push(
        `if ${variable} is None or not ${variable}.IsValid or not ${variable}.IsSolid:`,
      );
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino sweep for Brepia node ${node.id} did not produce one closed solid Brep.`)})`,
      );
    } else if (node.type === 'transform') {
      const input = emitNode(node.input);
      const translate = vectorExpression(
        node.translate ?? [0, 0, 0],
        variables,
        'vector',
      );
      const rotate = node.rotateDeg ?? [0, 0, 0];
      const rotateX = scalarExpression(rotate[0], variables);
      const rotateY = scalarExpression(rotate[1], variables);
      const rotateZ = scalarExpression(rotate[2], variables);
      lines.push(`${variable}RotationXDeg = float(${rotateX})`);
      lines.push(`${variable}RotationYDeg = float(${rotateY})`);
      lines.push(`${variable}RotationZDeg = float(${rotateZ})`);
      lines.push(
        `${variable}RotationX = rg.Transform.Rotation(math.radians(${variable}RotationXDeg), rg.Vector3d(1, 0, 0), rg.Point3d(0, 0, 0))`,
      );
      lines.push(
        `${variable}RotationY = rg.Transform.Rotation(math.radians(${variable}RotationYDeg), rg.Vector3d(0, 1, 0), rg.Point3d(0, 0, 0))`,
      );
      lines.push(
        `${variable}RotationZ = rg.Transform.Rotation(math.radians(${variable}RotationZDeg), rg.Vector3d(0, 0, 1), rg.Point3d(0, 0, 0))`,
      );
      lines.push(
        `${variable}Rotation = ${variable}RotationX * ${variable}RotationY * ${variable}RotationZ`,
      );
      lines.push(
        `${variable}Translation = rg.Transform.Translation(${translate})`,
      );
      lines.push(
        `${variable}Transform = ${variable}Translation * ${variable}Rotation`,
      );
      lines.push(`${variable} = ${input}.DuplicateBrep()`);
      lines.push(`if not ${variable}.Transform(${variable}Transform):`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not transform Brepia node ${node.id}.`)})`,
      );
    } else if (node.type === 'mirror') {
      const input = emitNode(node.input);
      const offset = scalarExpression(node.offset, variables);
      const plane = mirrorPlaneExpressions(node.normalAxis, offset);
      lines.push(`${variable} = ${input}.DuplicateBrep()`);
      lines.push(
        `${variable}MirrorPlane = rg.Plane(${plane.origin}, ${plane.normal})`,
      );
      lines.push(`if not ${variable}MirrorPlane.IsValid:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not construct mirror plane for Brepia node ${node.id}.`)})`,
      );
      lines.push(
        `if not ${variable}.Transform(rg.Transform.Mirror(${variable}MirrorPlane)):`,
      );
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino could not mirror Brepia node ${node.id}.`)})`,
      );
    } else if (node.type === 'linearPattern') {
      const input = emitNode(node.input);
      const spacing = scalarExpression(node.spacing, variables);
      const indexVariable = `${variable}Index`;
      const itemVariable = `${variable}Item`;
      const distance = `${indexVariable} * ${variable}Spacing`;
      const translation = linearPatternVectorExpression(node.axis, distance);
      lines.push(`${variable}Spacing = float(${spacing})`);
      lines.push(`if ${variable}Spacing == 0.0:`);
      lines.push(
        `    raise ValueError(${pythonString(`Brepia linearPattern ${node.id} spacing must resolve non-zero.`)})`,
      );
      lines.push(`${variable} = []`);
      lines.push(`for ${indexVariable} in range(${node.count}):`);
      lines.push(`    ${itemVariable} = ${input}.DuplicateBrep()`);
      lines.push(
        `    if not ${itemVariable}.Transform(rg.Transform.Translation(${translation})):`,
      );
      lines.push(
        `        raise RuntimeError(${pythonString(`Rhino could not place an instance for Brepia linearPattern ${node.id}.`)})`,
      );
      lines.push(`    ${variable}.append(${itemVariable})`);
    } else if (node.type === 'rectangularPattern') {
      const input = emitNode(node.input);
      const spacingA = scalarExpression(node.spacingA, variables);
      const spacingB = scalarExpression(node.spacingB, variables);
      const aVariable = `${variable}A`;
      const bVariable = `${variable}B`;
      const itemVariable = `${variable}Item`;
      const distanceA = `${aVariable} * ${variable}SpacingA`;
      const distanceB = `${bVariable} * ${variable}SpacingB`;
      const vectorA = linearPatternVectorExpression(node.axisA, distanceA);
      const vectorB = linearPatternVectorExpression(node.axisB, distanceB);
      lines.push(`${variable}SpacingA = float(${spacingA})`);
      lines.push(`${variable}SpacingB = float(${spacingB})`);
      lines.push(
        `if ${variable}SpacingA == 0.0 or ${variable}SpacingB == 0.0:`,
      );
      lines.push(
        `    raise ValueError(${pythonString(`Brepia rectangularPattern ${node.id} spacings must resolve non-zero.`)})`,
      );
      lines.push(`${variable} = []`);
      lines.push(`for ${aVariable} in range(${node.countA}):`);
      lines.push(`    for ${bVariable} in range(${node.countB}):`);
      lines.push(`        ${itemVariable} = ${input}.DuplicateBrep()`);
      lines.push(
        `        ${variable}Translation = rg.Transform.Translation(${vectorA} + ${vectorB})`,
      );
      lines.push(
        `        if not ${itemVariable}.Transform(${variable}Translation):`,
      );
      lines.push(
        `            raise RuntimeError(${pythonString(`Rhino could not place an instance for Brepia rectangularPattern ${node.id}.`)})`,
      );
      lines.push(`        ${variable}.append(${itemVariable})`);
    } else if (node.type === 'circularPattern') {
      const input = emitNode(node.input);
      const angleStepDeg = scalarExpression(node.angleStepDeg, variables);
      const center = vectorExpression(node.center, variables, 'point');
      const indexVariable = `${variable}Index`;
      const itemVariable = `${variable}Item`;
      lines.push(`${variable}AngleStepDeg = float(${angleStepDeg})`);
      lines.push(`if ${variable}AngleStepDeg == 0.0:`);
      lines.push(
        `    raise ValueError(${pythonString(`Brepia circularPattern ${node.id} angleStepDeg must resolve non-zero.`)})`,
      );
      lines.push(`if abs(${variable}AngleStepDeg) * ${node.count} > 360.0:`);
      lines.push(
        `    raise ValueError(${pythonString(`Brepia circularPattern ${node.id} abs(angleStepDeg) * count must not exceed 360 degrees.`)})`,
      );
      lines.push(`${variable}Center = ${center}`);
      lines.push(`${variable}Axis = ${filletAxisExpression(node.axis)}`);
      lines.push(`${variable} = []`);
      lines.push(`for ${indexVariable} in range(${node.count}):`);
      lines.push(`    ${itemVariable} = ${input}.DuplicateBrep()`);
      lines.push(
        `    ${variable}Rotation = rg.Transform.Rotation(math.radians(${indexVariable} * ${variable}AngleStepDeg), ${variable}Axis, ${variable}Center)`,
      );
      lines.push(`    if not ${itemVariable}.Transform(${variable}Rotation):`);
      lines.push(
        `        raise RuntimeError(${pythonString(`Rhino could not place an instance for Brepia circularPattern ${node.id}.`)})`,
      );
      lines.push(`    ${variable}.append(${itemVariable})`);
    } else if (node.type === 'subtract') {
      const base = emitNode(node.base);
      lines.push(`${variable} = ${base}.DuplicateBrep()`);
      node.tools.forEach((toolId, toolIndex) => {
        const tool = emitNode(toolId);
        const toolNode = entries.get(toolId)?.node;
        if (!toolNode) {
          throw new BrepGrasshopperRhinoScriptError(
            'invalid_model',
            `Rhino script generation cannot resolve subtract tool ${toolId}.`,
          );
        }
        const parts = `${variable}Parts${toolIndex}`;
        const disjoint = `${variable}Disjoint${toolIndex}`;
        if (
          toolNode.type === 'linearPattern' ||
          toolNode.type === 'rectangularPattern' ||
          toolNode.type === 'circularPattern'
        ) {
          const item = `${variable}Tool${toolIndex}`;
          lines.push(`for ${item} in ${tool}:`);
          lines.push(
            `    ${disjoint} = brepia_bounds_disjoint(${variable}, ${item}, brepiaTolerance)`,
          );
          lines.push(`    if not ${disjoint}:`);
          lines.push(
            `        ${parts} = rg.Brep.CreateBooleanDifference(${variable}, ${item}, brepiaTolerance)`,
          );
          lines.push(`        if ${parts} is None or len(${parts}) != 1:`);
          lines.push(
            `            raise RuntimeError(${pythonString(`Rhino boolean difference for Brepia node ${node.id} did not produce exactly one Brep.`)})`,
          );
          lines.push(`        ${variable} = ${parts}[0]`);
        } else {
          lines.push(
            `${disjoint} = brepia_bounds_disjoint(${variable}, ${tool}, brepiaTolerance)`,
          );
          lines.push(`if not ${disjoint}:`);
          lines.push(
            `    ${parts} = rg.Brep.CreateBooleanDifference(${variable}, ${tool}, brepiaTolerance)`,
          );
          lines.push(`    if ${parts} is None or len(${parts}) != 1:`);
          lines.push(
            `        raise RuntimeError(${pythonString(`Rhino boolean difference for Brepia node ${node.id} did not produce exactly one Brep.`)})`,
          );
          lines.push(`    ${variable} = ${parts}[0]`);
        }
      });
    } else if (node.type === 'union') {
      const inputs = node.inputs.map((inputId) => emitNode(inputId));
      const parts = `${variable}Parts`;
      lines.push(
        `${parts} = rg.Brep.CreateBooleanUnion([${inputs
          .map((input) => `${input}.DuplicateBrep()`)
          .join(', ')}], brepiaTolerance)`,
      );
      lines.push(`if ${parts} is None or len(${parts}) != 1:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino boolean union for Brepia node ${node.id} did not produce exactly one Brep.`)})`,
      );
      lines.push(`${variable} = ${parts}[0]`);
    } else if (node.type === 'intersect') {
      const inputs = node.inputs.map((inputId) => emitNode(inputId));
      const parts = `${variable}Parts`;
      lines.push(`${parts} = [${inputs[0]}.DuplicateBrep()]`);
      inputs.slice(1).forEach((input, inputIndex) => {
        const nextParts = `${variable}Parts${inputIndex + 1}`;
        lines.push(
          `${nextParts} = rg.Brep.CreateBooleanIntersection(${parts}, [${input}], brepiaTolerance)`,
        );
        lines.push(`if ${nextParts} is None or len(${nextParts}) == 0:`);
        lines.push(
          `    raise RuntimeError(${pythonString(`Rhino boolean intersection for Brepia node ${node.id} produced no Brep.`)})`,
        );
        lines.push(`${parts} = list(${nextParts})`);
      });
      lines.push(`if len(${parts}) != 1:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino boolean intersection for Brepia node ${node.id} did not produce exactly one Brep.`)})`,
      );
      lines.push(`${variable} = ${parts}[0]`);
    } else if (node.type === 'fillet') {
      const input = emitNode(node.input);
      const radius = scalarExpression(node.radius, variables);
      const edge = `${variable}Edge`;
      const edgeParameter = `${variable}EdgeParameter`;
      const edgeDirection = `${variable}EdgeDirection`;
      const edgeDot = `${variable}EdgeDot`;

      lines.push('from System import Array, Double, Int32');
      lines.push(`${variable}Input = ${input}.DuplicateBrep()`);
      lines.push(`${variable}Radius = float(${radius})`);
      lines.push(`if ${variable}Radius <= 0.0:`);
      lines.push(
        `    raise ValueError(${pythonString(`Brepia fillet node ${node.id} radius must be greater than zero.`)})`,
      );
      lines.push(`${variable}EdgeIndices = []`);
      lines.push(
        `${variable}Axis = ${filletAxisExpression(node.selector.axis)}`,
      );
      lines.push(`for ${edge} in ${variable}Input.Edges:`);
      lines.push(`    ${edgeParameter} = ${edge}.Domain.ParameterAt(0.5)`);
      lines.push(`    ${edgeDirection} = ${edge}.TangentAt(${edgeParameter})`);
      lines.push(`    if not ${edgeDirection}.Unitize():`);
      lines.push('        continue');
      lines.push(
        `    ${edgeDot} = (${edgeDirection}.X * ${variable}Axis.X + ${edgeDirection}.Y * ${variable}Axis.Y + ${edgeDirection}.Z * ${variable}Axis.Z)`,
      );
      lines.push(`    if abs(abs(${edgeDot}) - 1.0) <= 1e-3:`);
      lines.push(`        ${variable}EdgeIndices.append(${edge}.EdgeIndex)`);
      lines.push(`if len(${variable}EdgeIndices) == 0:`);
      lines.push(
        `    raise ValueError(${pythonString(`Brepia fillet selector for node ${node.id} matched no edges.`)})`,
      );
      lines.push(`${variable}EdgeArray = Array[Int32](${variable}EdgeIndices)`);
      lines.push(
        `${variable}Radii = Array[Double]([${variable}Radius] * len(${variable}EdgeIndices))`,
      );
      lines.push(`${variable}Parts = rg.Brep.CreateFilletEdges(`);
      lines.push(`    ${variable}Input,`);
      lines.push(`    ${variable}EdgeArray,`);
      lines.push(`    ${variable}Radii,`);
      lines.push(`    ${variable}Radii,`);
      lines.push('    rg.BlendType.Fillet,');
      lines.push('    rg.RailType.RollingBall,');
      lines.push('    brepiaTolerance,');
      lines.push(')');
      lines.push(`if ${variable}Parts is None or len(${variable}Parts) != 1:`);
      lines.push(
        `    raise RuntimeError(${pythonString(`Rhino fillet for Brepia node ${node.id} did not produce exactly one Brep.`)})`,
      );
      lines.push(`${variable} = ${variable}Parts[0]`);
    }

    visiting.delete(nodeId);
    emitted.add(nodeId);
    return variable;
  };

  for (const node of contract.source.nodes) emitNode(node.id);

  return {
    source: lines.join('\n'),
    nodeVariables,
  };
}

function roleExpression(
  nodeId: string | undefined,
  nodeVariables: ReadonlyMap<string, string>,
): string {
  if (!nodeId) return 'None';
  const variable = nodeVariables.get(nodeId);
  if (!variable) {
    throw new BrepGrasshopperRhinoScriptError(
      'invalid_model',
      `Rhino script generation cannot resolve project-object role node ${nodeId}.`,
    );
  }
  return `brepia_place_brep(${variable}, brepiaTransform)`;
}

function buildSource(
  contract: BrepGrasshopperContract,
  variables: ReadonlyMap<string, string>,
): string {
  const graph = buildGraphSource(contract, variables);
  const resultVariable = graph.nodeVariables.get(contract.source.resultNodeId);
  const resultNode = contract.source.nodes.find(
    (node) => node.id === contract.source.resultNodeId,
  );
  if (!resultVariable || !resultNode) {
    throw new BrepGrasshopperRhinoScriptError(
      'invalid_model',
      `Rhino script generation cannot resolve result node ${contract.source.resultNodeId}.`,
    );
  }

  const placement = contract.source.placement;
  const defaultOrigin = vectorExpression(placement.origin, variables, 'point');
  const defaultXAxis = vectorExpression(placement.xAxis, variables, 'vector');
  const defaultYAxis = vectorExpression(placement.yAxis, variables, 'vector');
  const definition = contract.source.projectObject;
  const footprint = roleExpression(
    definition?.footprintNodeId,
    graph.nodeVariables,
  );
  const clearance = roleExpression(
    definition?.clearanceEnvelopeNodeId,
    graph.nodeVariables,
  );
  const maintenance = roleExpression(
    definition?.maintenanceEnvelopeNodeId,
    graph.nodeVariables,
  );
  const connections = pointsForKind(contract, 'connection', variables);
  const mounting = pointsForKind(contract, 'mounting', variables);
  const cable = pointsForKind(contract, 'cable', variables);
  const metadataEnvelope = stableJson({
    projectId: contract.model.projectId,
    projectName: contract.model.projectName,
    projectSchemaVersion: contract.model.projectSchemaVersion,
    sourceRevisionId: contract.model.sourceRevisionId,
    metadata: contract.source.metadata ?? null,
  });
  const resultExpression =
    resultNode.type === 'linearPattern' ||
    resultNode.type === 'rectangularPattern' ||
    resultNode.type === 'circularPattern'
      ? `[brepia_place_brep(brepiaResultItem, brepiaTransform) for brepiaResultItem in ${resultVariable}]`
      : `brepia_place_brep(${resultVariable}, brepiaTransform)`;

  return `# Brepia Rhino Python 3 script v1\n# projectId: ${contract.model.projectId}\n# sourceRevisionId: ${contract.model.sourceRevisionId}\nimport math\nimport Rhino\nimport Rhino.Geometry as rg\n\ndef brepia_scalar(value):\n    value = float(value)\n    if not math.isfinite(value) or abs(value) > 1000000000.0:\n        raise ValueError("Brepia scalar value must be finite and bounded.")\n    return 0.0 if value == 0.0 else value\n\ndef brepia_add(left, right):\n    return brepia_scalar(brepia_scalar(left) + brepia_scalar(right))\n\ndef brepia_sub(left, right):\n    return brepia_scalar(brepia_scalar(left) - brepia_scalar(right))\n\ndef brepia_mul(left, right):\n    return brepia_scalar(brepia_scalar(left) * brepia_scalar(right))\n\ndef brepia_div(left, right):\n    left = brepia_scalar(left)\n    right = brepia_scalar(right)\n    if right == 0.0:\n        raise ValueError("Brepia scalar expression divides by zero.")\n    return brepia_scalar(left / right)\n\ndef brepia_neg(value):\n    return brepia_scalar(-brepia_scalar(value))\n\ndef brepia_normalize_plane(source):\n    if source is None or not source.IsValid:\n        raise ValueError("Brepia project placement plane is invalid.")\n    return source\n\ndef brepia_transform_point(point, transform):\n    point.Transform(transform)\n    return point\n\ndef brepia_place_brep(source, transform):\n    placed = source.DuplicateBrep()\n    if not placed.Transform(transform):\n        raise RuntimeError("Rhino could not apply Brepia project placement.")\n    return placed\n\ndef brepia_bounds_disjoint(first, second, tolerance):\n    first_box = first.GetBoundingBox(True)\n    second_box = second.GetBoundingBox(True)\n    if not first_box.IsValid or not second_box.IsValid:\n        return False\n    tolerance = max(0.0, float(tolerance))\n    return (\n        first_box.Max.X < second_box.Min.X - tolerance or\n        second_box.Max.X < first_box.Min.X - tolerance or\n        first_box.Max.Y < second_box.Min.Y - tolerance or\n        second_box.Max.Y < first_box.Min.Y - tolerance or\n        first_box.Max.Z < second_box.Min.Z - tolerance or\n        second_box.Max.Z < first_box.Min.Z - tolerance\n    )\n\nbrepiaDoc = Rhino.RhinoDoc.ActiveDoc\nbrepiaTolerance = brepiaDoc.ModelAbsoluteTolerance if brepiaDoc is not None else 0.01\n\n${graph.source}\n\nbrepiaDefaultPlane = brepia_normalize_plane(\n    rg.Plane(${defaultOrigin}, ${defaultXAxis}, ${defaultYAxis})\n)\nbrepiaTransform = rg.Transform.PlaneToPlane(rg.Plane.WorldXY, brepiaDefaultPlane)\n\nResult = ${resultExpression}\nFootprint = ${footprint}\nClearance = ${clearance}\nMaintenance = ${maintenance}\nConnections = ${connections}\nMounting = ${mounting}\nCable = ${cable}\nMetadata = ${pythonString(metadataEnvelope)}\n`;
}

export async function createBrepGrasshopperRhinoScriptPlan(
  value: unknown,
): Promise<BrepGrasshopperRhinoScriptPlan> {
  const contract = normalizeBrepGrasshopperContract(value);
  assertSupportedRhinoContract(contract);
  const packagePlan = await createBrepGrasshopperPackagePlan(contract);
  const variables = parameterVariables(contract);

  const numberInputs = await Promise.all(
    packagePlan.controls.map(
      async (control): Promise<BrepGrasshopperRhinoScriptInput> => {
        const variableName = variables.get(control.inputId);
        if (!variableName) {
          throw new BrepGrasshopperRhinoScriptError(
            'invalid_model',
            `Published Grasshopper input ${control.inputId} has no canonical Python variable.`,
          );
        }
        return {
          inputId: control.inputId,
          variableName,
          nickname: variableName,
          kind: 'number',
          instanceGuid: await stableGuid([
            contract.model.projectId,
            'script-input',
            control.inputId,
          ]),
          sourceObjectGuid: control.instanceGuid,
          converterType: 'System.Double',
          typeHintGuid: BREP_GRASSHOPPER_SCRIPT_DOUBLE_HINT_GUID,
        };
      },
    ),
  );

  const outputDefinitions = [
    ['result', 'Result'],
    ['footprint', 'Footprint'],
    ['clearanceEnvelope', 'Clearance'],
    ['maintenanceEnvelope', 'Maintenance'],
    ['connectionPoints', 'Connections'],
    ['mountingPoints', 'Mounting'],
    ['cablePoints', 'Cable'],
    ['metadata', 'Metadata'],
  ] as const;
  const outputs = await Promise.all(
    outputDefinitions.map(async ([outputId, portName]) => ({
      outputId,
      variableName: portName,
      nickname: portName,
      instanceGuid: await stableGuid([
        contract.model.projectId,
        'script-output',
        outputId,
      ]),
    })),
  );

  const source = buildSource(contract, variables);
  return {
    kind: 'brepia-rhino-python3-script-plan',
    schemaVersion: 1,
    projectId: contract.model.projectId,
    sourceRevisionId: contract.model.sourceRevisionId,
    componentInstanceGuid: packagePlan.component.instanceGuid,
    componentNickname: contract.model.projectName,
    inputs: numberInputs,
    outputs,
    source,
    sourceSha256: await sha256Hex(source),
  };
}
