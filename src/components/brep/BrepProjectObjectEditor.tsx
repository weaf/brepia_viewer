import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Settings2, Trash2 } from 'lucide-react';
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
  BREP_PROJECT_MAX_OBJECT_POINTS,
  type BrepParameterUnit,
  type BrepProject,
  type BrepProjectObjectDefinition,
  type BrepProjectObjectPoint,
  type BrepProjectObjectPointKind,
  type BrepPublishedNumberParameter,
  type BrepScalar,
  type BrepVector3,
} from '@shared/brepProject';
import {
  replaceBrepProjectObjectDefinition,
  suggestBrepProjectObjectPointId,
} from '@shared/brepProjectEditing';
import {
  formatBrepScalar,
  isBrepParameterReference,
} from '@shared/brepScalar';

const NONE_NODE = '__none__';
const LITERAL_VALUE = '__literal__';
const EXPRESSION_VALUE = '__expression__';
const fieldClass =
  'h-9 w-full rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 px-2 text-xs text-adam-text-primary outline-none focus:border-adam-blue-dark disabled:cursor-not-allowed disabled:opacity-60';

type PointDraftRow = {
  key: string;
  existing: boolean;
};

function cloneProjectObject(project: BrepProject): BrepProjectObjectDefinition {
  return JSON.parse(
    JSON.stringify(project.projectObject ?? {}),
  ) as BrepProjectObjectDefinition;
}

function draftProject(
  project: BrepProject,
  projectObject: BrepProjectObjectDefinition,
): BrepProject {
  return { ...project, projectObject };
}

function withoutDirection(
  point: BrepProjectObjectPoint,
): BrepProjectObjectPoint {
  return {
    id: point.id,
    kind: point.kind,
    position: point.position,
    ...(point.label ? { label: point.label } : {}),
  };
}

function RoleField({
  label,
  description,
  value,
  project,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  value: string | undefined;
  project: BrepProject;
  disabled: boolean;
  onChange: (nodeId: string | undefined) => void;
}) {
  return (
    <label className="grid gap-1.5 text-xs text-adam-neutral-300">
      <span>{label}</span>
      <select
        className={fieldClass}
        value={value ?? NONE_NODE}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value === NONE_NODE ? undefined : event.target.value)
        }
      >
        <option value={NONE_NODE}>Not assigned</option>
        {project.nodes.map((node) => (
          <option key={node.id} value={node.id}>
            {node.id} · {node.type}
            {node.id === project.resultNodeId ? ' · result' : ''}
          </option>
        ))}
      </select>
      <span className="text-[10px] leading-4 text-adam-neutral-500">
        {description}
      </span>
    </label>
  );
}

function SemanticScalarField({
  label,
  value,
  unit,
  parameters,
  disabled,
  onChange,
}: {
  label: string;
  value: BrepScalar;
  unit: BrepParameterUnit;
  parameters: BrepPublishedNumberParameter[];
  disabled: boolean;
  onChange: (value: BrepScalar) => void;
}) {
  const compatible = useMemo(
    () => parameters.filter((parameter) => parameter.unit === unit),
    [parameters, unit],
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
    <div className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
      <span className="text-[10px] font-medium text-adam-neutral-500">{label}</span>
      <select
        className={fieldClass}
        value={selected}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === EXPRESSION_VALUE) return;
          if (event.target.value === LITERAL_VALUE) {
            if (typeof value === 'number') return;
            const parameter = parameterReference
              ? parameters.find(
                  (candidate) => candidate.id === parameterReference.parameter,
                )
              : undefined;
            onChange(parameter?.default ?? 0);
            return;
          }
          onChange({ parameter: event.target.value.replace(/^parameter:/, '') });
        }}
      >
        <option value={LITERAL_VALUE}>Literal</option>
        {selected === EXPRESSION_VALUE ? (
          <option value={EXPRESSION_VALUE}>Expression · derived</option>
        ) : null}
        {compatible.map((parameter) => (
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
          className="flex h-9 min-w-0 items-center truncate rounded-lg border border-adam-neutral-800 bg-adam-neutral-950/50 px-2 font-mono text-[10px] text-adam-neutral-400"
          title={displayValue}
        >
          {displayValue}
        </div>
      )}
    </div>
  );
}

function SemanticVectorField({
  label,
  value,
  unit,
  parameters,
  disabled,
  onChange,
}: {
  label: string;
  value: BrepVector3;
  unit: BrepParameterUnit;
  parameters: BrepPublishedNumberParameter[];
  disabled: boolean;
  onChange: (value: BrepVector3) => void;
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-adam-neutral-800 bg-adam-neutral-950/25 p-3">
      <div className="text-xs font-medium text-adam-neutral-300">{label}</div>
      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
        <SemanticScalarField
          key={axis}
          label={axis}
          value={value[index]}
          unit={unit}
          parameters={parameters}
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

function PointRow({
  point,
  existing,
  parameters,
  disabled,
  onChange,
  onRemove,
}: {
  point: BrepProjectObjectPoint;
  existing: boolean;
  parameters: BrepPublishedNumberParameter[];
  disabled: boolean;
  onChange: (point: BrepProjectObjectPoint) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-adam-neutral-800 bg-adam-neutral-950/25 p-3">
      <div className="flex min-w-0 items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3">
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Stable point ID</span>
            <input
              className={fieldClass}
              value={point.id}
              readOnly={existing}
              disabled={disabled}
              onChange={(event) => onChange({ ...point, id: event.target.value })}
            />
          </label>
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Kind</span>
            <select
              className={fieldClass}
              value={point.kind}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...point,
                  kind: event.target.value as BrepProjectObjectPointKind,
                })
              }
            >
              <option value="connection">Connection</option>
              <option value="mounting">Mounting</option>
              <option value="cable">Cable</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Label</span>
            <input
              className={fieldClass}
              value={point.label ?? ''}
              disabled={disabled}
              placeholder="Optional"
              onChange={(event) =>
                onChange({
                  ...point,
                  label: event.target.value || undefined,
                })
              }
            />
          </label>
        </div>
        <button
          type="button"
          aria-label={`Remove semantic point ${point.id}`}
          title="Remove point from this project-object draft"
          disabled={disabled}
          onClick={onRemove}
          className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-adam-neutral-500 transition-colors hover:bg-adam-neutral-800 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <SemanticVectorField
        label="Local position · mm"
        value={point.position}
        unit="mm"
        parameters={parameters}
        disabled={disabled}
        onChange={(position) => onChange({ ...point, position })}
      />

      {point.direction ? (
        <div className="grid gap-2">
          <SemanticVectorField
            label="Local direction · unitless"
            value={point.direction}
            unit="none"
            parameters={parameters}
            disabled={disabled}
            onChange={(direction) => onChange({ ...point, direction })}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start text-xs"
            disabled={disabled}
            onClick={() => onChange(withoutDirection(point))}
          >
            Remove direction
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start text-xs"
          disabled={disabled}
          onClick={() => onChange({ ...point, direction: [0, 0, 1] })}
        >
          Add direction
        </Button>
      )}

      {existing ? (
        <p className="text-[10px] text-adam-neutral-500">
          This point ID is stable. Remove the point and create a new one only if
          its semantic identity genuinely changes.
        </p>
      ) : null}
    </div>
  );
}

export function BrepProjectObjectEditor({
  project,
  disabled,
  saving,
  onSaveProject,
}: {
  project: BrepProject;
  disabled: boolean;
  saving: boolean;
  onSaveProject: (project: BrepProject) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<BrepProjectObjectDefinition | null>(null);
  const [pointRows, setPointRows] = useState<PointDraftRow[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const nextPointRowKey = useRef(0);
  const roleCount = [
    project.projectObject?.footprintNodeId,
    project.projectObject?.clearanceEnvelopeNodeId,
    project.projectObject?.maintenanceEnvelopeNodeId,
  ].filter(Boolean).length;
  const pointCount = project.projectObject?.points?.length ?? 0;

  const openEditor = () => {
    if (disabled || saving) return;
    const nextDraft = cloneProjectObject(project);
    nextPointRowKey.current = 0;
    setDraft(nextDraft);
    setPointRows(
      (nextDraft.points ?? []).map((point) => ({
        key: `existing:${point.id}`,
        existing: true,
      })),
    );
    setLocalError(null);
    setDialogOpen(true);
  };

  const updatePoint = (index: number, point: BrepProjectObjectPoint) => {
    if (!draft) return;
    const points = [...(draft.points ?? [])];
    points[index] = point;
    setDraft({ ...draft, points });
  };

  const addPoint = () => {
    if (!draft) return;
    const points = draft.points ?? [];
    if (points.length >= BREP_PROJECT_MAX_OBJECT_POINTS) return;
    try {
      const id = suggestBrepProjectObjectPointId(
        draftProject(project, draft),
        'connection',
      );
      const key = `new:${nextPointRowKey.current}`;
      nextPointRowKey.current += 1;
      setDraft({
        ...draft,
        points: [
          ...points,
          {
            id,
            kind: 'connection',
            position: [0, 0, 0],
          },
        ],
      });
      setPointRows([...pointRows, { key, existing: false }]);
      setLocalError(null);
    } catch (reason) {
      setLocalError(
        reason instanceof Error
          ? reason.message
          : 'Could not add a semantic point.',
      );
    }
  };

  const removePoint = (index: number) => {
    if (!draft) return;
    setDraft({
      ...draft,
      points: (draft.points ?? []).filter(
        (_, candidate) => candidate !== index,
      ),
    });
    setPointRows(
      pointRows.filter((_, candidate) => candidate !== index),
    );
    setLocalError(null);
  };

  const closeEditor = () => {
    setDialogOpen(false);
    setDraft(null);
    setPointRows([]);
    setLocalError(null);
  };

  const save = async () => {
    if (!draft || saving) return;
    setLocalError(null);
    try {
      const nextProject = replaceBrepProjectObjectDefinition(project, draft);
      await onSaveProject(nextProject);
      closeEditor();
    } catch (reason) {
      setLocalError(
        reason instanceof Error
          ? reason.message
          : 'Could not save the BRep project object.',
      );
    }
  };

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger
            aria-label={`${open ? 'Collapse' : 'Expand'} BRep project object`}
            className="group flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md py-1 text-xs font-semibold text-adam-text-primary transition-colors focus:outline-none"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span>Project object</span>
              <span className="text-[10px] text-adam-neutral-400">
                {roleCount} roles · {pointCount} points
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
            className="h-7 shrink-0 gap-1 px-2 text-[10px]"
            disabled={disabled || saving}
            onClick={openEditor}
          >
            <Settings2 className="h-3 w-3" />
            Edit
          </Button>
        </div>
        <CollapsibleContent>
          <div className="mt-2 grid gap-1 text-[10px] leading-4 text-adam-neutral-500">
            <p>
              Assign semantic geometry roles and stable local connection,
              mounting or cable points for downstream project interoperability.
            </p>
            <p>
              These roles do not replace Result. The 3D preview continues to show
              the canonical Result body; semantic role bodies are evaluated
              separately by the native BRep runtime.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Dialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          if (saving) return;
          if (nextOpen) setDialogOpen(true);
          else closeEditor();
        }}
      >
        <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-4 bg-adam-bg-secondary-dark p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-adam-text-primary">
              Project object
            </DialogTitle>
            <DialogDescription className="text-adam-neutral-400">
              Define semantic auxiliary outputs without changing the canonical
              Result. Saving creates a new immutable BRep source revision.
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
              <section className="grid gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-adam-text-primary">
                    Geometry roles
                  </h3>
                  <p className="mt-1 text-[10px] leading-4 text-adam-neutral-500">
                    Roles reference existing feature nodes. A node may carry more
                    than one role when that is intentional.
                  </p>
                </div>
                <div className="grid gap-3 lg:grid-cols-3">
                  <RoleField
                    label="Footprint"
                    description="Semantic footprint geometry for project placement/interoperability."
                    value={draft.footprintNodeId}
                    project={project}
                    disabled={saving}
                    onChange={(footprintNodeId) =>
                      setDraft({ ...draft, footprintNodeId })
                    }
                  />
                  <RoleField
                    label="Clearance envelope"
                    description="Required surrounding clearance or exclusion geometry."
                    value={draft.clearanceEnvelopeNodeId}
                    project={project}
                    disabled={saving}
                    onChange={(clearanceEnvelopeNodeId) =>
                      setDraft({ ...draft, clearanceEnvelopeNodeId })
                    }
                  />
                  <RoleField
                    label="Maintenance envelope"
                    description="Access/service space required around the object."
                    value={draft.maintenanceEnvelopeNodeId}
                    project={project}
                    disabled={saving}
                    onChange={(maintenanceEnvelopeNodeId) =>
                      setDraft({ ...draft, maintenanceEnvelopeNodeId })
                    }
                  />
                </div>
              </section>

              <section className="grid gap-3 border-t border-adam-neutral-700/60 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold text-adam-text-primary">
                      Semantic points
                    </h3>
                    <p className="mt-1 text-[10px] leading-4 text-adam-neutral-500">
                      Positions are local millimetres. Optional directions are
                      unitless vectors. Compatible published parameters may drive
                      either value.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs"
                    disabled={
                      saving ||
                      (draft.points?.length ?? 0) >= BREP_PROJECT_MAX_OBJECT_POINTS
                    }
                    onClick={addPoint}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add point
                  </Button>
                </div>

                {(draft.points ?? []).length > 0 ? (
                  <div className="grid gap-3">
                    {(draft.points ?? []).map((point, index) => {
                      const row = pointRows[index];
                      return (
                        <PointRow
                          key={row?.key ?? `fallback:${index}`}
                          point={point}
                          existing={row?.existing ?? true}
                          parameters={project.parameters}
                          disabled={saving}
                          onChange={(nextPoint) => updatePoint(index, nextPoint)}
                          onRemove={() => removePoint(index)}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-adam-neutral-700 p-4 text-xs text-adam-neutral-500">
                    No semantic points configured.
                  </div>
                )}
              </section>

              {localError ? (
                <p className="rounded-lg border border-destructive p-3 text-sm text-destructive">
                  {localError}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-adam-neutral-700/60 pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={closeEditor}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!draft || saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving project object…' : 'Save project object'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
