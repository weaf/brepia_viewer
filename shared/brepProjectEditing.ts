import {
  normalizeBrepProject,
  type BrepNode,
  type BrepParameterUnit,
  type BrepProfile,
  type BrepProfileLoop,
  type BrepProject,
  type BrepProjectMetadata,
  type BrepProjectObjectDefinition,
  type BrepProjectObjectPointKind,
  type BrepProjectPlacement,
  type BrepPublishedNumberParameter,
  type BrepVector3,
} from './brepProject.ts';
import { resolveBrepProjectPlacement } from './brepProvider.ts';
import { brepScalarReferencesParameter } from './brepScalar.ts';

export function brepNodeDependencies(node: BrepNode): string[] {
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

export function brepNodeConsumers(
  project: BrepProject,
  nodeId: string,
): string[] {
  return project.nodes
    .filter((node) => brepNodeDependencies(node).includes(nodeId))
    .map((node) => node.id);
}

export function brepProjectObjectNodeRoles(
  project: BrepProject,
  nodeId: string,
): string[] {
  const roles: string[] = [];
  if (project.projectObject?.footprintNodeId === nodeId)
    roles.push('footprint');
  if (project.projectObject?.clearanceEnvelopeNodeId === nodeId)
    roles.push('clearance envelope');
  if (project.projectObject?.maintenanceEnvelopeNodeId === nodeId)
    roles.push('maintenance envelope');
  return roles;
}

export function suggestBrepNodeId(
  project: BrepProject,
  type: BrepNode['type'],
): string {
  const existing = new Set(project.nodes.map((node) => node.id));
  if (!existing.has(type)) return type;
  for (let index = 2; index <= project.nodes.length + 2; index += 1) {
    const candidate = `${type}${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`Could not suggest a unique BRep node ID for ${type}.`);
}

export function suggestBrepParameterId(project: BrepProject): string {
  const existing = new Set(project.parameters.map((parameter) => parameter.id));
  if (!existing.has('parameter')) return 'parameter';
  for (let index = 2; index <= project.parameters.length + 2; index += 1) {
    const candidate = `parameter${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error('Could not suggest a unique BRep published parameter ID.');
}

export function suggestBrepProjectObjectPointId(
  project: BrepProject,
  kind: BrepProjectObjectPointKind = 'connection',
): string {
  const points = project.projectObject?.points ?? [];
  const existing = new Set(points.map((point) => point.id));
  if (!existing.has(kind)) return kind;
  for (let index = 2; index <= points.length + 2; index += 1) {
    const candidate = `${kind}${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`Could not suggest a unique BRep ${kind} point ID.`);
}

function appendVectorParameterUsages(
  usages: string[],
  vector: BrepVector3 | undefined,
  parameterId: string,
  label: string,
): void {
  if (!vector) return;
  vector.forEach((scalar, index) => {
    if (brepScalarReferencesParameter(scalar, parameterId)) {
      usages.push(`${label}[${index}]`);
    }
  });
}

function appendProfileLoopParameterUsages(
  usages: string[],
  loop: BrepProfileLoop,
  parameterId: string,
  label: string,
): void {
  switch (loop.type) {
    case 'rectangle':
      if (brepScalarReferencesParameter(loop.width, parameterId))
        usages.push(`${label}.width`);
      if (brepScalarReferencesParameter(loop.height, parameterId))
        usages.push(`${label}.height`);
      break;
    case 'circle':
      if (brepScalarReferencesParameter(loop.radius, parameterId))
        usages.push(`${label}.radius`);
      break;
    case 'closedPolyline':
      loop.points.forEach((point, index) => {
        if (brepScalarReferencesParameter(point.u, parameterId))
          usages.push(`${label}.points[${index}].u`);
        if (brepScalarReferencesParameter(point.v, parameterId))
          usages.push(`${label}.points[${index}].v`);
      });
      break;
  }
}

function appendProfileParameterUsages(
  usages: string[],
  profile: BrepProfile,
  parameterId: string,
  nodeId: string,
): void {
  appendProfileLoopParameterUsages(
    usages,
    profile,
    parameterId,
    `${nodeId}.profile`,
  );
  profile.holes?.forEach((hole, index) => {
    const label = `${nodeId}.profile.holes[${index}]`;
    if (brepScalarReferencesParameter(hole.offsetU, parameterId))
      usages.push(`${label}.offsetU`);
    if (brepScalarReferencesParameter(hole.offsetV, parameterId))
      usages.push(`${label}.offsetV`);
    appendProfileLoopParameterUsages(
      usages,
      hole.loop,
      parameterId,
      `${label}.loop`,
    );
  });
}

export function brepProjectParameterUsages(
  project: BrepProject,
  parameterId: string,
): string[] {
  const usages: string[] = [];

  appendVectorParameterUsages(
    usages,
    project.placement.origin,
    parameterId,
    'placement.origin',
  );
  appendVectorParameterUsages(
    usages,
    project.placement.xAxis,
    parameterId,
    'placement.xAxis',
  );
  appendVectorParameterUsages(
    usages,
    project.placement.yAxis,
    parameterId,
    'placement.yAxis',
  );

  for (const point of project.projectObject?.points ?? []) {
    appendVectorParameterUsages(
      usages,
      point.position,
      parameterId,
      `projectObject.points.${point.id}.position`,
    );
    appendVectorParameterUsages(
      usages,
      point.direction,
      parameterId,
      `projectObject.points.${point.id}.direction`,
    );
  }

  for (const node of project.nodes) {
    switch (node.type) {
      case 'box':
        if (brepScalarReferencesParameter(node.width, parameterId))
          usages.push(`${node.id}.width`);
        if (brepScalarReferencesParameter(node.depth, parameterId))
          usages.push(`${node.id}.depth`);
        if (brepScalarReferencesParameter(node.height, parameterId))
          usages.push(`${node.id}.height`);
        break;
      case 'cylinder':
        if (brepScalarReferencesParameter(node.radius, parameterId))
          usages.push(`${node.id}.radius`);
        if (brepScalarReferencesParameter(node.height, parameterId))
          usages.push(`${node.id}.height`);
        break;
      case 'extrude':
        if (brepScalarReferencesParameter(node.depth, parameterId))
          usages.push(`${node.id}.depth`);
        appendProfileParameterUsages(
          usages,
          node.profile,
          parameterId,
          node.id,
        );
        break;
      case 'revolve':
        appendProfileParameterUsages(
          usages,
          node.profile,
          parameterId,
          node.id,
        );
        break;
      case 'sweep':
        if (brepScalarReferencesParameter(node.profile.radius, parameterId))
          usages.push(`${node.id}.profile.radius`);
        if (
          brepScalarReferencesParameter(node.path.firstLegLength, parameterId)
        )
          usages.push(`${node.id}.path.firstLegLength`);
        if (
          brepScalarReferencesParameter(node.path.secondLegLength, parameterId)
        )
          usages.push(`${node.id}.path.secondLegLength`);
        if (brepScalarReferencesParameter(node.path.bendRadius, parameterId))
          usages.push(`${node.id}.path.bendRadius`);
        break;
      case 'transform':
        appendVectorParameterUsages(
          usages,
          node.translate,
          parameterId,
          `${node.id}.translate`,
        );
        appendVectorParameterUsages(
          usages,
          node.rotateDeg,
          parameterId,
          `${node.id}.rotateDeg`,
        );
        break;
      case 'mirror':
        if (brepScalarReferencesParameter(node.offset, parameterId))
          usages.push(`${node.id}.offset`);
        break;
      case 'linearPattern':
        if (brepScalarReferencesParameter(node.spacing, parameterId))
          usages.push(`${node.id}.spacing`);
        break;
      case 'rectangularPattern':
        if (brepScalarReferencesParameter(node.spacingA, parameterId))
          usages.push(`${node.id}.spacingA`);
        if (brepScalarReferencesParameter(node.spacingB, parameterId))
          usages.push(`${node.id}.spacingB`);
        break;
      case 'circularPattern':
        appendVectorParameterUsages(
          usages,
          node.center,
          parameterId,
          `${node.id}.center`,
        );
        if (brepScalarReferencesParameter(node.angleStepDeg, parameterId))
          usages.push(`${node.id}.angleStepDeg`);
        break;
      case 'fillet':
        if (brepScalarReferencesParameter(node.radius, parameterId))
          usages.push(`${node.id}.radius`);
        break;
      case 'select':
        break;
      case 'subtract':
      case 'union':
      case 'intersect':
        break;
    }
  }

  return usages;
}

export type BrepProjectDefinition = {
  name: string;
  placement: BrepProjectPlacement;
  metadata?: BrepProjectMetadata;
  parameters: BrepPublishedNumberParameter[];
};

export function replaceBrepProjectDefinition(
  project: BrepProject,
  definition: BrepProjectDefinition,
): BrepProject {
  const nextProject = normalizeBrepProject({
    ...project,
    name: definition.name,
    placement: definition.placement,
    metadata: definition.metadata,
    parameters: definition.parameters,
  });
  const defaultValues = Object.fromEntries(
    nextProject.parameters.map((parameter) => [
      parameter.id,
      parameter.default,
    ]),
  );
  resolveBrepProjectPlacement(nextProject.placement, defaultValues);
  return nextProject;
}

export function replaceBrepProjectObjectDefinition(
  project: BrepProject,
  projectObject?: BrepProjectObjectDefinition,
): BrepProject {
  return normalizeBrepProject({
    ...project,
    projectObject,
  });
}

export function brepParameterUnitIsReferenced(
  project: BrepProject,
  parameterId: string,
): boolean {
  return brepProjectParameterUsages(project, parameterId).length > 0;
}

export function brepParametersByUnit(
  parameters: readonly BrepPublishedNumberParameter[],
  unit: BrepParameterUnit,
): BrepPublishedNumberParameter[] {
  return parameters.filter((parameter) => parameter.unit === unit);
}

export function replaceExistingBrepProjectNode(
  project: BrepProject,
  nodeId: string,
  nextNode: BrepNode,
): BrepProject {
  const currentNode = project.nodes.find((node) => node.id === nodeId);
  if (!currentNode) {
    throw new Error(
      `BRep node ${nodeId} does not exist in the current project.`,
    );
  }
  if (nextNode.id !== nodeId) {
    throw new Error('Existing BRep node IDs are stable and cannot be renamed.');
  }
  if (nextNode.type !== currentNode.type) {
    throw new Error('Existing BRep node types cannot be changed in place.');
  }

  return normalizeBrepProject({
    ...project,
    nodes: project.nodes.map((node) => (node.id === nodeId ? nextNode : node)),
  });
}

export function addBrepProjectNode(
  project: BrepProject,
  node: BrepNode,
): BrepProject {
  if (project.nodes.some((current) => current.id === node.id)) {
    throw new Error(`BRep node ID ${node.id} already exists.`);
  }
  return normalizeBrepProject({
    ...project,
    nodes: [...project.nodes, node],
  });
}

export function setBrepProjectResultNode(
  project: BrepProject,
  nodeId: string,
): BrepProject {
  if (!project.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`BRep result node ${nodeId} does not exist.`);
  }
  if (project.resultNodeId === nodeId) return normalizeBrepProject(project);
  return normalizeBrepProject({ ...project, resultNodeId: nodeId });
}

export function deleteBrepProjectNode(
  project: BrepProject,
  nodeId: string,
): BrepProject {
  if (!project.nodes.some((node) => node.id === nodeId)) {
    throw new Error(
      `BRep node ${nodeId} does not exist in the current project.`,
    );
  }
  const objectRoles = brepProjectObjectNodeRoles(project, nodeId);
  if (objectRoles.length > 0) {
    throw new Error(
      `BRep node ${nodeId} is assigned to the project-object ${objectRoles.join(', ')} role${objectRoles.length === 1 ? '' : 's'}. Clear the project-object role before deleting it.`,
    );
  }
  if (project.resultNodeId === nodeId) {
    throw new Error(
      `BRep node ${nodeId} is the current result. Select another result before deleting it.`,
    );
  }
  const consumers = brepNodeConsumers(project, nodeId);
  if (consumers.length > 0) {
    throw new Error(
      `BRep node ${nodeId} is still used by ${consumers.join(', ')}. Rewire those consumers before deleting it.`,
    );
  }
  if (project.nodes.length <= 1) {
    throw new Error('A BRep project must keep at least one node.');
  }

  return normalizeBrepProject({
    ...project,
    nodes: project.nodes.filter((node) => node.id !== nodeId),
  });
}
