import { useMemo, useState } from 'react';
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
  BREP_PROJECT_MAX_METADATA_PROPERTIES,
  BREP_PROJECT_MAX_PARAMETERS,
  type BrepParameterUnit,
  type BrepProject,
  type BrepProjectMetadata,
  type BrepPublishedNumberParameter,
  type BrepScalar,
  type BrepVector3,
} from '@shared/brepProject';
import {
  brepProjectParameterUsages,
  replaceBrepProjectDefinition,
  suggestBrepParameterId,
  type BrepProjectDefinition,
} from '@shared/brepProjectEditing';
import {
  formatBrepScalar,
  isBrepParameterReference,
} from '@shared/brepScalar';

const LITERAL_VALUE = '__literal__';
const EXPRESSION_VALUE = '__expression__';
const fieldClass =
  'h-9 w-full rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 px-2 text-xs text-adam-text-primary outline-none focus:border-adam-blue-dark disabled:cursor-not-allowed disabled:opacity-60';
const textAreaClass =
  'min-h-20 w-full rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 px-2 py-2 text-xs text-adam-text-primary outline-none focus:border-adam-blue-dark disabled:cursor-not-allowed disabled:opacity-60';

type MetadataPropertyRow = {
  key: string;
  value: string;
};

function cloneDefinition(project: BrepProject): BrepProjectDefinition {
  return JSON.parse(
    JSON.stringify({
      name: project.name,
      placement: project.placement,
      metadata: project.metadata ?? {},
      parameters: project.parameters,
    }),
  ) as BrepProjectDefinition;
}

function metadataRows(metadata?: BrepProjectMetadata): MetadataPropertyRow[] {
  return Object.entries(metadata?.properties ?? {}).map(([key, value]) => ({
    key,
    value,
  }));
}

function draftProject(
  project: BrepProject,
  definition: BrepProjectDefinition,
): BrepProject {
  return {
    ...project,
    name: definition.name,
    placement: definition.placement,
    metadata: definition.metadata,
    parameters: definition.parameters,
  };
}

function nextMetadataPropertyKey(rows: readonly MetadataPropertyRow[]): string {
  const existing = new Set(rows.map((row) => row.key));
  if (!existing.has('property')) return 'property';
  for (let index = 2; index <= rows.length + 2; index += 1) {
    const candidate = `property${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `property${rows.length + 2}`;
}

function OptionalNumberInput({
  value,
  disabled,
  onChange,
}: {
  value: number | undefined;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <input
      className={fieldClass}
      type="number"
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) =>
        onChange(
          event.target.value.trim() === '' ? undefined : Number(event.target.value),
        )
      }
    />
  );
}

function PlacementScalarField({
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

function PlacementVectorField({
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
        <PlacementScalarField
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

function ParameterDefinitionRow({
  parameter,
  existing,
  usages,
  disabled,
  onChange,
  onRemove,
}: {
  parameter: BrepPublishedNumberParameter;
  existing: boolean;
  usages: string[];
  disabled: boolean;
  onChange: (parameter: BrepPublishedNumberParameter) => void;
  onRemove: () => void;
}) {
  const referenced = usages.length > 0;

  return (
    <div className="grid gap-3 rounded-lg border border-adam-neutral-800 bg-adam-neutral-950/25 p-3">
      <div className="flex min-w-0 items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Stable parameter ID</span>
            <input
              className={fieldClass}
              value={parameter.id}
              readOnly={existing}
              disabled={disabled}
              onChange={(event) => onChange({ ...parameter, id: event.target.value })}
            />
          </label>
          <label className="grid gap-1.5 text-xs text-adam-neutral-300">
            <span>Label</span>
            <input
              className={fieldClass}
              value={parameter.label}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...parameter, label: event.target.value })
              }
            />
          </label>
        </div>
        <button
          type="button"
          aria-label={`Remove published parameter ${parameter.id}`}
          title={
            referenced
              ? `Referenced by ${usages.join(', ')}`
              : 'Remove parameter from this definition draft'
          }
          disabled={disabled || referenced}
          onClick={onRemove}
          className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-adam-neutral-500 transition-colors hover:bg-adam-neutral-800 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1.5 text-xs text-adam-neutral-300">
          <span>Unit</span>
          <select
            className={fieldClass}
            value={parameter.unit}
            disabled={disabled || (existing && referenced)}
            title={
              existing && referenced
                ? 'Rewire parameter references before changing its unit.'
                : undefined
            }
            onChange={(event) =>
              onChange({
                ...parameter,
                unit: event.target.value as BrepParameterUnit,
              })
            }
          >
            <option value="mm">mm</option>
            <option value="deg">deg</option>
            <option value="none">none</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-xs text-adam-neutral-300">
          <span>Default</span>
          <input
            className={fieldClass}
            type="number"
            value={parameter.default}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...parameter, default: Number(event.target.value) })
            }
          />
        </label>
        <label className="grid gap-1.5 text-xs text-adam-neutral-300">
          <span>Min</span>
          <OptionalNumberInput
            value={parameter.min}
            disabled={disabled}
            onChange={(min) => onChange({ ...parameter, min })}
          />
        </label>
        <label className="grid gap-1.5 text-xs text-adam-neutral-300">
          <span>Max</span>
          <OptionalNumberInput
            value={parameter.max}
            disabled={disabled}
            onChange={(max) => onChange({ ...parameter, max })}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
        <label className="grid gap-1.5 text-xs text-adam-neutral-300">
          <span>Step</span>
          <OptionalNumberInput
            value={parameter.step}
            disabled={disabled}
            onChange={(step) => onChange({ ...parameter, step })}
          />
        </label>
        <label className="grid gap-1.5 text-xs text-adam-neutral-300">
          <span>Description</span>
          <textarea
            className={textAreaClass}
            value={parameter.description ?? ''}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...parameter,
                description: event.target.value || undefined,
              })
            }
          />
        </label>
      </div>

      {referenced ? (
        <p className="text-[10px] text-adam-neutral-500">
          Used by {usages.join(', ')}. Rewire those fields before removing this
          parameter or changing its unit.
        </p>
      ) : null}
    </div>
  );
}

export function BrepProjectDefinitionEditor({
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
  const [draft, setDraft] = useState<BrepProjectDefinition | null>(null);
  const [properties, setProperties] = useState<MetadataPropertyRow[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const existingParameterIds = useMemo(
    () => new Set(project.parameters.map((parameter) => parameter.id)),
    [project.parameters],
  );

  const openEditor = () => {
    if (disabled || saving) return;
    setDraft(cloneDefinition(project));
    setProperties(metadataRows(project.metadata));
    setLocalError(null);
    setDialogOpen(true);
  };

  const updateParameter = (
    index: number,
    parameter: BrepPublishedNumberParameter,
  ) => {
    if (!draft) return;
    const parameters = [...draft.parameters];
    parameters[index] = parameter;
    setDraft({ ...draft, parameters });
  };

  const addParameter = () => {
    if (!draft || draft.parameters.length >= BREP_PROJECT_MAX_PARAMETERS) return;
    try {
      const id = suggestBrepParameterId(draftProject(project, draft));
      setDraft({
        ...draft,
        parameters: [
          ...draft.parameters,
          {
            id,
            label: 'New parameter',
            type: 'number',
            unit: 'mm',
            default: 0,
            step: 1,
          },
        ],
      });
      setLocalError(null);
    } catch (reason) {
      setLocalError(
        reason instanceof Error ? reason.message : 'Could not add a parameter.',
      );
    }
  };

  const removeParameter = (index: number) => {
    if (!draft) return;
    const parameter = draft.parameters[index];
    const usages = brepProjectParameterUsages(
      draftProject(project, draft),
      parameter.id,
    );
    if (usages.length > 0) {
      setLocalError(
        `Published parameter ${parameter.id} is still used by ${usages.join(', ')}. Rewire those fields before removing it.`,
      );
      return;
    }
    setDraft({
      ...draft,
      parameters: draft.parameters.filter((_, candidate) => candidate !== index),
    });
    setLocalError(null);
  };

  const save = async () => {
    if (!draft || saving) return;
    setLocalError(null);
    try {
      const propertyRecord: Record<string, string> = {};
      for (const row of properties) {
        if (!row.key.trim()) {
          throw new Error('Metadata property keys cannot be empty.');
        }
        if (Object.prototype.hasOwnProperty.call(propertyRecord, row.key)) {
          throw new Error(`Duplicate metadata property key: ${row.key}.`);
        }
        propertyRecord[row.key] = row.value;
      }

      const metadata: BrepProjectMetadata = {
        ...(draft.metadata?.objectType != null
          ? { objectType: draft.metadata.objectType }
          : {}),
        ...(draft.metadata?.classification != null
          ? { classification: draft.metadata.classification }
          : {}),
        ...(properties.length > 0 ? { properties: propertyRecord } : {}),
      };
      const nextProject = replaceBrepProjectDefinition(project, {
        ...draft,
        metadata,
      });
      await onSaveProject(nextProject);
      setDialogOpen(false);
      setDraft(null);
      setProperties([]);
    } catch (reason) {
      setLocalError(
        reason instanceof Error
          ? reason.message
          : 'Could not save the BRep project definition.',
      );
    }
  };

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger
            aria-label={`${open ? 'Collapse' : 'Expand'} BRep project definition`}
            className="group flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md py-1 text-xs font-semibold text-adam-text-primary transition-colors focus:outline-none"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span>Project definition</span>
              <span className="text-[10px] text-adam-neutral-400">
                {project.parameters.length} parameters
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
            disabled={disabled || saving}
            onClick={openEditor}
            className="h-7 shrink-0 px-2 text-[10px]"
          >
            <Settings2 className="mr-1 h-3 w-3" />
            Edit
          </Button>
        </div>
        <CollapsibleContent>
          <div className="mt-2 grid gap-1 rounded-lg border border-adam-neutral-800 bg-adam-neutral-900/35 p-2.5 text-[10px] text-adam-neutral-400">
            <div className="flex min-w-0 justify-between gap-3">
              <span>Name</span>
              <span className="truncate text-adam-neutral-300">{project.name}</span>
            </div>
            <div className="flex min-w-0 justify-between gap-3">
              <span>Project ID</span>
              <span className="truncate font-mono text-adam-neutral-300">
                {project.id}
              </span>
            </div>
            <div className="flex min-w-0 justify-between gap-3">
              <span>Object type</span>
              <span className="truncate text-adam-neutral-300">
                {project.metadata?.objectType || '—'}
              </span>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-adam-neutral-500">
            Placement is the reusable component plane contract for future project
            composition; native BRep geometry remains authored in local coordinates.
          </p>
        </CollapsibleContent>
      </Collapsible>

      <Dialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          if (saving) return;
          setDialogOpen(nextOpen);
          if (!nextOpen) {
            setDraft(null);
            setProperties([]);
            setLocalError(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-4 overflow-hidden bg-adam-bg-secondary-dark p-4 sm:w-[calc(100vw-2rem)] sm:p-6">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-adam-text-primary">
                  <Settings2 className="h-4 w-4" />
                  Project definition
                </DialogTitle>
                <DialogDescription className="text-adam-neutral-400">
                  Edit the reusable canonical BRep contract. Project identity,
                  feature IDs and result authority stay unchanged; Save creates one
                  immutable source revision.
                </DialogDescription>
              </DialogHeader>

              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
                <section className="grid gap-3">
                  <h3 className="text-xs font-semibold text-adam-text-primary">
                    Identity
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-xs text-adam-neutral-300">
                      <span>Project name</span>
                      <input
                        className={fieldClass}
                        value={draft.name}
                        disabled={saving}
                        onChange={(event) =>
                          setDraft({ ...draft, name: event.target.value })
                        }
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs text-adam-neutral-300">
                      <span>Stable project ID</span>
                      <input
                        className={fieldClass}
                        value={project.id}
                        readOnly
                        disabled
                      />
                    </label>
                  </div>
                </section>

                <section className="grid gap-3 border-t border-adam-neutral-800 pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-semibold text-adam-text-primary">
                        Published parameters
                      </h3>
                      <p className="mt-1 text-[10px] text-adam-neutral-500">
                        Stable inputs used by Brepia controls and future Grasshopper
                        component inputs.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={
                        saving ||
                        draft.parameters.length >= BREP_PROJECT_MAX_PARAMETERS
                      }
                      onClick={addParameter}
                      className="h-8 shrink-0 text-[10px]"
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add parameter
                    </Button>
                  </div>

                  <div className="grid gap-3">
                    {draft.parameters.length > 0 ? (
                      draft.parameters.map((parameter, index) => {
                        const usages = brepProjectParameterUsages(
                          draftProject(project, draft),
                          parameter.id,
                        );
                        return (
                          <ParameterDefinitionRow
                            key={`${existingParameterIds.has(parameter.id) ? 'existing' : 'new'}:${index}:${parameter.id}`}
                            parameter={parameter}
                            existing={existingParameterIds.has(parameter.id)}
                            usages={usages}
                            disabled={saving}
                            onChange={(next) => updateParameter(index, next)}
                            onRemove={() => removeParameter(index)}
                          />
                        );
                      })
                    ) : (
                      <p className="rounded-lg border border-adam-neutral-800 p-3 text-xs text-adam-neutral-500">
                        No published parameters. Literal feature values remain valid.
                      </p>
                    )}
                  </div>
                </section>

                <section className="grid gap-3 border-t border-adam-neutral-800 pt-5">
                  <div>
                    <h3 className="text-xs font-semibold text-adam-text-primary">
                      Placement plane
                    </h3>
                    <p className="mt-1 text-[10px] text-adam-neutral-500">
                      Canonical component placement for future Grasshopper/project
                      composition. It does not move the local native preview geometry.
                    </p>
                  </div>
                  <PlacementVectorField
                    label="Origin · mm"
                    value={draft.placement.origin}
                    unit="mm"
                    parameters={draft.parameters}
                    disabled={saving}
                    onChange={(origin) =>
                      setDraft({
                        ...draft,
                        placement: { ...draft.placement, origin },
                      })
                    }
                  />
                  <div className="grid gap-3 lg:grid-cols-2">
                    <PlacementVectorField
                      label="X axis · unitless"
                      value={draft.placement.xAxis}
                      unit="none"
                      parameters={draft.parameters}
                      disabled={saving}
                      onChange={(xAxis) =>
                        setDraft({
                          ...draft,
                          placement: { ...draft.placement, xAxis },
                        })
                      }
                    />
                    <PlacementVectorField
                      label="Y axis · unitless"
                      value={draft.placement.yAxis}
                      unit="none"
                      parameters={draft.parameters}
                      disabled={saving}
                      onChange={(yAxis) =>
                        setDraft({
                          ...draft,
                          placement: { ...draft.placement, yAxis },
                        })
                      }
                    />
                  </div>
                </section>

                <section className="grid gap-3 border-t border-adam-neutral-800 pt-5">
                  <h3 className="text-xs font-semibold text-adam-text-primary">
                    Object metadata
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-xs text-adam-neutral-300">
                      <span>Object type</span>
                      <input
                        className={fieldClass}
                        value={draft.metadata?.objectType ?? ''}
                        disabled={saving}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            metadata: {
                              ...draft.metadata,
                              objectType: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs text-adam-neutral-300">
                      <span>Classification</span>
                      <input
                        className={fieldClass}
                        value={draft.metadata?.classification ?? ''}
                        disabled={saving}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            metadata: {
                              ...draft.metadata,
                              classification: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-adam-neutral-300">
                      Custom properties
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={
                        saving ||
                        properties.length >= BREP_PROJECT_MAX_METADATA_PROPERTIES
                      }
                      onClick={() =>
                        setProperties([
                          ...properties,
                          {
                            key: nextMetadataPropertyKey(properties),
                            value: 'value',
                          },
                        ])
                      }
                      className="h-8 text-[10px]"
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add property
                    </Button>
                  </div>

                  <div className="grid gap-2">
                    {properties.map((row, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_32px] gap-2"
                      >
                        <input
                          aria-label={`Metadata property ${index + 1} key`}
                          className={fieldClass}
                          value={row.key}
                          disabled={saving}
                          onChange={(event) => {
                            const next = [...properties];
                            next[index] = { ...row, key: event.target.value };
                            setProperties(next);
                          }}
                        />
                        <input
                          aria-label={`Metadata property ${index + 1} value`}
                          className={fieldClass}
                          value={row.value}
                          disabled={saving}
                          onChange={(event) => {
                            const next = [...properties];
                            next[index] = { ...row, value: event.target.value };
                            setProperties(next);
                          }}
                        />
                        <button
                          type="button"
                          aria-label={`Remove metadata property ${row.key}`}
                          disabled={saving}
                          onClick={() =>
                            setProperties(
                              properties.filter(
                                (_, candidate) => candidate !== index,
                              ),
                            )
                          }
                          className="flex h-9 w-8 items-center justify-center rounded-md text-adam-neutral-500 hover:bg-adam-neutral-800 hover:text-destructive disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {properties.length === 0 ? (
                      <p className="text-[10px] text-adam-neutral-500">
                        No custom metadata properties.
                      </p>
                    ) : null}
                  </div>
                </section>

                {localError ? (
                  <div className="rounded-lg border border-destructive p-3 text-sm text-destructive">
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
                <Button type="button" disabled={saving} onClick={() => void save()}>
                  {saving ? 'Saving project definition…' : 'Save project definition'}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
