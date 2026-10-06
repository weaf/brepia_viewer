import { useEffect, useMemo, useRef, useState } from 'react';
import { brepViewerGeometryFromResult } from '@/components/brep/brepViewerGeometry';
import { ThreeScene } from '@/components/viewer/ThreeScene';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { apiUrl } from '@/services/api';
import { exportBrepStep } from '@/services/brepStepExport';
import { createBrepProjectConversation } from '@/services/brepProjectService';
import { importBrepProjectConversation } from '@/services/brepProjectService';
import { downloadSTEPFile } from '@/utils/downloadUtils';
import { phaseOneCabinetProject } from '@shared/brepSamples';
import type { BrepProject } from '@shared/brepProject';
import { SCRATCH_PROJECT_ORIGIN } from '@shared/projectOrigin';
import {
  BREP_PROJECT_PACKAGE_MAX_BYTES,
  createBrepProjectPackage,
  parseBrepProjectPackageJson,
  serializeBrepProjectPackage,
} from '@shared/brepProjectPackage';
import type {
  BrepEvaluationSuccess,
  BrepParameterValues,
} from '@shared/brepProvider';

const BREP_EVALUATION_DEBOUNCE_MS = 120;
// The accepted native server defaults to one evaluator slot. Keep evaluation
// requests from this browser serialized across preview remounts as well as
// rapid value changes. This avoids racing a newly mounted revision against the
// still-finishing Podman request from the previous revision without weakening
// the server-side capacity guard.
let browserBrepEvaluationQueue: Promise<void> = Promise.resolve();

function parameterValuesEqual(
  left: BrepParameterValues,
  right: BrepParameterValues,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

export function BrepProjectPreview({
  project = phaseOneCabinetProject,
  createProject = false,
  onParameterValuesCommit,
  revisions = [],
  activeRevisionId,
  onSelectRevision,
  onRestoreRevision,
  exportPackage = false,
  importPackage = false,
  packageTitle,
}: {
  project?: BrepProject;
  createProject?: boolean;
  onParameterValuesCommit?: (values: BrepParameterValues) => Promise<void>;
  revisions?: Array<{ id: string; label: string }>;
  activeRevisionId?: string;
  onSelectRevision?: (id: string) => Promise<void>;
  onRestoreRevision?: (id: string) => Promise<void>;
  exportPackage?: boolean;
  importPackage?: boolean;
  packageTitle?: string;
}) {
  const { user } = useAuth();
  const [values, setValues] = useState<BrepParameterValues>(() =>
    Object.fromEntries(
      project.parameters.map((parameter) => [parameter.id, parameter.default]),
    ),
  );
  const [result, setResult] = useState<BrepEvaluationSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const valuesRef = useRef(values);
  const committedValuesRef = useRef(values);
  const evaluationVersionRef = useRef(0);
  const mountedRef = useRef(true);
  const hasUnsavedParameterChanges = !parameterValuesEqual(
    values,
    committedValuesRef.current,
  );
  const geometry = useMemo(
    () => (result ? brepViewerGeometryFromResult(result) : null),
    [result],
  );

  useEffect(() => {
    return () => geometry?.dispose();
  }, [geometry]);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      evaluationVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const version = evaluationVersionRef.current + 1;
    evaluationVersionRef.current = version;
    const requestProject = project;
    const requestValues = { ...values };

    setLoading(true);
    setError(null);

    const timer = window.setTimeout(() => {
      browserBrepEvaluationQueue = browserBrepEvaluationQueue
        .catch(() => undefined)
        .then(async () => {
          // Fast input can enqueue an evaluation before a newer value arrives.
          // Skip obsolete queued work before it consumes the native evaluator.
          // An already-running request is allowed to finish so its server slot
          // is definitely released before a newer/remounted preview starts.
          if (!mountedRef.current || version !== evaluationVersionRef.current)
            return;

          try {
            const token = (await supabase.auth.getSession()).data.session
              ?.access_token;
            const response = await fetch(apiUrl('brep/evaluate'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({
                project: requestProject,
                parameterValues: requestValues,
              }),
            });
            const payload: unknown = await response.json();
            if (
              !response.ok ||
              !payload ||
              typeof payload !== 'object' ||
              !('status' in payload) ||
              payload.status !== 'success'
            ) {
              const detail =
                payload &&
                typeof payload === 'object' &&
                'error' in payload &&
                typeof payload.error === 'string'
                  ? payload.error
                  : `BRep evaluation failed (${response.status}).`;
              throw new Error(detail);
            }
            if (
              mountedRef.current &&
              version === evaluationVersionRef.current
            ) {
              setResult(payload as BrepEvaluationSuccess);
            }
          } catch (reason) {
            if (
              mountedRef.current &&
              version === evaluationVersionRef.current
            ) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : 'BRep evaluation failed.',
              );
            }
          } finally {
            if (
              mountedRef.current &&
              version === evaluationVersionRef.current
            ) {
              setLoading(false);
            }
          }
        });
    }, BREP_EVALUATION_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [project, values]);

  return (
    <main className="grid h-full min-h-[600px] grid-cols-1 gap-4 p-6 lg:grid-cols-[320px_1fr]">
      <section className="rounded-lg border border-adam-neutral-700 bg-adam-bg-secondary-dark p-5 text-adam-text-primary">
        <h1 className="text-xl font-semibold">
          {packageTitle ?? project.name}
        </h1>
        <p className="mt-2 text-sm text-adam-text-tertiary">
          Native BRep project. Published values are ready for future Grasshopper
          inputs.
        </p>
        <div className="mt-6 space-y-4">
          {project.parameters.map((parameter) => (
            <label className="block text-sm" key={parameter.id}>
              <span>
                {parameter.label} ({parameter.unit})
              </span>
              <input
                className="border-adam-neutral-600 mt-1 w-full rounded border bg-adam-neutral-900 p-2"
                type="number"
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                value={values[parameter.id]}
                disabled={committing}
                onChange={(event) => {
                  const nextValues = {
                    ...valuesRef.current,
                    [parameter.id]: Number(event.target.value),
                  };
                  valuesRef.current = nextValues;
                  setValues(nextValues);
                }}
              />
            </label>
          ))}
        </div>
        {onParameterValuesCommit ? (
          <>
            <Button
              className="mt-6 w-full"
              disabled={committing || !hasUnsavedParameterChanges}
              onClick={() => {
                if (committing || !hasUnsavedParameterChanges) return;
                const committedValues = { ...valuesRef.current };
                setCommitting(true);
                setError(null);
                void onParameterValuesCommit(committedValues)
                  .then(() => {
                    committedValuesRef.current = committedValues;
                  })
                  .catch((reason) => {
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : 'Could not persist BRep parameter revision.',
                    );
                  })
                  .finally(() => setCommitting(false));
              }}
            >
              {committing
                ? 'Saving parameter revision…'
                : hasUnsavedParameterChanges
                  ? 'Save parameter revision'
                  : 'Parameters saved'}
            </Button>
            {hasUnsavedParameterChanges ? (
              <p className="mt-2 text-xs text-adam-text-tertiary">
                Preview values are not yet saved as a source revision.
              </p>
            ) : null}
          </>
        ) : null}
        <Button
          className={onParameterValuesCommit ? 'mt-3' : 'mt-6'}
          variant="outline"
          onClick={() => setValues((current) => ({ ...current }))}
        >
          Re-evaluate
        </Button>
        <Button
          className="mt-3 w-full"
          disabled={exporting || loading || committing}
          variant="outline"
          onClick={async () => {
            setExporting(true);
            setError(null);
            try {
              const step = await exportBrepStep(project, values);
              downloadSTEPFile(step);
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : 'BRep STEP export failed.',
              );
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting
            ? 'Exporting STEP…'
            : committing
              ? 'Saving parameters…'
              : 'Export native STEP'}
        </Button>
        {exportPackage ? (
          <Button
            className="mt-3 w-full"
            variant="outline"
            onClick={() => {
              const title = packageTitle ?? project.name;
              const text = serializeBrepProjectPackage(
                createBrepProjectPackage({
                  title,
                  source: { kind: 'brep', source: project },
                }),
              );
              const url = URL.createObjectURL(
                new Blob([text], { type: 'application/json' }),
              );
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'brep-project'}.brepia-brep.json`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export BRep project
          </Button>
        ) : null}
        {createProject ? (
          <Button
            className="mt-3 w-full"
            disabled={creating || !user?.id}
            onClick={async () => {
              if (!user?.id) return;
              setCreating(true);
              setError(null);
              try {
                const conversationId = await createBrepProjectConversation({
                  userId: user.id,
                  title: project.name,
                  project,
                  projectOrigin: SCRATCH_PROJECT_ORIGIN,
                });
                window.location.assign(`/brep/${conversationId}`);
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : 'Could not create BRep project.',
                );
              } finally {
                setCreating(false);
              }
            }}
          >
            {creating ? 'Creating project…' : 'Create BRep project'}
          </Button>
        ) : null}
        {importPackage ? (
          <label className="mt-3 block">
            <span className="sr-only">Import BRep project package</span>
            <input
              accept="application/json,.json,.brepia-brep.json"
              className="block w-full text-sm"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = '';
                if (!file || !user?.id) return;
                setError(null);
                if (file.size > BREP_PROJECT_PACKAGE_MAX_BYTES) {
                  setError(
                    `BRep project package exceeds ${BREP_PROJECT_PACKAGE_MAX_BYTES} bytes.`,
                  );
                  return;
                }
                void file
                  .text()
                  .then(async (text) => {
                    const conversationId = await importBrepProjectConversation({
                      userId: user.id,
                      projectPackage: parseBrepProjectPackageJson(text),
                    });
                    window.location.assign(`/brep/${conversationId}`);
                  })
                  .catch((reason) =>
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : 'Could not import BRep project.',
                    ),
                  );
              }}
            />
          </label>
        ) : null}
        {revisions.length > 1 ? (
          <div className="mt-6 border-t border-adam-neutral-700 pt-4">
            <p className="text-sm font-medium">Source revisions</p>
            <div className="mt-2 space-y-2">
              {revisions.map((revision) => (
                <div className="flex gap-2" key={revision.id}>
                  <Button
                    className="flex-1 justify-start"
                    disabled={revision.id === activeRevisionId}
                    size="sm"
                    variant="outline"
                    onClick={() => void onSelectRevision?.(revision.id)}
                  >
                    {revision.label}
                  </Button>
                  <Button
                    disabled={!onRestoreRevision}
                    size="sm"
                    variant="outline"
                    onClick={() => void onRestoreRevision?.(revision.id)}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {loading && <p className="mt-4 text-sm">Evaluating native BRep…</p>}
        {error && (
          <p className="mt-4 rounded border border-destructive p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {result?.warnings.length ? (
          <p className="mt-4 text-sm">Warnings: {result.warnings.join('; ')}</p>
        ) : null}
      </section>
      <section className="min-h-[520px] overflow-hidden rounded-lg border border-adam-neutral-700 bg-adam-neutral-800">
        {geometry ? (
          <ThreeScene geometry={geometry} color="#00A6FF" />
        ) : (
          <div className="flex h-full items-center justify-center text-adam-text-tertiary">
            {loading ? 'Preparing BRep viewer…' : 'No BRep geometry available.'}
          </div>
        )}
      </section>
    </main>
  );
}
