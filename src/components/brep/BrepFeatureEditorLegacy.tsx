import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, GitBranch, Pencil, Plus } from 'lucide-react';
import { BrepDependencyGraph } from '@/components/brep/BrepDependencyGraph';
import {
  BREP_GRAPH_WORKSPACE_TARGET_ID,
  useBrepFeatureWorkspace,
} from '@/components/brep/BrepFeatureWorkspace';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  BREP_PROJECT_MAX_NODE_INPUTS,
  BREP_PROJECT_MAX_PATTERN_COUNT,
  BREP_PROJECT_MAX_PROFILE_POINTS,
  BREP_PROJECT_MAX_RECTANGULAR_PATTERN_INSTANCES,
  brepNodeValueKind,
  type BrepNode,
  type BrepParameterUnit,
  type BrepProfile,
  type BrepProject,
  type BrepScalar,
  type BrepVector3,
} from '@shared/brepProject';
import {
  addBrepProjectNode,
  brepNodeDependencies,
  deleteBrepProjectNode,
  setBrepProjectResultNode,
  suggestBrepNodeId,
} from '@shared/brepProjectEditing';
import { formatBrepScalar, isBrepParameterReference } from '@shared/brepScalar';

const LITERAL_VALUE = '__literal__';
const EXPRESSION_VALUE = '__expression__';
const fieldClass =
  'h-9 w-full rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 px-2 text-xs text-adam-text-primary outline-none focus:border-adam-blue-dark disabled:cursor-not-allowed disabled:opacity-60';
const NODE_TYPES: BrepNode['type'][] = [
  'box',
  'cylinder',
  'extrude',
  'revolve',
  'sweep',
  'transform',
  'mirror',
  'linearPattern',
  'rectangularPattern',
  'circularPattern',
  'subtract',
  'union',
  'intersect',
  'fillet',
  'select',
];

function cloneNode(node: BrepNode): BrepNode {
  return JSON.parse(JSON.stringify(node)) as BrepNode;
}

function nodeTypeLabel(type: BrepNode['type']): string {
  switch (type) {
    case 'box':
      return 'Box';
    case 'cylinder':
      return 'Cylinder';
    case 'extrude':
      return 'Extrude';
    case 'revolve':
      return 'Revolve';
    case 'sweep':
      return '90° circular sweep';
    case 'transform':
      return 'Transform';
    case 'mirror':
      return 'Mirror';
    case 'linearPattern':
      return 'Linear pattern';
    case 'rectangularPattern':
      return 'Rectangular pattern';
    case 'circularPattern':
      return 'Circular pattern';
    case 'subtract':
      return 'Subtract';
    case 'union':
      return 'Union';
    case 'intersect':
      return 'Intersect';
    case 'fillet':
      return 'Fillet';
    case 'select':
      return 'Binary select';
  }
}

function defaultExtrudeProfile(type: BrepProfile['type']): BrepProfile {
  switch (type) {
    case 'rectangle':
      return { type, width: 100, height: 100 };
    case 'circle':
      return { type, radius: 50 };
    case 'closedPolyline':
      return {
        type,
        points: [
          { u: -50, v: -50 },
          { u: 50, v: -50 },
          { u: 50, v: 50 },
          { u: -50, v: 50 },
        ],
      };
  }
}

function defaultRevolveProfile(): BrepProfile {
  return {
    type: 'closedPolyline',
    points: [
      { u: -30, v: 8 },
      { u: -30, v: 16 },
      { u: -18, v: 16 },
      { u: -18, v: 13 },
      { u: 18, v: 13 },
      { u: 18, v: 16 },
      { u: 30, v: 16 },
      { u: 30, v: 8 },
    ],
  };
}

function isAllowedReferenceNode(
  node: BrepNode,
  nodeId: string | undefined,
  valueKind: 'any' | 'single',
): boolean {
  return (
    node.id !== nodeId &&
    (valueKind === 'any' || brepNodeValueKind(node) === 'single')
  );
}

function preferredInputNodeId(
  project: BrepProject,
  selectedNodeId: string | null,
  valueKind: 'any' | 'single' = 'single',
): string {
  if (
    selectedNodeId &&
    project.nodes.some(
      (node) =>
        node.id === selectedNodeId &&
        isAllowedReferenceNode(node, undefined, valueKind),
    )
  ) {
    return selectedNodeId;
  }
  if (
    project.nodes.some(
      (node) =>
        node.id === project.resultNodeId &&
        isAllowedReferenceNode(node, undefined, valueKind),
    )
  ) {
    return project.resultNodeId;
  }
  const first = project.nodes.find((node) =>
    isAllowedReferenceNode(node, undefined, valueKind),
  )?.id;
  if (!first) {
    throw new Error(
      valueKind === 'single'
        ? 'This BRep feature requires an existing single-shape input.'
        : 'A BRep project must contain an existing feature.',
    );
  }
  return first;
}

function createNodeDraft(
  project: BrepProject,
  type: BrepNode['type'],
  id: string,
  selectedNodeId: string | null,
): BrepNode {
  switch (type) {
    case 'box':
      return { id, type, width: 100, depth: 100, height: 100 };
    case 'cylinder':
      return { id, type, radius: 25, height: 100 };
    case 'extrude':
      return {
        id,
        type,
        profile: defaultExtrudeProfile('rectangle'),
        axis: 'z',
        depth: 50,
      };
    case 'revolve':
      return {
        id,
        type,
        profile: defaultRevolveProfile(),
        axis: 'z',
      };
    case 'sweep':
      return {
        id,
        type,
        profile: { type: 'circle', radius: 20 },
        path: {
          type: 'planarElbow90',
          planeNormalAxis: 'z',
          firstLegLength: 1000,
          secondLegLength: 700,
          bendRadius: 150,
        },
      };
    case 'transform': {
      const input = preferredInputNodeId(project, selectedNodeId);
      return { id, type, input, translate: [0, 0, 0] };
    }
    case 'mirror': {
      const input = preferredInputNodeId(project, selectedNodeId);
      return { id, type, input, normalAxis: 'x', offset: 0 };
    }
    case 'linearPattern': {
      const input = preferredInputNodeId(project, selectedNodeId);
      return { id, type, input, axis: 'x', count: 2, spacing: 20 };
    }
    case 'rectangularPattern': {
      const input = preferredInputNodeId(project, selectedNodeId);
      return {
        id,
        type,
        input,
        axisA: 'x',
        axisB: 'y',
        countA: 2,
        countB: 2,
        spacingA: 20,
        spacingB: 20,
      };
    }
    case 'circularPattern': {
      const input = preferredInputNodeId(project, selectedNodeId);
      return {
        id,
        type,
        input,
        axis: 'z',
        center: [0, 0, 0],
        count: 6,
        angleStepDeg: 60,
      };
    }
    case 'fillet': {
      const input = preferredInputNodeId(project, selectedNodeId);
      return {
        id,
        type,
        input,
        radius: 5,
        selector: { kind: 'parallelToAxis', axis: 'z' },
      };
    }
    case 'select': {
      const off = preferredInputNodeId(project, selectedNodeId);
      const on = project.nodes.find(
        (node) => node.id !== off && brepNodeValueKind(node) === 'single',
      )?.id;
      const selector = project.parameters.find(
        (parameter) => parameter.unit === 'none',
      )?.id;
      if (!on || !selector) {
        throw new Error(
          'Binary select creation requires two single-shape features and a none-unit published parameter.',
        );
      }
      return { id, type, selector: { parameter: selector }, off, on };
    }
    case 'subtract': {
      const base = preferredInputNodeId(project, selectedNodeId);
      const tool = project.nodes.find((node) => node.id !== base)?.id;
      if (!tool) {
        throw new Error(
          'Subtract creation requires at least two existing BRep features.',
        );
      }
      return { id, type, base, tools: [tool] };
    }
    case 'union':
    case 'intersect': {
      const input = preferredInputNodeId(project, selectedNodeId);
      const secondInput = project.nodes.find(
        (node) => node.id !== input && brepNodeValueKind(node) === 'single',
      )?.id;
      if (!secondInput) {
        throw new Error(
          `${nodeTypeLabel(type)} creation requires at least two existing single-shape BRep features.`,
        );
      }
      return { id, type, inputs: [input, secondInput] };
    }
  }
}

function ScalarField({
  label,
  value,
  unit,
  project,
  disabled,
  onChange,
}: {
  label: string;
  value: BrepScalar;
  unit: BrepParameterUnit;
  project: BrepProject;
  disabled: boolean;
  onChange: (value: BrepScalar) => void;
}) {
  const compatibleParameters = useMemo(
    () => project.parameters.filter((parameter) => parameter.unit === unit),
    [project.parameters, unit],
  );
  const parameterReference =
    typeof value !== 'number' && isBrepParameterReference(value) ? value : null;
  const selected =
    typeof value === 'number'
      ? LITERAL_VALUE
      : parameterReference
        ? `parameter:${parameterReference.parameter}`
        : EXPRESSION_VALUE;
  const displayValue =
    typeof value === 'number'
      ? ''
      : parameterReference
        ? parameterReference.parameter
        : formatBrepScalar(value);

  return (
    <label className="grid gap-1.5 text-xs text-adam-neutral-300">
      <span>{label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2">
        <select
          className={fieldClass}
          value={selected}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value === EXPRESSION_VALUE) return;
            if (event.target.value === LITERAL_VALUE) {
              if (typeof value === 'number') return;
              const parameter = parameterReference
                ? project.parameters.find(
                    (candidate) =>
                      candidate.id === parameterReference.parameter,
                  )
                : undefined;
              onChange(parameter?.default ?? 0);
              return;
            }
            onChange({
              parameter: event.target.value.replace(/^parameter:/, ''),
            });
          }}
        >
          <option value={LITERAL_VALUE}>Literal value</option>
          {selected === EXPRESSION_VALUE ? (
            <option value={EXPRESSION_VALUE}>Expression · derived</option>
          ) : null}
          {compatibleParameters.map((parameter) => (
            <option key={parameter.id} value={`parameter:${parameter.id}`}>
              {parameter.label} · {parameter.id}
            </option>
          ))}
        </select>
        {typeof value === 'number' ? (
          <input
            className={fieldClass}
            type="number"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        ) : (
          <div
            className="flex h-9 min-w-0 items-center truncate rounded-lg border border-adam-neutral-800 bg-adam-neutral-950/50 px-2 font-mono text-[11px] text-adam-neutral-400"
            title={displayValue}
          >
            {displayValue}
          </div>
        )}
      </div>
    </label>
  );
}

function VectorField({
  label,
  value,
  unit,
  project,
  disabled,
  onChange,
}: {
  label: string;
  value: BrepVector3;
  unit: BrepParameterUnit;
  project: BrepProject;
  disabled: boolean;
  onChange: (value: BrepVector3) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-adam-neutral-300">{label}</div>
      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
        <ScalarField
          key={axis}
          label={axis}
          value={value[index]}
          unit={unit}
          project={project}
          disabled={disabled}
          onChange={(nextScalar) => {
            const next = [...value] as BrepVector3;
            next[index] = nextScalar;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

function NodeReferenceField({
  label,
  value,
  project,
  nodeId,
  disabled,
  valueKind = 'any',
  onChange,
}: {
  label: string;
  value: string;
  project: BrepProject;
  nodeId: string;
  disabled: boolean;
  valueKind?: 'any' | 'single';
  onChange: (value: string) => void;
}) {
  const availableNodes = project.nodes.filter((node) =>
    isAllowedReferenceNode(node, nodeId, valueKind),
  );
  return (
    <label className="grid gap-1.5 text-xs text-adam-neutral-300">
      <span>{label}</span>
      <select
        className={fieldClass}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {availableNodes.map((node) => (
          <option key={node.id} value={node.id}>
            {node.id} · {node.type}
          </option>
        ))}
      </select>
    </label>
  );
}

function OrderedNodeReferencesField({
  label,
  values,
  project,
  nodeId,
  disabled,
  onChange,
}: {
  label: string;
  values: string[];
  project: BrepProject;
  nodeId: string;
  disabled: boolean;
  onChange: (values: string[]) => void;
}) {
  const availableNodes = project.nodes.filter((node) =>
    isAllowedReferenceNode(node, nodeId, 'single'),
  );
  const addCandidate = availableNodes.find((node) => !values.includes(node.id));
  const canAdd =
    !disabled &&
    values.length < BREP_PROJECT_MAX_NODE_INPUTS &&
    Boolean(addCandidate);

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-adam-neutral-300">{label}</div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canAdd}
          className="h-7 px-2 text-[10px]"
          onClick={() => {
            if (addCandidate) onChange([...values, addCandidate.id]);
          }}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add input
        </Button>
      </div>
      <div className="space-y-2 rounded-lg border border-adam-neutral-800 bg-adam-neutral-950/40 p-2">
        {values.map((value, index) => (
          <div
            key={`${value}:${index}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"
          >
            <label className="grid gap-1 text-[10px] text-adam-neutral-500">
              <span>Input {index + 1}</span>
              <select
                className={fieldClass}
                value={value}
                disabled={disabled}
                onChange={(event) => {
                  const next = [...values];
                  next[index] = event.target.value;
                  onChange(next);
                }}
              >
                {availableNodes
                  .filter(
                    (candidate) =>
                      candidate.id === value || !values.includes(candidate.id),
                  )
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.id} · {candidate.type}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex items-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Move Boolean input ${index + 1} up`}
                disabled={disabled || index === 0}
                className="h-9 px-2 text-[10px]"
                onClick={() => {
                  const next = [...values];
                  [next[index - 1], next[index]] = [
                    next[index],
                    next[index - 1],
                  ];
                  onChange(next);
                }}
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Move Boolean input ${index + 1} down`}
                disabled={disabled || index === values.length - 1}
                className="h-9 px-2 text-[10px]"
                onClick={() => {
                  const next = [...values];
                  [next[index], next[index + 1]] = [
                    next[index + 1],
                    next[index],
                  ];
                  onChange(next);
                }}
              >
                ↓
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove Boolean input ${index + 1}`}
                disabled={disabled || values.length <= 2}
                className="h-9 px-2 text-[10px]"
                onClick={() =>
                  onChange(values.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] leading-4 text-adam-neutral-500">
        Inputs are ordered, unique and single-shape. Boolean evaluation must
        resolve to exactly one solid body.
      </p>
    </div>
  );
}

function ExtrudeProfileFields({
  profile,
  project,
  disabled,
  onChange,
}: {
  profile: BrepProfile;
  project: BrepProject;
  disabled: boolean;
  onChange: (profile: BrepProfile) => void;
}) {
  const profileType = profile.type;
  return (
    <div className="grid gap-4 rounded-lg border border-adam-neutral-800 bg-adam-neutral-950/30 p-3">
      <label className="grid gap-1.5 text-xs text-adam-neutral-300">
        <span>Profile type</span>
        <select
          className={fieldClass}
          value={profileType}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              defaultExtrudeProfile(event.target.value as BrepProfile['type']),
            )
          }
        >
          <option value="rectangle">Rectangle</option>
          <option value="circle">Circle</option>
          <option value="closedPolyline">Closed polyline</option>
        </select>
      </label>

      {profile.type === 'rectangle' ? (
        <>
          <ScalarField
            label="Profile width"
            value={profile.width}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(width) => onChange({ ...profile, width })}
          />
          <ScalarField
            label="Profile height"
            value={profile.height}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(height) => onChange({ ...profile, height })}
          />
        </>
      ) : profile.type === 'circle' ? (
        <ScalarField
          label="Profile radius"
          value={profile.radius}
          unit="mm"
          project={project}
          disabled={disabled}
          onChange={(radius) => onChange({ ...profile, radius })}
        />
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-adam-neutral-300">
              Closed polyline points · {profile.points.length}/
              {BREP_PROJECT_MAX_PROFILE_POINTS}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={
                disabled ||
                profile.points.length >= BREP_PROJECT_MAX_PROFILE_POINTS
              }
              className="h-7 px-2 text-[10px]"
              onClick={() => {
                const last = profile.points.at(-1);
                const offset = 25 * (profile.points.length + 1);
                const nextPoint = {
                  u: typeof last?.u === 'number' ? last.u + 25 : offset,
                  v: typeof last?.v === 'number' ? last.v + 25 : offset,
                };
                onChange({
                  ...profile,
                  points: [...profile.points, nextPoint],
                });
              }}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add point
            </Button>
          </div>
          <div className="grid gap-3">
            {profile.points.map((point, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-lg border border-adam-neutral-800 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-adam-neutral-500">
                    Point {index + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || profile.points.length <= 3}
                    className="h-7 px-2 text-[10px]"
                    onClick={() =>
                      onChange({
                        ...profile,
                        points: profile.points.filter(
                          (_, pointIndex) => pointIndex !== index,
                        ),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ScalarField
                    label="U"
                    value={point.u}
                    unit="mm"
                    project={project}
                    disabled={disabled}
                    onChange={(u) => {
                      const points = profile.points.map(
                        (candidate, pointIndex) =>
                          pointIndex === index
                            ? { ...candidate, u }
                            : candidate,
                      );
                      onChange({ ...profile, points });
                    }}
                  />
                  <ScalarField
                    label="V"
                    value={point.v}
                    unit="mm"
                    project={project}
                    disabled={disabled}
                    onChange={(v) => {
                      const points = profile.points.map(
                        (candidate, pointIndex) =>
                          pointIndex === index
                            ? { ...candidate, v }
                            : candidate,
                      );
                      onChange({ ...profile, points });
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] leading-4 text-adam-neutral-500">
            Points are ordered in the canonical local U/V plane and close
            implicitly from the final point to the first. Save rejects duplicate
            edges, zero area and self-intersection.
          </p>
        </div>
      )}
    </div>
  );
}

function NodeEditorFields({
  node,
  project,
  disabled,
  onChange,
}: {
  node: BrepNode;
  project: BrepProject;
  disabled: boolean;
  onChange: (node: BrepNode) => void;
}) {
  switch (node.type) {
    case 'box':
      return (
        <div className="grid gap-4">
          <ScalarField
            label="Width"
            value={node.width}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(width) => onChange({ ...node, width })}
          />
          <ScalarField
            label="Depth"
            value={node.depth}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(depth) => onChange({ ...node, depth })}
          />
          <ScalarField
            label="Height"
            value={node.height}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(height) => onChange({ ...node, height })}
          />
        </div>
      );

    case 'cylinder':
      return (
        <div className="grid gap-4">
          <ScalarField
            label="Radius"
            value={node.radius}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(radius) => onChange({ ...node, radius })}
          />
          <ScalarField
            label="Height"
            value={node.height}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(height) => onChange({ ...node, height })}
          />
        </div>
      );

    case 'extrude':
      return (
        <div className="grid gap-4">
          <ExtrudeProfileFields
            profile={node.profile}
            project={project}
            disabled={disabled}
            onChange={(profile) => onChange({ ...node, profile })}
          />
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Extrusion axis</span>
            <select
              className={fieldClass}
              value={node.axis}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  axis: event.target.value as 'x' | 'y' | 'z',
                })
              }
            >
              <option value="x">X axis · U=Y, V=Z</option>
              <option value="y">Y axis · U=Z, V=X</option>
              <option value="z">Z axis · U=X, V=Y</option>
            </select>
          </label>
          <ScalarField
            label="Extrusion depth"
            value={node.depth}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(depth) => onChange({ ...node, depth })}
          />
          <p className="text-[10px] leading-4 text-adam-neutral-500">
            The profile is centered on the canonical local plane. Extrusion is
            symmetric from -depth / 2 to +depth / 2 along the selected axis and
            always produces one single-shape result.
          </p>
        </div>
      );

    case 'revolve':
      return (
        <div className="grid gap-4">
          <ExtrudeProfileFields
            profile={node.profile}
            project={project}
            disabled={disabled}
            onChange={(profile) => onChange({ ...node, profile })}
          />
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Revolve axis</span>
            <select
              className={fieldClass}
              value={node.axis}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  axis: event.target.value as 'x' | 'y' | 'z',
                })
              }
            >
              <option value="x">X axis · U=X axial, V=Y radial</option>
              <option value="y">Y axis · U=Y axial, V=Z radial</option>
              <option value="z">Z axis · U=Z axial, V=X radial</option>
            </select>
          </label>
          <p className="text-[10px] leading-4 text-adam-neutral-500">
            Revolve is a full 360° single-solid operation around the selected
            canonical axis through the local origin. For the bounded first
            slice, use a closed polyline: U is axial and V is non-negative
            radial distance. Profiles may touch V=0 only along a real boundary
            segment; centered rectangle/circle profiles cross the axis and are
            rejected by canonical validation.
          </p>
        </div>
      );

    case 'sweep':
      return (
        <div className="grid gap-4">
          <ScalarField
            label="Circular profile radius"
            value={node.profile.radius}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(radius) =>
              onChange({ ...node, profile: { ...node.profile, radius } })
            }
          />
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Path plane normal axis</span>
            <select
              className={fieldClass}
              value={node.path.planeNormalAxis}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  path: {
                    ...node.path,
                    planeNormalAxis: event.target.value as 'x' | 'y' | 'z',
                  },
                })
              }
            >
              <option value="x">X normal · U=Y, V=Z</option>
              <option value="y">Y normal · U=Z, V=X</option>
              <option value="z">Z normal · U=X, V=Y</option>
            </select>
          </label>
          <ScalarField
            label="First straight leg length"
            value={node.path.firstLegLength}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(firstLegLength) =>
              onChange({ ...node, path: { ...node.path, firstLegLength } })
            }
          />
          <ScalarField
            label="Second straight leg length"
            value={node.path.secondLegLength}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(secondLegLength) =>
              onChange({ ...node, path: { ...node.path, secondLegLength } })
            }
          />
          <ScalarField
            label="Bend centerline radius"
            value={node.path.bendRadius}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(bendRadius) =>
              onChange({ ...node, path: { ...node.path, bendRadius } })
            }
          />
          <p className="text-[10px] leading-4 text-adam-neutral-500">
            Bounded sweep: one constant circular section follows a straight leg,
            one tangent +90° centerline bend, then a second straight leg.
            Profile radius must remain smaller than bend radius. No arbitrary
            paths or twist controls are supported.
          </p>
        </div>
      );

    case 'transform':
      return (
        <div className="grid gap-5">
          <NodeReferenceField
            label="Input node"
            value={node.input}
            project={project}
            nodeId={node.id}
            disabled={disabled}
            valueKind="single"
            onChange={(input) => onChange({ ...node, input })}
          />

          <label className="flex items-center gap-2 text-xs text-adam-neutral-300">
            <input
              type="checkbox"
              checked={Boolean(node.translate)}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  translate: event.target.checked
                    ? (node.translate ?? [0, 0, 0])
                    : undefined,
                })
              }
            />
            Translate
          </label>
          {node.translate ? (
            <VectorField
              label="Translation"
              value={node.translate}
              unit="mm"
              project={project}
              disabled={disabled}
              onChange={(translate) => onChange({ ...node, translate })}
            />
          ) : null}

          <label className="flex items-center gap-2 text-xs text-adam-neutral-300">
            <input
              type="checkbox"
              checked={Boolean(node.rotateDeg)}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  rotateDeg: event.target.checked
                    ? (node.rotateDeg ?? [0, 0, 0])
                    : undefined,
                })
              }
            />
            Rotate
          </label>
          {node.rotateDeg ? (
            <VectorField
              label="Rotation"
              value={node.rotateDeg}
              unit="deg"
              project={project}
              disabled={disabled}
              onChange={(rotateDeg) => onChange({ ...node, rotateDeg })}
            />
          ) : null}
        </div>
      );

    case 'mirror':
      return (
        <div className="grid gap-4">
          <NodeReferenceField
            label="Input node"
            value={node.input}
            project={project}
            nodeId={node.id}
            disabled={disabled}
            valueKind="single"
            onChange={(input) => onChange({ ...node, input })}
          />
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Mirror plane normal axis</span>
            <select
              className={fieldClass}
              value={node.normalAxis}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  normalAxis: event.target.value as 'x' | 'y' | 'z',
                })
              }
            >
              <option value="x">X · YZ plane</option>
              <option value="y">Y · XZ plane</option>
              <option value="z">Z · XY plane</option>
            </select>
          </label>
          <ScalarField
            label="Plane offset"
            value={node.offset}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(offset) => onChange({ ...node, offset })}
          />
          <p className="text-[10px] leading-4 text-adam-neutral-500">
            Mirror returns only the reflected input. It does not keep the
            original or create a multi-instance result.
          </p>
        </div>
      );

    case 'linearPattern':
      return (
        <div className="grid gap-4">
          <NodeReferenceField
            label="Input node"
            value={node.input}
            project={project}
            nodeId={node.id}
            disabled={disabled}
            valueKind="single"
            onChange={(input) => onChange({ ...node, input })}
          />
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Pattern axis</span>
            <select
              className={fieldClass}
              value={node.axis}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  axis: event.target.value as 'x' | 'y' | 'z',
                })
              }
            >
              <option value="x">X axis</option>
              <option value="y">Y axis</option>
              <option value="z">Z axis</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Instance count</span>
            <input
              className={fieldClass}
              type="number"
              min={2}
              max={BREP_PROJECT_MAX_PATTERN_COUNT}
              step={1}
              value={node.count}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...node, count: Number(event.target.value) })
              }
            />
          </label>
          <ScalarField
            label="Center-to-center spacing"
            value={node.spacing}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(spacing) => onChange({ ...node, spacing })}
          />
          <p className="text-[10px] leading-4 text-adam-neutral-500">
            Instance 0 keeps the input location. Later instances move by index ×
            spacing along the selected axis. Spacing must resolve to a non-zero
            value. The pattern remains separate ordered bodies unless used as a
            subtract tool.
          </p>
        </div>
      );

    case 'rectangularPattern':
      return (
        <div className="grid gap-4">
          <NodeReferenceField
            label="Input node"
            value={node.input}
            project={project}
            nodeId={node.id}
            disabled={disabled}
            valueKind="single"
            onChange={(input) => onChange({ ...node, input })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs text-adam-neutral-300">
              <span>Pattern axis A</span>
              <select
                className={fieldClass}
                value={node.axisA}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...node,
                    axisA: event.target.value as 'x' | 'y' | 'z',
                  })
                }
              >
                <option value="x">X axis</option>
                <option value="y">Y axis</option>
                <option value="z">Z axis</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-xs text-adam-neutral-300">
              <span>Pattern axis B</span>
              <select
                className={fieldClass}
                value={node.axisB}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...node,
                    axisB: event.target.value as 'x' | 'y' | 'z',
                  })
                }
              >
                <option value="x">X axis</option>
                <option value="y">Y axis</option>
                <option value="z">Z axis</option>
              </select>
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs text-adam-neutral-300">
              <span>Count A</span>
              <input
                className={fieldClass}
                type="number"
                min={2}
                max={BREP_PROJECT_MAX_PATTERN_COUNT}
                step={1}
                value={node.countA}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...node, countA: Number(event.target.value) })
                }
              />
            </label>
            <label className="grid gap-1.5 text-xs text-adam-neutral-300">
              <span>Count B</span>
              <input
                className={fieldClass}
                type="number"
                min={2}
                max={BREP_PROJECT_MAX_PATTERN_COUNT}
                step={1}
                value={node.countB}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...node, countB: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <ScalarField
            label="Spacing A"
            value={node.spacingA}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(spacingA) => onChange({ ...node, spacingA })}
          />
          <ScalarField
            label="Spacing B"
            value={node.spacingB}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(spacingB) => onChange({ ...node, spacingB })}
          />
          <p className="text-[10px] leading-4 text-adam-neutral-500">
            Axes A and B must be different. Both counts are literal integers
            from 2 to {BREP_PROJECT_MAX_PATTERN_COUNT}, with at most{' '}
            {BREP_PROJECT_MAX_RECTANGULAR_PATTERN_INSTANCES} total instances.
            Both spacings must resolve to non-zero values. Instances are ordered
            row-major with A outer, B inner and index = a × countB + b.
          </p>
        </div>
      );

    case 'circularPattern':
      return (
        <div className="grid gap-4">
          <NodeReferenceField
            label="Input node"
            value={node.input}
            project={project}
            nodeId={node.id}
            disabled={disabled}
            valueKind="single"
            onChange={(input) => onChange({ ...node, input })}
          />
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Pattern axis</span>
            <select
              className={fieldClass}
              value={node.axis}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  axis: event.target.value as 'x' | 'y' | 'z',
                })
              }
            >
              <option value="x">X axis</option>
              <option value="y">Y axis</option>
              <option value="z">Z axis</option>
            </select>
          </label>
          <VectorField
            label="Pattern center"
            value={node.center}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(center) => onChange({ ...node, center })}
          />
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Instance count</span>
            <input
              className={fieldClass}
              type="number"
              min={2}
              max={BREP_PROJECT_MAX_PATTERN_COUNT}
              step={1}
              value={node.count}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...node, count: Number(event.target.value) })
              }
            />
          </label>
          <ScalarField
            label="Angle step"
            value={node.angleStepDeg}
            unit="deg"
            project={project}
            disabled={disabled}
            onChange={(angleStepDeg) => onChange({ ...node, angleStepDeg })}
          />
          <p className="text-[10px] leading-4 text-adam-neutral-500">
            Instance 0 is the unchanged input. Later instances apply one rigid
            right-hand rotation by index × angle step around the selected
            canonical axis through the pattern center. Angle step must resolve
            non-zero and absolute angle step × count must not exceed 360°.
            Instances remain separate ordered bodies unless consumed as subtract
            tools.
          </p>
        </div>
      );

    case 'subtract':
      return (
        <div className="grid gap-5">
          <NodeReferenceField
            label="Base node"
            value={node.base}
            project={project}
            nodeId={node.id}
            disabled={disabled}
            valueKind="single"
            onChange={(base) => onChange({ ...node, base })}
          />
          <div className="grid gap-2">
            <div className="text-xs text-adam-neutral-300">Tool nodes</div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-adam-neutral-800 bg-adam-neutral-950/40 p-2">
              {project.nodes
                .filter((candidate) => candidate.id !== node.id)
                .map((candidate) => {
                  const checked = node.tools.includes(candidate.id);
                  return (
                    <label
                      key={candidate.id}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-adam-neutral-300 hover:bg-adam-neutral-900"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={(event) => {
                          const tools = event.target.checked
                            ? [...node.tools, candidate.id]
                            : node.tools.filter((id) => id !== candidate.id);
                          onChange({ ...node, tools });
                        }}
                      />
                      <span className="font-mono">{candidate.id}</span>
                      <span className="text-adam-neutral-500">
                        {candidate.type}
                        {brepNodeValueKind(candidate) === 'instanceSet'
                          ? ' · instance set'
                          : ''}
                      </span>
                    </label>
                  );
                })}
            </div>
            <p className="text-[10px] leading-4 text-adam-neutral-500">
              The base must be a single shape. Tool entries may be single shapes
              or a pattern instance set; pattern instances are applied in
              canonical index order.
            </p>
          </div>
        </div>
      );

    case 'union':
    case 'intersect':
      return (
        <OrderedNodeReferencesField
          label={`${nodeTypeLabel(node.type)} input nodes`}
          values={node.inputs}
          project={project}
          nodeId={node.id}
          disabled={disabled}
          onChange={(inputs) => onChange({ ...node, inputs })}
        />
      );

    case 'fillet':
      return (
        <div className="grid gap-4">
          <NodeReferenceField
            label="Input node"
            value={node.input}
            project={project}
            nodeId={node.id}
            disabled={disabled}
            valueKind="single"
            onChange={(input) => onChange({ ...node, input })}
          />
          <ScalarField
            label="Radius"
            value={node.radius}
            unit="mm"
            project={project}
            disabled={disabled}
            onChange={(radius) => onChange({ ...node, radius })}
          />
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Parallel edge axis</span>
            <select
              className={fieldClass}
              value={node.selector.axis}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  selector: {
                    kind: 'parallelToAxis',
                    axis: event.target.value as 'x' | 'y' | 'z',
                  },
                })
              }
            >
              <option value="x">X axis</option>
              <option value="y">Y axis</option>
              <option value="z">Z axis</option>
            </select>
          </label>
        </div>
      );
  }
}

export function BrepFeatureEditor({
  project,
  disabled,
  saving,
  onSaveNode,
  onSaveProject,
}: {
  project: BrepProject;
  disabled: boolean;
  saving: boolean;
  onSaveNode: (node: BrepNode) => Promise<void>;
  onSaveProject: (project: BrepProject) => Promise<void>;
}) {
  const { view, setView } = useBrepFeatureWorkspace();
  const [open, setOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<BrepNode | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<BrepNode | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [structuralError, setStructuralError] = useState<string | null>(null);
  const [graphTarget, setGraphTarget] = useState<HTMLElement | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    project.resultNodeId || project.nodes[0]?.id || null,
  );
  const singleNodeCount = project.nodes.filter(
    (node) => brepNodeValueKind(node) === 'single',
  ).length;

  useEffect(() => {
    if (
      selectedNodeId &&
      project.nodes.some((node) => node.id === selectedNodeId)
    ) {
      return;
    }
    setSelectedNodeId(project.resultNodeId || project.nodes[0]?.id || null);
  }, [project.nodes, project.resultNodeId, selectedNodeId]);

  useEffect(() => {
    if (view !== 'graph') {
      setGraphTarget(null);
      return;
    }

    let frame = 0;
    const resolveTarget = () => {
      const target = document.getElementById(BREP_GRAPH_WORKSPACE_TARGET_ID);
      if (target) {
        setGraphTarget(target);
        return;
      }
      frame = window.requestAnimationFrame(resolveTarget);
    };
    resolveTarget();
    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  const editNode = (node: BrepNode) => {
    setSelectedNodeId(node.id);
    if (disabled || saving) return;
    setDraft(cloneNode(node));
    setLocalError(null);
    setDialogOpen(true);
  };

  const editNodeById = (nodeId: string) => {
    const node = project.nodes.find((candidate) => candidate.id === nodeId);
    if (node) editNode(node);
  };

  const save = async () => {
    if (!draft || saving) return;
    setLocalError(null);
    try {
      await onSaveNode(draft);
      setSelectedNodeId(draft.id);
      setDialogOpen(false);
      setDraft(null);
    } catch (reason) {
      setLocalError(
        reason instanceof Error
          ? reason.message
          : 'Could not save the BRep feature revision.',
      );
    }
  };

  const openCreateDialog = () => {
    if (disabled || saving) return;
    try {
      const type: BrepNode['type'] = 'box';
      const id = suggestBrepNodeId(project, type);
      setCreateDraft(createNodeDraft(project, type, id, selectedNodeId));
      setCreateError(null);
      setCreateDialogOpen(true);
    } catch (reason) {
      setStructuralError(
        reason instanceof Error
          ? reason.message
          : 'Could not create a feature draft.',
      );
    }
  };

  const changeCreateType = (type: BrepNode['type']) => {
    if (!createDraft) return;
    try {
      setCreateDraft(
        createNodeDraft(project, type, createDraft.id, selectedNodeId),
      );
      setCreateError(null);
    } catch (reason) {
      setCreateError(
        reason instanceof Error
          ? reason.message
          : 'Could not change feature type.',
      );
    }
  };

  const createFeature = async () => {
    if (!createDraft || saving) return;
    setCreateError(null);
    try {
      const nextProject = addBrepProjectNode(project, createDraft);
      await onSaveProject(nextProject);
      setSelectedNodeId(createDraft.id);
      setCreateDialogOpen(false);
      setCreateDraft(null);
    } catch (reason) {
      setCreateError(
        reason instanceof Error
          ? reason.message
          : 'Could not save the new BRep feature.',
      );
    }
  };

  const setResultNode = async (nodeId: string) => {
    if (disabled || saving) return;
    setStructuralError(null);
    try {
      await onSaveProject(setBrepProjectResultNode(project, nodeId));
      setSelectedNodeId(nodeId);
    } catch (reason) {
      setStructuralError(
        reason instanceof Error
          ? reason.message
          : 'Could not change the BRep result node.',
      );
    }
  };

  const deleteNode = async (nodeId: string) => {
    if (disabled || saving) return;
    setStructuralError(null);
    try {
      await onSaveProject(deleteBrepProjectNode(project, nodeId));
    } catch (reason) {
      setStructuralError(
        reason instanceof Error
          ? reason.message
          : 'Could not delete the BRep feature.',
      );
    }
  };

  const graph = (
    <BrepDependencyGraph
      project={project}
      selectedNodeId={selectedNodeId}
      editingDisabled={disabled || saving}
      fillAvailable
      onSelectNode={setSelectedNodeId}
      onEditNode={editNodeById}
      onSetResultNode={setResultNode}
      onDeleteNode={deleteNode}
    />
  );

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger
            aria-label={`${open ? 'Collapse' : 'Expand'} BRep features`}
            className="group flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md py-1 text-xs font-semibold text-adam-text-primary transition-colors focus:outline-none"
          >
            <span className="flex items-center gap-2">
              Features
              <span className="text-[10px] text-adam-neutral-400">
                {project.nodes.length}
              </span>
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-adam-neutral-400 transition-all duration-200 group-hover:text-adam-text-primary ${open ? 'rotate-180' : ''}`}
            />
          </CollapsibleTrigger>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setView('graph')}
            aria-label="Open BRep dependency graph"
            className="h-7 shrink-0 px-2 text-[10px]"
          >
            <GitBranch className="mr-1 h-3 w-3" />
            Graph
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || saving}
            onClick={openCreateDialog}
            aria-label="Add BRep feature"
            className="h-7 shrink-0 px-2 text-[10px]"
          >
            <Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>
        <CollapsibleContent>
          <div className="mt-3 rounded-lg border border-adam-neutral-800 bg-adam-neutral-900/30 p-2.5">
            <button
              type="button"
              onClick={() => setView('graph')}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs text-adam-neutral-300 transition-colors hover:bg-adam-neutral-800 hover:text-adam-text-primary"
            >
              <span className="flex min-w-0 items-center gap-2">
                <GitBranch className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Dependency graph</span>
              </span>
              <span className="shrink-0 text-[10px] text-adam-neutral-500">
                {view === 'graph' ? 'Open' : 'Show'}
              </span>
            </button>
            <p className="mt-1 px-2 text-[10px] leading-4 text-adam-neutral-500">
              Graph opens beside Chat in the main workspace so feature topology
              is not constrained by the Parameters panel width.
            </p>
          </div>

          {structuralError ? (
            <div className="mt-3 rounded-lg border border-destructive p-2.5 text-xs text-destructive">
              {structuralError}
            </div>
          ) : null}

          <div className="mt-3 space-y-1.5 border-t border-adam-neutral-800 pt-3">
            {project.nodes.map((node, index) => {
              const dependencies = brepNodeDependencies(node);
              const isResult = project.resultNodeId === node.id;
              const selected = selectedNodeId === node.id;
              return (
                <button
                  key={node.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => editNode(node)}
                  className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-adam-blue-dark ${
                    selected
                      ? 'border-adam-blue-dark/70 bg-adam-blue-dark/10'
                      : 'border-adam-neutral-800 bg-adam-neutral-900/40 hover:border-adam-neutral-700 hover:bg-adam-neutral-900'
                  } ${disabled || saving ? 'cursor-default' : ''}`}
                >
                  <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-adam-neutral-500" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-xs text-adam-text-primary">
                        {node.id}
                      </span>
                      <span className="shrink-0 rounded-full border border-adam-neutral-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-adam-neutral-400">
                        {node.type}
                      </span>
                      {brepNodeValueKind(node) === 'instanceSet' ? (
                        <span className="shrink-0 rounded-full border border-adam-neutral-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-adam-neutral-400">
                          Instance set
                        </span>
                      ) : null}
                      {isResult ? (
                        <span className="text-adam-blue-light shrink-0 rounded-full border border-adam-blue-dark/60 bg-adam-blue-dark/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide">
                          Result
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-adam-neutral-500">
                      {dependencies.length > 0
                        ? `Depends on ${dependencies.join(', ')}`
                        : `${node.type === 'extrude' ? 'Profile extrusion' : node.type === 'revolve' ? 'Full profile revolve' : node.type === 'sweep' ? 'Planar 90° circular sweep' : 'Primitive'} · node ${index + 1}`}
                    </span>
                  </span>
                  <Pencil
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                      disabled || saving
                        ? 'text-adam-neutral-700'
                        : 'text-adam-neutral-500'
                    }`}
                  />
                </button>
              );
            })}
          </div>
          {disabled ? (
            <p className="mt-2 text-[10px] text-adam-neutral-500">
              Dependency navigation remains available. Save or discard competing
              edits before changing project structure.
            </p>
          ) : null}
        </CollapsibleContent>
      </Collapsible>

      {view === 'graph' && graphTarget
        ? createPortal(graph, graphTarget)
        : null}

      <Dialog
        open={createDialogOpen}
        onOpenChange={(nextOpen) => {
          if (saving) return;
          setCreateDialogOpen(nextOpen);
          if (!nextOpen) {
            setCreateDraft(null);
            setCreateError(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-4 overflow-hidden bg-adam-bg-secondary-dark p-4 sm:p-6">
          {createDraft ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-adam-text-primary">
                  <Plus className="h-4 w-4" />
                  Add BRep feature
                </DialogTitle>
                <DialogDescription className="text-adam-neutral-400">
                  Choose a stable ID and feature type. Save validates the
                  complete canonical project and creates one immutable source
                  revision. The current result node is preserved until you
                  explicitly change it.
                </DialogDescription>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="mb-5 grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs text-adam-neutral-300">
                    <span>Stable node ID</span>
                    <input
                      className={fieldClass}
                      value={createDraft.id}
                      disabled={saving}
                      onChange={(event) =>
                        setCreateDraft({
                          ...createDraft,
                          id: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs text-adam-neutral-300">
                    <span>Feature type</span>
                    <select
                      className={fieldClass}
                      value={createDraft.type}
                      disabled={saving}
                      onChange={(event) =>
                        changeCreateType(event.target.value as BrepNode['type'])
                      }
                    >
                      {NODE_TYPES.map((type) => (
                        <option
                          key={type}
                          value={type}
                          disabled={
                            ((type === 'linearPattern' ||
                              type === 'rectangularPattern' ||
                              type === 'circularPattern') &&
                              singleNodeCount < 1) ||
                            (type === 'subtract' && project.nodes.length < 2) ||
                            ((type === 'union' || type === 'intersect') &&
                              singleNodeCount < 2)
                          }
                        >
                          {nodeTypeLabel(type)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <NodeEditorFields
                  node={createDraft}
                  project={project}
                  disabled={saving}
                  onChange={setCreateDraft}
                />

                {createError ? (
                  <div className="mt-4 rounded-lg border border-destructive p-3 text-sm text-destructive">
                    {createError}
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 justify-end gap-2 border-t border-adam-neutral-800 pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setCreateDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={saving}
                  onClick={() => void createFeature()}
                >
                  {saving ? 'Saving feature…' : 'Create feature revision'}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          if (saving) return;
          setDialogOpen(nextOpen);
          if (!nextOpen) {
            setDraft(null);
            setLocalError(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-4 overflow-hidden bg-adam-bg-secondary-dark p-4 sm:p-6">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex min-w-0 items-center gap-2 text-adam-text-primary">
                  <GitBranch className="h-4 w-4 shrink-0" />
                  <span className="truncate font-mono text-sm sm:text-base">
                    {draft.id}
                  </span>
                  <span className="shrink-0 rounded-full border border-adam-neutral-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-adam-neutral-400">
                    {nodeTypeLabel(draft.type)}
                  </span>
                </DialogTitle>
                <DialogDescription className="text-adam-neutral-400">
                  Edit this existing canonical feature. Node ID and type stay
                  stable. Dependency fields rewire the canonical DAG; Save
                  validates the complete project and creates a new immutable
                  source revision.
                </DialogDescription>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <NodeEditorFields
                  node={draft}
                  project={project}
                  disabled={saving}
                  onChange={setDraft}
                />
                {localError ? (
                  <div className="mt-4 rounded-lg border border-destructive p-3 text-sm text-destructive">
                    {localError}
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 justify-end gap-2 border-t border-adam-neutral-800 pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {saving
                    ? 'Saving feature revision…'
                    : 'Save feature revision'}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
