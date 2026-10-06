import type { BrepNode, BrepProject } from './brepProject.ts';
import { brepNodeDependencies } from './brepProjectEditing.ts';

export type BrepDependencyGraphNode = {
  id: string;
  type: BrepNode['type'];
  projectIndex: number;
  depth: number;
  dependencies: string[];
  consumers: string[];
  isResult: boolean;
};

export type BrepDependencyGraphEdge = {
  source: string;
  target: string;
};

export type BrepDependencyGraph = {
  nodes: BrepDependencyGraphNode[];
  edges: BrepDependencyGraphEdge[];
  maxDepth: number;
};

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Build presentation-only dependency metadata from the canonical BrepProject.
 *
 * The canonical project remains the source of truth. This helper intentionally
 * derives graph depth, consumers and edges without persisting layout state or
 * changing project/node ordering. Although normalizeBrepProject already rejects
 * missing references and cycles, the graph model also fails closed so it is safe
 * to use at UI boundaries that may receive an unexpected stale snapshot.
 */
export function buildBrepDependencyGraph(
  project: BrepProject,
): BrepDependencyGraph {
  const nodeById = new Map(project.nodes.map((node) => [node.id, node]));
  const projectIndex = new Map(
    project.nodes.map((node, index) => [node.id, index]),
  );
  const dependenciesById = new Map<string, string[]>();
  const consumersById = new Map<string, string[]>(
    project.nodes.map((node) => [node.id, []]),
  );
  const edges: BrepDependencyGraphEdge[] = [];

  for (const node of project.nodes) {
    const dependencies = uniqueIds(brepNodeDependencies(node));
    for (const dependencyId of dependencies) {
      if (!nodeById.has(dependencyId)) {
        throw new Error(
          `Cannot visualize BRep graph: node ${node.id} references missing node ${dependencyId}.`,
        );
      }
      consumersById.get(dependencyId)!.push(node.id);
      edges.push({ source: dependencyId, target: node.id });
    }
    dependenciesById.set(node.id, dependencies);
  }

  const depthById = new Map<string, number>();
  const visiting = new Set<string>();

  const resolveDepth = (nodeId: string): number => {
    const known = depthById.get(nodeId);
    if (known != null) return known;
    if (visiting.has(nodeId)) {
      throw new Error(
        `Cannot visualize BRep graph: dependency cycle reaches node ${nodeId}.`,
      );
    }

    visiting.add(nodeId);
    const dependencies = dependenciesById.get(nodeId) ?? [];
    const depth =
      dependencies.length === 0
        ? 0
        : 1 + Math.max(...dependencies.map(resolveDepth));
    visiting.delete(nodeId);
    depthById.set(nodeId, depth);
    return depth;
  };

  const nodes = project.nodes.map((node, index) => ({
    id: node.id,
    type: node.type,
    projectIndex: index,
    depth: resolveDepth(node.id),
    dependencies: dependenciesById.get(node.id) ?? [],
    consumers: [...(consumersById.get(node.id) ?? [])].sort(
      (left, right) =>
        (projectIndex.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (projectIndex.get(right) ?? Number.MAX_SAFE_INTEGER),
    ),
    isResult: project.resultNodeId === node.id,
  }));

  return {
    nodes,
    edges,
    maxDepth: nodes.reduce((max, node) => Math.max(max, node.depth), 0),
  };
}
