import { ActivityIndicator } from "@/components/brand";
import { ThreeScene } from "@/components/viewer/ThreeScene";
import { describeOpenScadFailure } from "@/lib/openScadFeedback";
import { PreviewDiagnostics } from "@/components/viewer/PreviewDiagnostics";
import { useOpenSCAD } from "@/hooks/useOpenSCAD";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  getOpenScadEntrypoint,
  replaceOpenScadProjectFileContent,
  type OpenScadProject,
} from "@shared/openScadProject";
import type { DxfExporter } from "@/utils/downloadUtils";
import { createDXFProjectionCode } from "@/utils/dxfUtils";
import { type EnabledOpenScadExportFormat } from "@/lib/openScadExportFormats";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BufferGeometry, Group } from "three";
import { parseColoredOff } from "@/utils/offParser";
import { inspectParsedColoredOff, type OffColorInspection } from "@/utils/offColorInspector";
import { extractFeatureEdgeTopology, type FeatureEdge } from "@/lib/featureEdgeTopology";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { buildGeometryFromPreparedStl, type PreparedStlGeometry, type StlWorkerTimings } from "@/utils/preparedStlGeometry";
import type { PreparedOffMesh } from "@/utils/preparedOffMesh";
import { exportStlAsThreeMf } from "@/utils/threeMfExport";
import { exportColoredOffAsOrcaThreeMf } from "@/utils/orcaThreeMfExport";
import { exportColoredOffAsOrcaPartsThreeMf } from "@/utils/orcaSplitSafeThreeMf";
import {
  buildColoredGroupFromOff,
  buildColoredGroupFromPreparedOff,
  disposeColoredGroup,
} from "@/utils/coloredOffMesh";

export type LocalOpenScadPreviewExportState = {
  project: OpenScadProject;
  output?: Blob;
  isCompiling: boolean;
  exportDxf: DxfExporter;
  exportFormat: (format: EnabledOpenScadExportFormat) => Promise<Blob>;
};

export function LocalOpenScadPreview({
  project,
  assets,
  onExportStateChange,
  constrained = false,
  experimentalEnabled = false,
  experimentalFastPreview = false,
}: {
  project: OpenScadProject;
  assets: Record<string, Blob>;
  onExportStateChange?: (state: LocalOpenScadPreviewExportState) => void;
  constrained?: boolean;
  experimentalEnabled?: boolean;
  experimentalFastPreview?: boolean;
}) {
  const {
    compileProject,
    cancelPreview,
    isPreviewCancelled,
    previewCompileDurationMs,
    exportProject,
    writeFile,
    isCompiling,
    output,
    offOutput,
    error,
    isError,
  } = useOpenSCAD();
  const isMobile = useIsMobile();
  const failure = isError ? describeOpenScadFailure(error) : null;
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [stlTimings, setStlTimings] = useState<{
    worker: StlWorkerTimings;
    attachMs: number;
  } | null>(null);
  const [coloredGroup, setColoredGroup] = useState<Group | null>(null);
  const [featureEdges, setFeatureEdges] = useState<FeatureEdge[]>([]);
  const [offInspection, setOffInspection] = useState<OffColorInspection | null>(null);
  const [meshTimings, setMeshTimings] = useState<{
    workerTotalMs: number;
    workerBuffersMs: number;
    uiAttachMs: number;
  } | null>(null);
  const mountedGroupRef = useRef<Group | null>(null);
  const mountedGeometryRef = useRef<BufferGeometry | null>(null);
  const previousFastPreviewRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // Only the explicitly selected Experimental fast mode may interrupt an
    // in-flight compile. Normal previews keep their existing request lifecycle.
    // When turning fast mode off, cancel its last compile before restoring
    // the standard full STL+OFF output.
    if (experimentalFastPreview || previousFastPreviewRef.current) {
      cancelPreview();
    }
    previousFastPreviewRef.current = experimentalFastPreview;

    const renderLatestProject = async () => {
      try {
        for (const asset of project.assets ?? []) {
          const blob = assets[asset.path];
          if (!blob)
            throw new Error(`Missing local model asset: ${asset.path}`);
          if (cancelled) return;
          await writeFile(asset.path, blob);
        }
        if (!cancelled) {
          await compileProject(project, {
            includeColorData: experimentalFastPreview ? false : undefined,
          });
        }
      } catch (cause) {
        if (!cancelled) {
          console.error("[Gallery preview] Could not compile OpenSCAD project:", cause);
        }
      }
    };

    // Merge rapid parameter commits before they reach the expensive WASM
    // worker. An outdated active fast preview is terminated above rather than
    // occupying the queue for each intermediate slider value.
    const timer = experimentalFastPreview
      ? globalThis.setTimeout(() => { void renderLatestProject(); }, 160)
      : null;
    if (timer === null) void renderLatestProject();
    return () => {
      cancelled = true;
      if (timer !== null) globalThis.clearTimeout(timer);
    };
  }, [assets, cancelPreview, compileProject, experimentalFastPreview, project, writeFile]);

  useEffect(() => {
    setStlTimings(null);
    if (!(output instanceof Blob)) {
      mountedGeometryRef.current?.dispose();
      mountedGeometryRef.current = null;
      setGeometry(null);
      return;
    }
    let cancelled = false;
    let stlWorker: Worker | null = null;

    const showGeometry = (next: BufferGeometry) => {
      if (cancelled) {
        next.dispose();
        return;
      }
      mountedGeometryRef.current?.dispose();
      mountedGeometryRef.current = next;
      setGeometry(next);
    };
    const parseOnMainThread = (buffer: ArrayBuffer) => {
      if (cancelled) return;
      try {
        const next = new STLLoader().parse(buffer);
        next.center();
        next.computeVertexNormals();
        showGeometry(next);
      } catch (cause) {
        console.error("[Gallery preview] Could not parse OpenSCAD output:", cause);
      }
    };
    const recoverWithMainThread = (cause: unknown) => {
      if (cancelled) return;
      console.warn("[Gallery preview] Experimental STL worker unavailable; falling back:", cause);
      // The original Blob was not transferred and remains available for
      // recovery and all unchanged STL/SCAD/3MF export paths.
      void output.arrayBuffer().then(parseOnMainThread).catch((error: unknown) => {
        if (!cancelled) console.error("[Gallery preview] STL fallback failed:", error);
      });
    };

    void output.arrayBuffer().then((buffer) => {
      if (cancelled) return;
      if (!experimentalEnabled || typeof Worker === "undefined") {
        parseOnMainThread(buffer);
        return;
      }
      try {
        const worker = new Worker(
          new URL("../../worker/stlGeometryWorker.ts", import.meta.url),
          { type: "module" },
        );
        stlWorker = worker;
        let settled = false;
        worker.onmessage = (event: MessageEvent<{
          ok: boolean;
          prepared?: PreparedStlGeometry;
          timings?: StlWorkerTimings;
          error?: string;
        }>) => {
          if (cancelled || settled) return;
          settled = true;
          worker.terminate();
          stlWorker = null;
          const result = event.data;
          if (!result.ok || !result.prepared || !result.timings) {
            recoverWithMainThread(new Error(result.error ?? "STL worker returned invalid data"));
            return;
          }
          try {
            const start = performance.now();
            const next = buildGeometryFromPreparedStl(result.prepared);
            const attachMs = performance.now() - start;
            showGeometry(next);
            if (!cancelled) setStlTimings({ worker: result.timings, attachMs });
          } catch (cause) {
            recoverWithMainThread(cause);
          }
        };
        worker.onerror = (event) => {
          if (cancelled || settled) return;
          settled = true;
          event.preventDefault();
          worker.terminate();
          stlWorker = null;
          recoverWithMainThread(new Error(event.message || "STL worker crashed"));
        };
        worker.onmessageerror = () => {
          if (cancelled || settled) return;
          settled = true;
          worker.terminate();
          stlWorker = null;
          recoverWithMainThread(new Error("STL worker returned unreadable geometry"));
        };
        worker.postMessage({ buffer }, [buffer]);
      } catch (cause) {
        recoverWithMainThread(cause);
      }
    }).catch((cause: unknown) => {
      if (!cancelled) console.error("[Gallery preview] Could not read OpenSCAD STL output:", cause);
    });
    return () => {
      cancelled = true;
      stlWorker?.terminate();
    };
  }, [output, experimentalEnabled]);

  useEffect(() => {
    setMeshTimings(null);
    if (!(offOutput instanceof Blob)) {
      if (mountedGroupRef.current) disposeColoredGroup(mountedGroupRef.current);
      mountedGroupRef.current = null;
      setColoredGroup(null);
      setFeatureEdges([]);
      setOffInspection(null);
      return;
    }
    let cancelled = false;
    let analysisWorker: Worker | null = null;
    const applyGroup = (
      group: Group | null,
      inspection: OffColorInspection,
      snapEdges: FeatureEdge[],
    ) => {
      if (cancelled) {
        if (group) disposeColoredGroup(group);
        return;
      }
      if (mountedGroupRef.current) disposeColoredGroup(mountedGroupRef.current);
      mountedGroupRef.current = group;
      setColoredGroup(group);
      setOffInspection(inspection);
      setFeatureEdges(snapEdges.length <= 15_000 ? snapEdges : []);
    };
    const applyAnalysis = (
      text: string,
      parsed: ReturnType<typeof parseColoredOff>,
      inspection: OffColorInspection,
      snapEdges: FeatureEdge[],
    ) => {
      if (cancelled) return;
      applyGroup(buildColoredGroupFromOff(text, 0x00a6ff, parsed), inspection, snapEdges);
    };
    const applyPreparedAnalysis = (
      prepared: PreparedOffMesh,
      inspection: OffColorInspection,
      snapEdges: FeatureEdge[],
      timings?: { totalMs: number; bufferMs: number },
    ) => {
      if (cancelled) return;
      const started = performance.now();
      const group = buildColoredGroupFromPreparedOff(prepared, 0x00a6ff);
      const uiAttachMs = performance.now() - started;
      applyGroup(group, inspection, snapEdges);
      if (!cancelled && timings) {
        setMeshTimings({
          workerTotalMs: timings.totalMs,
          workerBuffersMs: timings.bufferMs,
          uiAttachMs,
        });
      }
    };
    const analyzeOnMainThread = (text: string) => {
      if (cancelled) return;
      const parsed = parseColoredOff(text);
      const inspection = inspectParsedColoredOff(parsed);
      const snapEdges = parsed.faces.length <= 40_000
        ? extractFeatureEdgeTopology(parsed).edges
        : [];
      applyAnalysis(text, parsed, inspection, snapEdges);
    };
    void offOutput
      .text()
      .then((text) => {
        if (cancelled) return;
        if (!experimentalEnabled || typeof Worker === "undefined") {
          analyzeOnMainThread(text);
          return;
        }
        // Separate worker per OFF result: terminating it on cleanup cancels
        // expensive superseded analysis, not just its eventual UI update.
        try {
          const worker = new Worker(
            new URL("../../worker/offAnalysisWorker.ts", import.meta.url),
            { type: "module" },
          );
          analysisWorker = worker;
          let settled = false;
          worker.onmessage = (event: MessageEvent<{
            ok: boolean;
            prepared?: PreparedOffMesh;
            inspection?: OffColorInspection;
            edges?: FeatureEdge[];
            timings?: { totalMs: number; bufferMs: number };
            error?: string;
          }>) => {
            if (cancelled || settled) return;
            settled = true;
            worker.terminate();
            analysisWorker = null;
            const data = event.data;
            if (!data.ok || !data.prepared || !data.inspection || !data.edges) {
              reportAnalysisError(new Error(data.error ?? "OFF worker buffer analysis failed."));
              return;
            }
            try {
              applyPreparedAnalysis(data.prepared, data.inspection, data.edges, data.timings);
            } catch (cause) {
              reportAnalysisError(cause);
            }
          };
          worker.onerror = (event) => {
            if (cancelled || settled) return;
            settled = true;
            event.preventDefault();
            worker.terminate();
            analysisWorker = null;
            // The independent STL preview stays usable if experimental color
            // analysis crashes. Never synchronously repeat heavy work on UI.
            reportAnalysisError(new Error(event.message || "OFF analysis worker failed."));
          };
          worker.onmessageerror = () => {
            if (cancelled || settled) return;
            settled = true;
            worker.terminate();
            analysisWorker = null;
            reportAnalysisError(new Error("OFF worker returned unreadable geometry data."));
          };
          worker.postMessage({ text, prepareBuffers: true });
        } catch {
          analyzeOnMainThread(text);
        }
      })
      .catch(reportAnalysisError);
    function reportAnalysisError(cause: unknown) {
      if (cancelled) return;
      if (mountedGroupRef.current) disposeColoredGroup(mountedGroupRef.current);
      mountedGroupRef.current = null;
      // Leave the already compiled STL visible instead of showing stale colors.
      setColoredGroup(null);
      setFeatureEdges([]);
      setOffInspection(null);
      setMeshTimings(null);
      console.error("[Gallery preview] Could not parse color data:", cause);
    }
    return () => {
      cancelled = true;
      analysisWorker?.terminate();
    };
  }, [offOutput, experimentalEnabled]);

  useEffect(
    () => () => {
      if (mountedGroupRef.current) disposeColoredGroup(mountedGroupRef.current);
      mountedGeometryRef.current?.dispose();
    },
    [],
  );

  const exportDxf = useCallback(async () => {
    const entrypoint = getOpenScadEntrypoint(project);
    const projectionProject = replaceOpenScadProjectFileContent(
      project,
      project.entrypointPath,
      createDXFProjectionCode(entrypoint.content),
    );
    return exportProject(projectionProject, "dxf");
  }, [exportProject, project]);

  const exportFormat = useCallback(
    async (format: EnabledOpenScadExportFormat) => {
      if (format === "3mf") {
        if (!output) throw new Error("Compile the model before exporting 3MF.");
        const modelName = getOpenScadEntrypoint(project).path.replace(/\.scad$/i, "") || "model";
        return exportStlAsThreeMf(await output.arrayBuffer(), modelName);
      }
      if (format === "orca3mf") {
        if (!output) throw new Error("Compile the model before exporting Orca color 3MF.");
        const modelName = getOpenScadEntrypoint(project).path.replace(/\.scad$/i, "") || "model";
        // Reuse the exact per-face color output used in the live preview.
        const colors = offOutput ?? await exportProject(project, "off");
        return exportColoredOffAsOrcaThreeMf(await colors.text(), modelName);
      }
      if (format === "orcaparts3mf") {
        if (!output) throw new Error("Compile the model before exporting Orca parts 3MF.");
        const modelName = getOpenScadEntrypoint(project).path.replace(/\.scad$/i, "") || "model";
        const colors = offOutput ?? await exportProject(project, "off");
        return exportColoredOffAsOrcaPartsThreeMf(await colors.text(), modelName);
      }
      if (format === "dxf") return exportDxf();
      if (format === "svg") {
        const entrypoint = getOpenScadEntrypoint(project);
        const projectionProject = replaceOpenScadProjectFileContent(
          project,
          project.entrypointPath,
          createDXFProjectionCode(entrypoint.content),
        );
        return exportProject(projectionProject, "svg");
      }
      return exportProject(project, format);
    },
    [exportDxf, exportProject, offOutput, output, project],
  );

  useEffect(() => {
    onExportStateChange?.({ project, output, isCompiling, exportDxf, exportFormat });
  }, [exportDxf, exportFormat, isCompiling, onExportStateChange, output, project]);

  const entrypoint = getOpenScadEntrypoint(project);
  // Experimental is opt-in and applies to the complete renderable geometry.
  // There is deliberately no SCAD AST mapping or source eligibility gate.
  const visualEditAllowed = experimentalEnabled;
  const fastStlOnly = experimentalEnabled && experimentalFastPreview;
  return (
    <section
      className={`relative flex h-full flex-col overflow-hidden rounded-xl border border-adam-neutral-700 bg-adam-neutral-800 ${constrained ? "min-h-0" : "min-h-[22rem]"}`}
      aria-label="3D model preview"
    >
      <div className="absolute left-3 top-3 z-10 rounded-md border border-white/10 bg-black/45 px-2.5 py-1.5 font-mono text-[10px] text-white/75">
        {entrypoint.path}
      </div>
      {(geometry || (!fastStlOnly && coloredGroup)) && (
        <div className="min-h-0 flex-1">
          <ThreeScene
            geometry={geometry}
            coloredGroup={fastStlOnly ? null : coloredGroup}
            featureEdges={fastStlOnly ? [] : featureEdges}
            visualEditAllowed={visualEditAllowed}
            color="#00A6FF"
            isMobile={isMobile}
          />
        </div>
      )}
      {offInspection && !fastStlOnly && (
        <details className="z-10 shrink-0 border-t border-white/15 bg-adam-neutral-800 text-adam-text-primary" data-testid="off-component-inspector">
          <summary className="flex min-h-10 cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-xs font-medium">
            Parts & colors
            <span className="text-adam-neutral-300">
              {offInspection.triangleCount.toLocaleString()} triangles / {offInspection.palette.length} RGB colors /
              {offInspection.topology === "inspected" ? offInspection.components.length + " connected shells" : "topology skipped"}
            </span>
          </summary>
          <div className="max-h-52 space-y-2 overflow-y-auto px-3 pb-3 text-xs">
            <p className="text-adam-neutral-300">Shells reflect connected triangles, not OpenSCAD objects. Closed edges do not prove printability.</p>
            {offInspection.topology === "skipped-for-complexity" ? (
              <p role="status">Complex mesh: only raw RGB palette is inspected.</p>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2" aria-label="Mesh shells">
                {offInspection.components.slice(0, 40).map((part) => (
                  <li key={part.index} className="rounded border border-white/10 p-1.5">
                    <strong>Shell {part.index}</strong>: {part.edgeClosed ? "edge-closed" : "open / non-manifold"}
                    {" / "}{part.triangleCount} triangles / {part.palette.length} RGB
                  </li>
                ))}
                {offInspection.components.length > 40 && <li>{offInspection.components.length - 40} further shells not shown</li>}
              </ul>
            )}
            <div className="flex flex-wrap gap-1.5" aria-label="RGB palette">
              {offInspection.palette.slice(0, 96).map((color) => (
                <span key={color.hex} className="inline-flex items-center gap-1 rounded border border-white/15 px-1.5 py-1">
                  <span className="h-3 w-3 shrink-0 rounded-sm border border-white/25" style={{ backgroundColor: color.hex }} aria-hidden="true" />
                  {color.hex} ({color.triangleCount})
                </span>
              ))}
              {offInspection.palette.length > 96 && <span>{offInspection.palette.length - 96} further RGB colors not shown</span>}
              {offInspection.uncoloredTriangles > 0 && <span className="rounded border border-white/15 px-1.5 py-1">Uncolored ({offInspection.uncoloredTriangles})</span>}
            </div>
          </div>
        </details>
      )}
      {experimentalEnabled && experimentalFastPreview && !isCompiling && output instanceof Blob && (
        <p
          className="z-10 shrink-0 border-t border-amber-400/25 bg-adam-neutral-800 px-3 py-2 text-xs text-amber-200"
          role="status"
          data-testid="fast-preview-color-notice"
        >
          Fast STL preview: model colors and parts inspection are hidden.
          Orca Color export builds full color data on demand.
        </p>
      )}
      {experimentalEnabled && !isCompiling && output instanceof Blob && (
        <PreviewDiagnostics
          durationMs={previewCompileDurationMs}
          stlBytes={output.size}
          offBytes={offOutput instanceof Blob ? offOutput.size : null}
          triangleCount={fastStlOnly ? null : (offInspection?.triangleCount ?? null)}
          topology={fastStlOnly ? null : (offInspection?.topology ?? null)}
          meshTimings={meshTimings}
          stlTimings={stlTimings}
        />
      )}
      {isCompiling && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/45 p-4 backdrop-blur-sm">
          <ActivityIndicator label="Compiling model" size="lg" />
          <button
            type="button"
            aria-label="Cancel preview"
            className="min-h-11 rounded-md border border-white/30 bg-adam-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-adam-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue"
            onClick={cancelPreview}
          >
            Cancel preview
          </button>
        </div>
      )}
      {!isCompiling && !geometry && !coloredGroup && (
        <div className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center ${constrained ? "" : "min-h-[22rem] sm:p-8"}`}>
          {isError ? (
            <AlertTriangle className="h-7 w-7 text-amber-400" />
          ) : (
            <RefreshCw className="h-6 w-6 animate-spin text-adam-neutral-400" />
          )}
          {isPreviewCancelled ? (
            <div role="status" className="max-w-lg space-y-3 text-sm text-adam-neutral-300">
              <p className="font-semibold text-adam-text-primary">Preview cancelled</p>
              <p>The OpenSCAD worker was stopped. You can retry without reopening the model.</p>
              <button
                type="button"
                className="min-h-11 rounded-md border border-white/25 px-4 py-2 font-medium"
                onClick={() => void compileProject(project)}
              >
                Retry preview
              </button>
            </div>
          ) : failure ? (
            <div role="alert" className="max-w-lg space-y-2 text-sm text-adam-neutral-300">
              <p className="font-semibold text-adam-text-primary">{failure.title}</p>
              <p>{failure.message}</p>
              {failure.diagnostics && (
                <details className="text-left">
                  <summary className="cursor-pointer">Compiler details</summary>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {failure.diagnostics}
                  </pre>
                </details>
              )}
              {failure.canRetry && (
                <button
                  type="button"
                  className="rounded-md border border-white/25 px-3 py-2 font-medium"
                  onClick={() => void compileProject(project)}
                >
                  Retry preview
                </button>
              )}
            </div>
          ) : (
            <p role="status" className="max-w-lg text-sm text-adam-neutral-300">
              Preparing model preview…
            </p>
          )}
        </div>
      )}
    </section>
  );
}
