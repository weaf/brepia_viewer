import {
  normalizeBrepGrasshopperContract,
  type BrepGrasshopperContract,
} from './brepGrasshopperContract.ts';
import {
  BrepGrasshopperRhinoScriptError,
  createBrepGrasshopperRhinoScriptPlan as createLegacyBrepGrasshopperRhinoScriptPlan,
} from './brepGrasshopperRhinoScriptLegacy.ts';
import type { BrepProfileHole, BrepScalar } from './brepProject.ts';
import { isBrepParameterReference } from './brepScalar.ts';

export * from './brepGrasshopperRhinoScriptLegacy.ts';

function pythonNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new BrepGrasshopperRhinoScriptError(
      'invalid_model',
      'Rhino script numeric literals must be finite.',
    );
  }
  return String(Object.is(value, -0) ? 0 : value);
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
        `Unknown parameter reference ${value.parameter} in Rhino multi-loop generation.`,
      );
    }
    return `brepia_scalar(${variable})`;
  }

  const left = scalarExpression(value.args[0], variables);
  if (value.op === 'neg') return `brepia_neg(${left})`;
  const right = scalarExpression(value.args[1], variables);
  return `brepia_${value.op}(${left}, ${right})`;
}

function pythonString(value: string): string {
  return JSON.stringify(value);
}

function holeCurveSource(
  nodeId: string,
  nodeVariable: string,
  hole: BrepProfileHole,
  holeIndex: number,
  variables: ReadonlyMap<string, string>,
): string[] {
  const prefix = `${nodeVariable}ProfileHole${holeIndex}`;
  const offsetU = scalarExpression(hole.offsetU, variables);
  const offsetV = scalarExpression(hole.offsetV, variables);
  const lines = [
    `${prefix}OffsetU = float(${offsetU})`,
    `${prefix}OffsetV = float(${offsetV})`,
    `${prefix}Plane = rg.Plane(${nodeVariable}Plane.PointAt(${prefix}OffsetU, ${prefix}OffsetV), ${nodeVariable}Plane.XAxis, ${nodeVariable}Plane.YAxis)`,
  ];

  if (hole.loop.type === 'rectangle') {
    const width = scalarExpression(hole.loop.width, variables);
    const height = scalarExpression(hole.loop.height, variables);
    lines.push(`${prefix}Width = float(${width})`);
    lines.push(`${prefix}Height = float(${height})`);
    lines.push(`if ${prefix}Width <= 0.0 or ${prefix}Height <= 0.0:`);
    lines.push(
      `    raise ValueError(${pythonString(`Brepia extrude node ${nodeId} hole ${holeIndex + 1} rectangle dimensions must be greater than zero.`)})`,
    );
    lines.push(`${prefix} = rg.Rectangle3d(`);
    lines.push(`    ${prefix}Plane,`);
    lines.push(`    rg.Interval(-${prefix}Width / 2.0, ${prefix}Width / 2.0),`);
    lines.push(`    rg.Interval(-${prefix}Height / 2.0, ${prefix}Height / 2.0),`);
    lines.push(').ToNurbsCurve()');
  } else if (hole.loop.type === 'circle') {
    const radius = scalarExpression(hole.loop.radius, variables);
    lines.push(`${prefix}Radius = float(${radius})`);
    lines.push(`if ${prefix}Radius <= 0.0:`);
    lines.push(
      `    raise ValueError(${pythonString(`Brepia extrude node ${nodeId} hole ${holeIndex + 1} circle radius must be greater than zero.`)})`,
    );
    lines.push(
      `${prefix} = rg.Circle(${prefix}Plane, ${prefix}Radius).ToNurbsCurve()`,
    );
  } else {
    const points = hole.loop.points.map((point) => {
      const u = scalarExpression(point.u, variables);
      const v = scalarExpression(point.v, variables);
      return `${nodeVariable}Plane.PointAt(float(brepia_add(${prefix}OffsetU, ${u})), float(brepia_add(${prefix}OffsetV, ${v})))`;
    });
    lines.push(`${prefix}Points = [${points.join(', ')}]`);
    lines.push(`${prefix}Points.append(${prefix}Points[0])`);
    lines.push(`${prefix} = rg.PolylineCurve(${prefix}Points)`);
  }

  lines.push(
    `if ${prefix} is None or not ${prefix}.IsValid or not ${prefix}.IsClosed:`,
  );
  lines.push(
    `    raise RuntimeError(${pythonString(`Rhino could not construct closed hole ${holeIndex + 1} for Brepia extrude node ${nodeId}.`)})`,
  );
  return lines;
}

function legacyExtrusionBlock(nodeId: string, variable: string): string {
  const depthVariable = `${variable}Depth`;
  return [
    `${variable}Extrusion = rg.Extrusion.Create(${variable}Profile, ${variable}Plane, ${depthVariable}, True)`,
    `if ${variable}Extrusion is None:`,
    `    raise RuntimeError(${pythonString(`Rhino could not create extrusion for Brepia node ${nodeId}.`)})`,
    `${variable} = ${variable}Extrusion.ToBrep()`,
    `if ${variable} is None or not ${variable}.IsSolid:`,
    `    raise RuntimeError(${pythonString(`Rhino extrusion for Brepia node ${nodeId} did not produce one closed solid Brep.`)})`,
  ].join('\n');
}

function pathCurveExpression(
  axis: 'x' | 'y' | 'z',
  depthVariable: string,
): string {
  if (axis === 'x') {
    return `rg.LineCurve(rg.Point3d(-${depthVariable} / 2.0, 0, 0), rg.Point3d(${depthVariable} / 2.0, 0, 0))`;
  }
  if (axis === 'y') {
    return `rg.LineCurve(rg.Point3d(0, -${depthVariable} / 2.0, 0), rg.Point3d(0, ${depthVariable} / 2.0, 0))`;
  }
  return `rg.LineCurve(rg.Point3d(0, 0, -${depthVariable} / 2.0), rg.Point3d(0, 0, ${depthVariable} / 2.0))`;
}

function multiLoopExtrusionBlock(
  contract: BrepGrasshopperContract,
  nodeIndex: number,
  variables: ReadonlyMap<string, string>,
): { legacy: string; replacement: string } | null {
  const node = contract.source.nodes[nodeIndex];
  if (!node || node.type !== 'extrude' || !node.profile.holes?.length) {
    return null;
  }

  const variable = `brepiaNode${nodeIndex}`;
  const depthVariable = `${variable}Depth`;
  const holeLines = node.profile.holes.flatMap((hole, holeIndex) =>
    holeCurveSource(node.id, variable, hole, holeIndex, variables),
  );
  const holeVariables = node.profile.holes.map(
    (_, holeIndex) => `${variable}ProfileHole${holeIndex}`,
  );
  const expectedLoopCount = node.profile.holes.length + 1;

  const replacement = [
    ...holeLines,
    `${variable}Regions = rg.Brep.CreatePlanarBreps([${variable}Profile, ${holeVariables.join(', ')}], brepiaTolerance)`,
    `if ${variable}Regions is None or len(${variable}Regions) != 1:`,
    `    raise RuntimeError(${pythonString(`Rhino planar multi-loop profile for Brepia node ${node.id} did not produce exactly one region.`)})`,
    `${variable}Region = ${variable}Regions[0]`,
    `if ${variable}Region is None or not ${variable}Region.IsValid or ${variable}Region.Faces.Count != 1 or ${variable}Region.Loops.Count != ${expectedLoopCount}:`,
    `    raise RuntimeError(${pythonString(`Rhino planar multi-loop profile for Brepia node ${node.id} did not preserve exactly one outer loop and ${node.profile.holes.length} inner holes.`)})`,
    `${variable}Path = ${pathCurveExpression(node.axis, depthVariable)}`,
    `${variable} = ${variable}Region.Faces[0].CreateExtrusion(${variable}Path, True)`,
    `if ${variable} is None or not ${variable}.IsValid or not ${variable}.IsSolid:`,
    `    raise RuntimeError(${pythonString(`Rhino multi-loop extrusion for Brepia node ${node.id} did not produce one closed solid Brep.`)})`,
  ].join('\n');

  return {
    legacy: legacyExtrusionBlock(node.id, variable),
    replacement,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createBrepGrasshopperRhinoScriptPlan(value: unknown) {
  const contract = normalizeBrepGrasshopperContract(value);
  const plan = await createLegacyBrepGrasshopperRhinoScriptPlan(contract);
  if (
    !contract.source.nodes.some(
      (node) => node.type === 'extrude' && Boolean(node.profile.holes?.length),
    )
  ) {
    return plan;
  }

  const variables = new Map(
    plan.inputs
      .filter((input) => input.kind === 'number')
      .map((input) => [input.inputId, input.variableName]),
  );
  let source = plan.source;

  contract.source.nodes.forEach((_, nodeIndex) => {
    const block = multiLoopExtrusionBlock(contract, nodeIndex, variables);
    if (!block) return;
    if (!source.includes(block.legacy)) {
      throw new BrepGrasshopperRhinoScriptError(
        'invalid_model',
        `Rhino multi-loop generation could not locate the legacy extrusion block for node index ${nodeIndex}.`,
      );
    }
    source = source.replace(block.legacy, block.replacement);
  });

  return {
    ...plan,
    source,
    sourceSha256: await sha256Hex(source),
  };
}
