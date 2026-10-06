import { useMemo, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
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
  BREP_PROJECT_MAX_PROFILE_HOLES,
  BREP_PROJECT_MAX_PROFILE_POINTS,
  type BrepNode,
  type BrepProfileHole,
  type BrepProfileLoop,
  type BrepProject,
  type BrepScalar,
} from '@shared/brepProject';
import {
  formatBrepScalar,
  isBrepParameterReference,
} from '@shared/brepScalar';

const LITERAL_VALUE = '__literal__';
const EXPRESSION_VALUE = '__expression__';
const fieldClass =
  'h-9 w-full rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 px-2 text-xs text-adam-text-primary outline-none focus:border-adam-blue-dark disabled:cursor-not-allowed disabled:opacity-60';

type BrepExtrudeNode = Extract<BrepNode, { type: 'extrude' }>;

function cloneExtrude(node: BrepExtrudeNode): BrepExtrudeNode {
  return JSON.parse(JSON.stringify(node)) as BrepExtrudeNode;
}

function defaultLoop(type: BrepProfileLoop['type']): BrepProfileLoop {
  switch (type) {
    case 'rectangle':
      return { type, width: 20, height: 20 };
    case 'circle':
      return { type, radius: 5 };
    case 'closedPolyline':
      return {
        type,
        points: [
          { u: -5, v: -5 },
          { u: 5, v: -5 },
          { u: 5, v: 5 },
          { u: -5, v: 5 },
        ],
      };
  }
}

function ScalarField({
  label,
  value,
  project,
  disabled,
  onChange,
}: {
  label: string;
  value: BrepScalar;
  project: BrepProject;
  disabled: boolean;
  onChange: (value: BrepScalar) => void;
}) {
  const compatibleParameters = useMemo(
    () => project.parameters.filter((parameter) => parameter.unit === 'mm'),
    [project.parameters],
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
                    (candidate) => candidate.id === parameterReference.parameter,
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

function ProfileLoopFields({
  loop,
  project,
  disabled,
  onChange,
}: {
  loop: BrepProfileLoop;
  project: BrepProject;
  disabled: boolean;
  onChange: (loop: BrepProfileLoop) => void;
}) {
  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5 text-xs text-adam-neutral-300">
        <span>Hole profile type</span>
        <select
          className={fieldClass}
          value={loop.type}
          disabled={disabled}
          onChange={(event) =>
            onChange(defaultLoop(event.target.value as BrepProfileLoop['type']))
          }
        >
          <option value="rectangle">Rectangle</option>
          <option value="circle">Circle</option>
          <option value="closedPolyline">Closed polyline</option>
        </select>
      </label>

      {loop.type === 'rectangle' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ScalarField
            label="Hole width"
            value={loop.width}
            project={project}
            disabled={disabled}
            onChange={(width) => onChange({ ...loop, width })}
          />
          <ScalarField
            label="Hole height"
            value={loop.height}
            project={project}
            disabled={disabled}
            onChange={(height) => onChange({ ...loop, height })}
          />
        </div>
      ) : loop.type === 'circle' ? (
        <ScalarField
          label="Hole radius"
          value={loop.radius}
          project={project}
          disabled={disabled}
          onChange={(radius) => onChange({ ...loop, radius })}
        />
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-adam-neutral-300">
              Hole points · {loop.points.length}/{BREP_PROJECT_MAX_PROFILE_POINTS}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px]"
              disabled={
                disabled || loop.points.length >= BREP_PROJECT_MAX_PROFILE_POINTS
              }
              onClick={() => {
                const last = loop.points.at(-1);
                const nextPoint = {
                  u: typeof last?.u === 'number' ? last.u + 5 : 5,
                  v: typeof last?.v === 'number' ? last.v + 5 : 5,
                };
                onChange({ ...loop, points: [...loop.points, nextPoint] });
              }}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add point
            </Button>
          </div>
          {loop.points.map((point, index) => (
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
                  className="h-7 px-2 text-[10px]"
                  disabled={disabled || loop.points.length <= 3}
                  onClick={() =>
                    onChange({
                      ...loop,
                      points: loop.points.filter(
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
                  project={project}
                  disabled={disabled}
                  onChange={(u) =>
                    onChange({
                      ...loop,
                      points: loop.points.map((candidate, pointIndex) =>
                        pointIndex === index ? { ...candidate, u } : candidate,
                      ),
                    })
                  }
                />
                <ScalarField
                  label="V"
                  value={point.v}
                  project={project}
                  disabled={disabled}
                  onChange={(v) =>
                    onChange({
                      ...loop,
                      points: loop.points.map((candidate, pointIndex) =>
                        pointIndex === index ? { ...candidate, v } : candidate,
                      ),
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HoleFields({
  hole,
  index,
  holeCount,
  project,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  hole: BrepProfileHole;
  index: number;
  holeCount: number;
  project: BrepProject;
  disabled: boolean;
  onChange: (hole: BrepProfileHole) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-4 rounded-lg border border-adam-neutral-800 bg-adam-neutral-950/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-adam-neutral-300">
          Hole {index + 1}
        </span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Move hole ${index + 1} up`}
            disabled={disabled || index === 0}
            className="h-7 px-2 text-[10px]"
            onClick={() => onMove(-1)}
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Move hole ${index + 1} down`}
            disabled={disabled || index === holeCount - 1}
            className="h-7 px-2 text-[10px]"
            onClick={() => onMove(1)}
          >
            ↓
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="h-7 px-2 text-[10px]"
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </div>

      <ProfileLoopFields
        loop={hole.loop}
        project={project}
        disabled={disabled}
        onChange={(loop) => onChange({ ...hole, loop })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <ScalarField
          label="Offset U"
          value={hole.offsetU}
          project={project}
          disabled={disabled}
          onChange={(offsetU) => onChange({ ...hole, offsetU })}
        />
        <ScalarField
          label="Offset V"
          value={hole.offsetV}
          project={project}
          disabled={disabled}
          onChange={(offsetV) => onChange({ ...hole, offsetV })}
        />
      </div>
    </div>
  );
}

export function BrepMultiLoopProfileEditor({
  project,
  disabled,
  saving,
  onSaveNode,
}: {
  project: BrepProject;
  disabled: boolean;
  saving: boolean;
  onSaveNode: (node: BrepNode) => Promise<void>;
}) {
  const extrudes = project.nodes.filter(
    (node): node is BrepExtrudeNode => node.type === 'extrude',
  );
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<BrepExtrudeNode | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  if (extrudes.length === 0) return null;

  const editNode = (node: BrepExtrudeNode) => {
    if (disabled || saving) return;
    setDraft(cloneExtrude(node));
    setLocalError(null);
    setDialogOpen(true);
  };

  const holes = draft?.profile.holes ?? [];
  const updateHoles = (nextHoles: BrepProfileHole[]) => {
    if (!draft) return;
    setDraft({
      ...draft,
      profile: {
        ...draft.profile,
        ...(nextHoles.length > 0 ? { holes: nextHoles } : { holes: undefined }),
      },
    });
  };

  const save = async () => {
    if (!draft || saving) return;
    setLocalError(null);
    try {
      await onSaveNode(draft);
      setDialogOpen(false);
      setDraft(null);
    } catch (reason) {
      setLocalError(
        reason instanceof Error
          ? reason.message
          : 'Could not save the multi-loop extrusion revision.',
      );
    }
  };

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          aria-label={`${open ? 'Collapse' : 'Expand'} BRep profile holes`}
          className="group mt-2 flex w-full items-center justify-between gap-2 rounded-md py-1 text-xs font-semibold text-adam-text-primary transition-colors focus:outline-none"
        >
          <span className="flex items-center gap-2">
            Profile holes
            <span className="text-[10px] text-adam-neutral-400">
              {extrudes.reduce(
                (count, node) => count + (node.profile.holes?.length ?? 0),
                0,
              )}
            </span>
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-adam-neutral-400 transition-all duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 grid gap-2 rounded-lg border border-adam-neutral-800 bg-adam-neutral-900/30 p-2.5">
            {extrudes.map((node) => (
              <div
                key={node.id}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs text-adam-neutral-300"
              >
                <span className="min-w-0 truncate">
                  {node.id} · {node.profile.holes?.length ?? 0}/
                  {BREP_PROJECT_MAX_PROFILE_HOLES} holes
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-[10px]"
                  disabled={disabled || saving}
                  onClick={() => editNode(node)}
                >
                  Edit holes
                </Button>
              </div>
            ))}
            <p className="px-2 text-[10px] leading-4 text-adam-neutral-500">
              Holes are ordered, non-recursive loops in the same local U/V plane
              as the outer extrusion profile. Save rejects touching,
              intersection, nesting and holes outside the outer loop.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

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
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Extrusion profile holes</DialogTitle>
            <DialogDescription>
              Edit the bounded inner loops for {draft?.id ?? 'this extrusion'}.
              Outer profile semantics and scalar expressions remain canonical.
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-adam-neutral-300">
                  Inner loops · {holes.length}/{BREP_PROJECT_MAX_PROFILE_HOLES}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={
                    disabled ||
                    saving ||
                    holes.length >= BREP_PROJECT_MAX_PROFILE_HOLES
                  }
                  className="h-7 px-2 text-[10px]"
                  onClick={() =>
                    updateHoles([
                      ...holes,
                      { loop: defaultLoop('circle'), offsetU: 0, offsetV: 0 },
                    ])
                  }
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add hole
                </Button>
              </div>

              {holes.length === 0 ? (
                <p className="rounded-lg border border-dashed border-adam-neutral-800 p-3 text-xs text-adam-neutral-500">
                  This extrusion uses the legacy single-loop profile. Add a hole
                  to opt into the bounded multi-loop representation.
                </p>
              ) : null}

              {holes.map((hole, index) => (
                <HoleFields
                  key={index}
                  hole={hole}
                  index={index}
                  holeCount={holes.length}
                  project={project}
                  disabled={disabled || saving}
                  onChange={(nextHole) =>
                    updateHoles(
                      holes.map((candidate, holeIndex) =>
                        holeIndex === index ? nextHole : candidate,
                      ),
                    )
                  }
                  onMove={(direction) => {
                    const next = [...holes];
                    const target = index + direction;
                    [next[index], next[target]] = [next[target]!, next[index]!];
                    updateHoles(next);
                  }}
                  onRemove={() =>
                    updateHoles(
                      holes.filter((_, holeIndex) => holeIndex !== index),
                    )
                  }
                />
              ))}

              {localError ? (
                <p className="text-xs text-red-400">{localError}</p>
              ) : null}

              <div className="flex justify-end gap-2">
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
                  disabled={disabled || saving}
                  onClick={save}
                >
                  Save hole revision
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
