import {
  normalizeBrepProject,
  type BrepNode,
  type BrepProject,
  type BrepPublishedNumberParameter,
} from './brepProject.ts';
import { analyzeBrepProjectIntegrity } from './brepProjectIntegrity.ts';

export type BrepProjectCollectionDiff<T> = {
  added: string[];
  removed: string[];
  changed: Array<{ id: string; paths: string[] }>;
  unchanged: number;
  previousById: Readonly<Record<string, T>>;
  nextById: Readonly<Record<string, T>>;
};

export type BrepProjectStructuralDiff = {
  projectPaths: string[];
  parameters: BrepProjectCollectionDiff<BrepPublishedNumberParameter>;
  nodes: BrepProjectCollectionDiff<BrepNode>;
  summary: string;
};

export type BrepAiCreationValidation = {
  project: BrepProject;
};

export type BrepAiFollowUpValidation = {
  project: BrepProject;
  diff: BrepProjectStructuralDiff;
};

export class BrepAiProjectError extends Error {
  constructor(
    public readonly code:
      | 'invalid_candidate'
      | 'project_id_changed'
      | 'unstable_node_identity'
      | 'graph_integrity',
    message: string,
  ) {
    super(message);
    this.name = 'BrepAiProjectError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize an AI-authored source candidate through the canonical BRep schema.
 * The AI contract is the complete BrepProject itself, never a patch or runtime
 * representation.
 */
export function normalizeBrepAiProjectCandidate(value: unknown): BrepProject {
  try {
    return normalizeBrepProject(value);
  } catch (error) {
    throw new BrepAiProjectError(
      'invalid_candidate',
      error instanceof Error
        ? `AI BRep project candidate is invalid: ${error.message}`
        : 'AI BRep project candidate is invalid.',
    );
  }
}

function assertBrepAiProjectIntegrity(project: BrepProject): void {
  const analysis = analyzeBrepProjectIntegrity(project);
  if (
    analysis.orphanNodeIds.length === 0 &&
    analysis.orphanOnlyParameterIds.length === 0 &&
    analysis.unusedParameterIds.length === 0
  ) {
    return;
  }

  const defects: string[] = [];
  if (analysis.orphanNodeIds.length > 0) {
    defects.push(`orphan nodes: ${analysis.orphanNodeIds.join(', ')}`);
  }
  if (analysis.orphanOnlyParameterIds.length > 0) {
    defects.push(
      `orphan-only parameters: ${analysis.orphanOnlyParameterIds.join(', ')}`,
    );
  }
  if (analysis.unusedParameterIds.length > 0) {
    defects.push(`unused parameters: ${analysis.unusedParameterIds.join(', ')}`);
  }

  throw new BrepAiProjectError(
    'graph_integrity',
    `AI BRep project candidate has graph-integrity defects (${defects.join('; ')}). Every feature node must contribute to resultNodeId or an explicit project-object geometry role. Every published parameter must affect authoritative geometry or intentionally control placement or semantic point data.`,
  );
}

/**
 * Validate the first AI-authored native BRep source as standalone canonical
 * creation. There is intentionally no previous project and therefore no
 * continuity diff or fabricated identity anchor on this path. M0 graph
 * integrity is enforced only at this AI boundary, not as global v1 validity.
 */
export function validateBrepAiCreation(
  candidateInput: unknown,
): BrepAiCreationValidation {
  const project = normalizeBrepAiProjectCandidate(candidateInput);
  assertBrepAiProjectIntegrity(project);
  return { project };
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (!valuesEqual(leftKeys, rightKeys)) return false;
    return leftKeys.every((key) => valuesEqual(left[key], right[key]));
  }
  return false;
}

function changedPaths(
  previous: unknown,
  next: unknown,
  prefix: string,
): string[] {
  if (valuesEqual(previous, next)) return [];

  if (isRecord(previous) && isRecord(next)) {
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort();
    return keys.flatMap((key) =>
      changedPaths(
        previous[key],
        next[key],
        prefix ? `${prefix}.${key}` : key,
      ),
    );
  }

  if (Array.isArray(previous) && Array.isArray(next)) {
    const length = Math.max(previous.length, next.length);
    const paths: string[] = [];
    for (let index = 0; index < length; index += 1) {
      paths.push(
        ...changedPaths(previous[index], next[index], `${prefix}[${index}]`),
      );
    }
    return paths;
  }

  return [prefix];
}

function indexById<T extends { id: string }>(items: readonly T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function diffCollection<T extends { id: string }>(
  previous: readonly T[],
  next: readonly T[],
  prefix: string,
): BrepProjectCollectionDiff<T> {
  const previousById = indexById(previous);
  const nextById = indexById(next);
  const previousIds = new Set(Object.keys(previousById));
  const nextIds = new Set(Object.keys(nextById));

  const added = [...nextIds].filter((id) => !previousIds.has(id)).sort();
  const removed = [...previousIds].filter((id) => !nextIds.has(id)).sort();
  const shared = [...previousIds].filter((id) => nextIds.has(id)).sort();
  const changed: Array<{ id: string; paths: string[] }> = [];
  let unchanged = 0;

  for (const id of shared) {
    const paths = changedPaths(
      previousById[id],
      nextById[id],
      `${prefix}.${id}`,
    );
    if (paths.length === 0) unchanged += 1;
    else changed.push({ id, paths });
  }

  return { added, removed, changed, unchanged, previousById, nextById };
}

function diffProjectFields(previous: BrepProject, next: BrepProject): string[] {
  const previousProjectFields = {
    schemaVersion: previous.schemaVersion,
    id: previous.id,
    name: previous.name,
    units: previous.units,
    placement: previous.placement,
    metadata: previous.metadata,
    projectObject: previous.projectObject,
    resultNodeId: previous.resultNodeId,
  };
  const nextProjectFields = {
    schemaVersion: next.schemaVersion,
    id: next.id,
    name: next.name,
    units: next.units,
    placement: next.placement,
    metadata: next.metadata,
    projectObject: next.projectObject,
    resultNodeId: next.resultNodeId,
  };
  return changedPaths(previousProjectFields, nextProjectFields, 'project');
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function buildSummary(diff: Omit<BrepProjectStructuralDiff, 'summary'>): string {
  const parts: string[] = [];
  if (diff.projectPaths.length > 0) {
    parts.push(plural(diff.projectPaths.length, 'project field'));
  }

  const parameterChanges =
    diff.parameters.added.length +
    diff.parameters.removed.length +
    diff.parameters.changed.length;
  if (parameterChanges > 0) {
    parts.push(
      `${plural(diff.parameters.added.length, 'parameter')} added, ` +
        `${plural(diff.parameters.removed.length, 'parameter')} removed, ` +
        `${plural(diff.parameters.changed.length, 'parameter')} changed`,
    );
  }

  const nodeChanges =
    diff.nodes.added.length + diff.nodes.removed.length + diff.nodes.changed.length;
  if (nodeChanges > 0) {
    parts.push(
      `${plural(diff.nodes.added.length, 'node')} added, ` +
        `${plural(diff.nodes.removed.length, 'node')} removed, ` +
        `${plural(diff.nodes.changed.length, 'node')} changed`,
    );
  }

  return parts.length > 0 ? parts.join('; ') : 'No structural BRep changes.';
}

/** Compare canonical snapshots by stable IDs, independent of source array order. */
export function diffBrepProjects(
  previousInput: unknown,
  nextInput: unknown,
): BrepProjectStructuralDiff {
  const previous = normalizeBrepAiProjectCandidate(previousInput);
  const next = normalizeBrepAiProjectCandidate(nextInput);
  const partial = {
    projectPaths: diffProjectFields(previous, next),
    parameters: diffCollection(previous.parameters, next.parameters, 'parameters'),
    nodes: diffCollection(previous.nodes, next.nodes, 'nodes'),
  };
  return { ...partial, summary: buildSummary(partial) };
}

function sharedIds<T extends { id: string }>(
  previous: readonly T[],
  next: readonly T[],
): string[] {
  const nextIds = new Set(next.map((item) => item.id));
  return previous.map((item) => item.id).filter((id) => nextIds.has(id));
}

/**
 * Validate an ordinary AI follow-up against the exact source snapshot it was
 * generated from. Standalone schema validity is insufficient because an LLM
 * can otherwise return a valid project with gratuitously replaced identities.
 * M0 integrity applies to the returned candidate only, allowing legacy/manual
 * source snapshots to remain readable while requiring the AI edit to repair
 * disconnected feature/parameter state before it can become a new revision.
 */
export function validateBrepAiFollowUp(
  previousInput: unknown,
  nextInput: unknown,
): BrepAiFollowUpValidation {
  const previous = normalizeBrepAiProjectCandidate(previousInput);
  const project = normalizeBrepAiProjectCandidate(nextInput);

  if (project.id !== previous.id) {
    throw new BrepAiProjectError(
      'project_id_changed',
      `AI BRep follow-up changed project id from ${previous.id} to ${project.id}.`,
    );
  }

  const sharedNodeIds = sharedIds(previous.nodes, project.nodes);
  if (
    previous.nodes.length >= 2 &&
    project.nodes.length >= 2 &&
    sharedNodeIds.length === 0
  ) {
    throw new BrepAiProjectError(
      'unstable_node_identity',
      'AI BRep follow-up replaced every feature node id. Ordinary edits must preserve stable node identities where features continue to exist.',
    );
  }

  assertBrepAiProjectIntegrity(project);
  return { project, diff: diffBrepProjects(previous, project) };
}
