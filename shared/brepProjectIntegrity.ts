import {
  normalizeBrepProject,
  type BrepNode,
  type BrepProject,
  type BrepScalar,
  type BrepVector3,
} from './brepProject.ts';
import {
  brepNodeScalarParameterReferences,
  brepScalarParameterReferences,
} from './brepScalar.ts';

export type BrepParameterEffectiveness =
  'effective' | 'semantic-only' | 'orphan-only' | 'unused';

export type BrepProjectIntegrityAnalysis = {
  resultReachableNodeIds: string[];
  roleReachableNodeIds: string[];
  authoritativeReachableNodeIds: string[];
  orphanNodeIds: string[];
  parameterClassifications: Readonly<
    Record<string, BrepParameterEffectiveness>
  >;
  effectiveParameterIds: string[];
  semanticOnlyParameterIds: string[];
  orphanOnlyParameterIds: string[];
  unusedParameterIds: string[];
};

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, 'en-US'),
  );
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

function appendScalarParameters(
  parameters: Set<string>,
  scalar: BrepScalar,
): void {
  for (const parameter of brepScalarParameterReferences(scalar)) {
    parameters.add(parameter);
  }
}

function appendVectorParameters(
  parameters: Set<string>,
  vector: BrepVector3 | undefined,
): void {
  if (!vector) return;
  for (const scalar of vector) appendScalarParameters(parameters, scalar);
}

function semanticParameterReferences(project: BrepProject): Set<string> {
  const parameters = new Set<string>();
  appendVectorParameters(parameters, project.placement.origin);
  appendVectorParameters(parameters, project.placement.xAxis);
  appendVectorParameters(parameters, project.placement.yAxis);
  for (const point of project.projectObject?.points ?? []) {
    appendVectorParameters(parameters, point.position);
    appendVectorParameters(parameters, point.direction);
  }
  return parameters;
}

function reachableNodeIds(
  project: BrepProject,
  roots: readonly string[],
): Set<string> {
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  const reachable = new Set<string>();
  const pending = [...roots];

  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || reachable.has(nodeId)) continue;
    const node = nodesById.get(nodeId);
    if (!node) continue;
    reachable.add(nodeId);
    pending.push(...nodeDependencies(node));
  }

  return reachable;
}

function parameterReferencesForNodes(
  project: BrepProject,
  nodeIds: ReadonlySet<string>,
): Set<string> {
  const parameters = new Set<string>();
  for (const node of project.nodes) {
    if (!nodeIds.has(node.id)) continue;
    if (node.type === 'select') parameters.add(node.selector.parameter);
    for (const parameterId of brepNodeScalarParameterReferences(node)) {
      parameters.add(parameterId);
    }
  }
  return parameters;
}

export function analyzeBrepProjectIntegrity(
  projectInput: unknown,
): BrepProjectIntegrityAnalysis {
  const project = normalizeBrepProject(projectInput);
  const resultReachable = reachableNodeIds(project, [project.resultNodeId]);
  const roleRoots = [
    project.projectObject?.footprintNodeId,
    project.projectObject?.clearanceEnvelopeNodeId,
    project.projectObject?.maintenanceEnvelopeNodeId,
  ].filter((nodeId): nodeId is string => Boolean(nodeId));
  const roleReachable = reachableNodeIds(project, roleRoots);
  const authoritativeReachable = new Set([
    ...resultReachable,
    ...roleReachable,
  ]);
  const orphanNodeIds = sorted(
    project.nodes
      .map((node) => node.id)
      .filter((nodeId) => !authoritativeReachable.has(nodeId)),
  );
  const orphanNodes = new Set(orphanNodeIds);

  const authoritativeParameters = parameterReferencesForNodes(
    project,
    authoritativeReachable,
  );
  const orphanParameters = parameterReferencesForNodes(project, orphanNodes);
  const semanticParameters = semanticParameterReferences(project);

  const parameterClassifications: Record<string, BrepParameterEffectiveness> =
    {};
  const effectiveParameterIds: string[] = [];
  const semanticOnlyParameterIds: string[] = [];
  const orphanOnlyParameterIds: string[] = [];
  const unusedParameterIds: string[] = [];

  for (const parameter of project.parameters) {
    let classification: BrepParameterEffectiveness;
    if (authoritativeParameters.has(parameter.id)) {
      classification = 'effective';
      effectiveParameterIds.push(parameter.id);
    } else if (orphanParameters.has(parameter.id)) {
      classification = 'orphan-only';
      orphanOnlyParameterIds.push(parameter.id);
    } else if (semanticParameters.has(parameter.id)) {
      classification = 'semantic-only';
      semanticOnlyParameterIds.push(parameter.id);
    } else {
      classification = 'unused';
      unusedParameterIds.push(parameter.id);
    }
    parameterClassifications[parameter.id] = classification;
  }

  return {
    resultReachableNodeIds: sorted(resultReachable),
    roleReachableNodeIds: sorted(roleReachable),
    authoritativeReachableNodeIds: sorted(authoritativeReachable),
    orphanNodeIds,
    parameterClassifications,
    effectiveParameterIds: sorted(effectiveParameterIds),
    semanticOnlyParameterIds: sorted(semanticOnlyParameterIds),
    orphanOnlyParameterIds: sorted(orphanOnlyParameterIds),
    unusedParameterIds: sorted(unusedParameterIds),
  };
}
