import { useMemo } from 'react';
import { Flag, GitBranch, Pencil, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { BrepProject } from '@shared/brepProject';
import {
  buildBrepDependencyGraph,
  type BrepDependencyGraph,
  type BrepDependencyGraphNode,
} from '@shared/brepProjectGraph';

const NODE_WIDTH = 148;
const NODE_HEIGHT = 66;
const COLUMN_GAP = 20;
const ROW_GAP = 54;
const GRAPH_PADDING = 16;
const MIN_GRAPH_WIDTH = 304;

type PositionedNode = BrepDependencyGraphNode & {
  x: number;
  y: number;
};

type GraphLayout = {
  width: number;
  height: number;
  nodes: PositionedNode[];
  nodeById: Map<string, PositionedNode>;
};

type ProjectObjectRole = {
  code: 'FP' | 'CL' | 'MT';
  label: string;
};

function projectObjectRoles(
  project: BrepProject,
  nodeId: string,
): ProjectObjectRole[] {
  const roles: ProjectObjectRole[] = [];
  if (project.projectObject?.footprintNodeId === nodeId) {
    roles.push({ code: 'FP', label: 'Footprint' });
  }
  if (project.projectObject?.clearanceEnvelopeNodeId === nodeId) {
    roles.push({ code: 'CL', label: 'Clearance envelope' });
  }
  if (project.projectObject?.maintenanceEnvelopeNodeId === nodeId) {
    roles.push({ code: 'MT', label: 'Maintenance envelope' });
  }
  return roles;
}

function layoutGraph(graph: BrepDependencyGraph): GraphLayout {
  const levels = new Map<number, BrepDependencyGraphNode[]>();
  for (const node of graph.nodes) {
    const level = levels.get(node.depth) ?? [];
    level.push(node);
    levels.set(node.depth, level);
  }

  const maxNodesInLevel = Math.max(
    1,
    ...[...levels.values()].map((nodes) => nodes.length),
  );
  const contentWidth =
    maxNodesInLevel * NODE_WIDTH + (maxNodesInLevel - 1) * COLUMN_GAP;
  const width = Math.max(MIN_GRAPH_WIDTH, contentWidth + GRAPH_PADDING * 2);
  const height = Math.max(
    122,
    GRAPH_PADDING * 2 +
      (graph.maxDepth + 1) * NODE_HEIGHT +
      graph.maxDepth * ROW_GAP,
  );

  const nodes: PositionedNode[] = [];
  for (let depth = 0; depth <= graph.maxDepth; depth += 1) {
    const level = levels.get(depth) ?? [];
    const levelWidth =
      level.length * NODE_WIDTH + Math.max(0, level.length - 1) * COLUMN_GAP;
    const startX = (width - levelWidth) / 2;
    level.forEach((node, index) => {
      nodes.push({
        ...node,
        x: startX + index * (NODE_WIDTH + COLUMN_GAP),
        y: GRAPH_PADDING + depth * (NODE_HEIGHT + ROW_GAP),
      });
    });
  }

  return {
    width,
    height,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  };
}

function NavigationLinks({
  label,
  ids,
  emptyLabel,
  onSelectNode,
}: {
  label: string;
  ids: string[];
  emptyLabel: string;
  onSelectNode: (nodeId: string) => void;
}) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-2 text-[10px]">
      <span className="pt-1 text-adam-neutral-500">{label}</span>
      {ids.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onSelectNode(id)}
              className="rounded-md border border-adam-neutral-700 bg-adam-neutral-900 px-1.5 py-1 font-mono text-adam-neutral-300 transition-colors hover:border-adam-blue-dark/60 hover:text-adam-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-adam-blue-dark"
            >
              {id}
            </button>
          ))}
        </div>
      ) : (
        <span className="pt-1 text-adam-neutral-500">{emptyLabel}</span>
      )}
    </div>
  );
}

export function BrepDependencyGraph({
  project,
  selectedNodeId,
  editingDisabled,
  fillAvailable = false,
  onSelectNode,
  onEditNode,
  onSetResultNode,
  onDeleteNode,
}: {
  project: BrepProject;
  selectedNodeId: string | null;
  editingDisabled: boolean;
  fillAvailable?: boolean;
  onSelectNode: (nodeId: string) => void;
  onEditNode: (nodeId: string) => void;
  onSetResultNode: (nodeId: string) => void | Promise<void>;
  onDeleteNode: (nodeId: string) => void | Promise<void>;
}) {
  const graph = useMemo(() => buildBrepDependencyGraph(project), [project]);
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedRoles = selectedNode
    ? projectObjectRoles(project, selectedNode.id)
    : [];
  const relatedIds = useMemo(
    () =>
      new Set([
        ...(selectedNode?.dependencies ?? []),
        ...(selectedNode?.consumers ?? []),
      ]),
    [selectedNode],
  );
  const deleteBlockedReason = selectedNode
    ? selectedRoles.length > 0
      ? `Clear its project-object role${selectedRoles.length === 1 ? '' : 's'} (${selectedRoles.map((role) => role.label).join(', ')}) before deleting this feature.`
      : selectedNode.isResult
        ? 'Select another result before deleting this feature.'
        : selectedNode.consumers.length > 0
          ? `Rewire ${selectedNode.consumers.join(', ')} before deleting this feature.`
          : project.nodes.length <= 1
            ? 'A BRep project must keep at least one feature.'
            : null
    : null;

  return (
    <div
      className={
        fillAvailable
          ? 'flex h-full min-h-0 flex-col gap-3'
          : 'grid gap-3'
      }
    >
      <div
        aria-label="BRep dependency graph"
        className={`${
          fillAvailable ? 'min-h-[180px] flex-1' : 'max-h-[420px]'
        } overflow-auto rounded-lg border border-adam-neutral-800 bg-adam-neutral-950/45 overscroll-contain`}
      >
        <div
          className="relative"
          style={{ width: layout.width, height: layout.height }}
        >
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
          >
            {graph.edges.map((edge) => {
              const source = layout.nodeById.get(edge.source);
              const target = layout.nodeById.get(edge.target);
              if (!source || !target) return null;

              const sourceX = source.x + NODE_WIDTH / 2;
              const sourceY = source.y + NODE_HEIGHT;
              const targetX = target.x + NODE_WIDTH / 2;
              const targetY = target.y;
              const controlOffset = Math.max(22, (targetY - sourceY) / 2);
              const active =
                selectedNodeId != null &&
                (edge.source === selectedNodeId || edge.target === selectedNodeId);
              const edgeClass = active
                ? 'text-adam-blue-light'
                : 'text-adam-neutral-700';

              return (
                <g key={`${edge.source}->${edge.target}`} className={edgeClass}>
                  <path
                    d={`M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + controlOffset}, ${targetX} ${targetY - controlOffset}, ${targetX} ${targetY}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={active ? 2 : 1.25}
                    opacity={active ? 0.95 : 0.8}
                  />
                  <path
                    d={`M ${targetX - 4} ${targetY - 7} L ${targetX} ${targetY} L ${targetX + 4} ${targetY - 7}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={active ? 2 : 1.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}
          </svg>

          {layout.nodes.map((node) => {
            const selected = node.id === selectedNodeId;
            const related = relatedIds.has(node.id);
            const roles = projectObjectRoles(project, node.id);
            const roleLabels = roles.map((role) => role.label).join(', ');
            return (
              <button
                key={node.id}
                type="button"
                aria-pressed={selected}
                aria-label={`${node.id}, ${node.type}${node.isResult ? ', result node' : ''}${roles.length > 0 ? `, project-object roles ${roleLabels}` : ''}`}
                onClick={() => onSelectNode(node.id)}
                className={`absolute flex flex-col justify-center rounded-lg border px-2.5 py-2 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue-dark ${
                  selected
                    ? 'border-adam-blue-dark bg-adam-blue-dark/15'
                    : related
                      ? 'border-adam-blue-dark/45 bg-adam-neutral-900'
                      : 'border-adam-neutral-700 bg-adam-neutral-900/95 hover:border-adam-neutral-600'
                }`}
                style={{
                  left: node.x,
                  top: node.y,
                  width: NODE_WIDTH,
                  height: NODE_HEIGHT,
                }}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-adam-neutral-500" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-adam-text-primary">
                    {node.id}
                  </span>
                  {node.isResult ? (
                    <span className="shrink-0 rounded-full border border-adam-blue-dark/60 px-1 py-0.5 text-[8px] uppercase tracking-wide text-adam-blue-light">
                      Result
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 flex items-center justify-between gap-2 text-[9px] text-adam-neutral-500">
                  <span className="uppercase tracking-wide">{node.type}</span>
                  <span>
                    in {node.dependencies.length} · out {node.consumers.length}
                  </span>
                </span>
                {roles.length > 0 ? (
                  <span
                    className="mt-0.5 truncate text-[8px] font-medium uppercase tracking-wide text-adam-blue-light"
                    title={`Project object: ${roleLabels}`}
                  >
                    Object · {roles.map((role) => role.code).join(' · ')}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {selectedNode ? (
        <div className="grid shrink-0 gap-2 rounded-lg border border-adam-neutral-800 bg-adam-neutral-900/35 p-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-[120px] flex-1 truncate font-mono text-[11px] text-adam-text-primary">
              {selectedNode.id}
            </span>
            <span className="shrink-0 text-[9px] uppercase tracking-wide text-adam-neutral-500">
              {selectedNode.type}
            </span>
            <button
              type="button"
              disabled={editingDisabled}
              onClick={() => onEditNode(selectedNode.id)}
              className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-adam-neutral-700 px-2 text-[10px] text-adam-neutral-300 transition-colors hover:border-adam-neutral-600 hover:text-adam-text-primary disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
            <button
              type="button"
              disabled={editingDisabled || selectedNode.isResult}
              onClick={() => void onSetResultNode(selectedNode.id)}
              className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-adam-neutral-700 px-2 text-[10px] text-adam-neutral-300 transition-colors hover:border-adam-blue-dark/60 hover:text-adam-text-primary disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Flag className="h-3 w-3" />
              {selectedNode.isResult ? 'Result' : 'Set result'}
            </button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  disabled={editingDisabled || Boolean(deleteBlockedReason)}
                  title={deleteBlockedReason ?? 'Delete feature'}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-adam-neutral-700 px-2 text-[10px] text-adam-neutral-300 transition-colors hover:border-destructive/70 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete feature {selectedNode.id}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This creates a new immutable BRep source revision without this
                    feature. Older revisions keep the feature and can still be
                    restored. No dependent features are deleted automatically.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => void onDeleteNode(selectedNode.id)}
                  >
                    Delete feature
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          {selectedRoles.length > 0 ? (
            <div className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-2 text-[10px]">
              <span className="pt-1 text-adam-neutral-500">Roles</span>
              <div className="flex flex-wrap gap-1">
                {selectedRoles.map((role) => (
                  <span
                    key={role.code}
                    className="rounded-md border border-adam-blue-dark/45 bg-adam-blue-dark/10 px-1.5 py-1 text-adam-blue-light"
                  >
                    {role.label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <NavigationLinks
            label="Inputs"
            ids={selectedNode.dependencies}
            emptyLabel="Primitive"
            onSelectNode={onSelectNode}
          />
          <NavigationLinks
            label="Used by"
            ids={selectedNode.consumers}
            emptyLabel={selectedNode.isResult ? 'Final result' : 'No consumers'}
            onSelectNode={onSelectNode}
          />
          {deleteBlockedReason ? (
            <p className="text-[10px] text-adam-neutral-500">
              {deleteBlockedReason}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
