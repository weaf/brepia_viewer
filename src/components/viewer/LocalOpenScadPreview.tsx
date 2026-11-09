import { ActivityIndicator } from "@/components/brand";
import { ThreeScene } from "@/components/viewer/ThreeScene";
import { describeOpenScadFailure } from "@/lib/openScadFeedback";
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
import { extractFeatureEdgeTopology, type FeatureEdge } from "@/lib/featureEdgeTopology";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { exportStlAsThreeMf } from "@/utils/threeMfExport";
import { exportColoredOffAsOrcaThreeMf } from "@/utils/orcaThreeMfExport";
import { exportColoredOffAsOrcaPartsThreeMf } from "@/utils/orcaSplitSafeThreeMf";
import {
  buildColoredGroupFromOff,
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
}: {
  project: OpenScadProject;
  assets: Record<string, Blob>;
  onExportStateChange?: (state: LocalOpenScadPreviewExportState) => void;
  constrained?: boolean;
}) {
  const {
    compileProject,
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
  const [coloredGroup, setColoredGroup] = useState<Group | null>(null);
  const [featureEdges, setFeatureEdges] = useState<FeatureEdge[]>([]);
  const mountedGroupRef = useRef<Group | null>(null);
  const mountedGeometryRef = useRef<BufferGeometry | null>(null);
  const compileSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    compileSequence.current += 1;

    void (async () => {
      try {
        for (const asset of project.assets ?? []) {
          const blob = assets[asset.path];
          if (!blob)
            throw new Error(`Missing local model asset: ${asset.path}`);
          await writeFile(asset.path, blob);
        }
        if (!cancelled) await compileProject(project);
      } catch (cause) {
        console.error(
          "[Gallery preview] Could not compile OpenSCAD project:",
          cause,
        );
      }
    })();
    return () => {
      cancelled = true;
      compileSequence.current += 1;
    };
  }, [assets, compileProject, project, writeFile]);

  useEffect(() => {
    if (!(output instanceof Blob)) {
      mountedGeometryRef.current?.dispose();
      mountedGeometryRef.current = null;
      setGeometry(null);
      return;
    }
    let cancelled = false;
    void output
      .arrayBuffer()
      .then((buffer) => {
        if (cancelled) return;
        const next = new STLLoader().parse(buffer);
        next.center();
        next.computeVertexNormals();
        mountedGeometryRef.current?.dispose();
        mountedGeometryRef.current = next;
        setGeometry(next);
      })
      .catch((cause: unknown) => {
        console.error(
          "[Gallery preview] Could not parse OpenSCAD output:",
          cause,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [output]);

  useEffect(() => {
    if (!(offOutput instanceof Blob)) {
      if (mountedGroupRef.current) disposeColoredGroup(mountedGroupRef.current);
      mountedGroupRef.current = null;
      setColoredGroup(null);
      setFeatureEdges([]);
      return;
    }
    let cancelled = false;
    void offOutput
      .text()
      .then((text) => {
        if (cancelled) return;
        const parsed = parseColoredOff(text);
        const group = buildColoredGroupFromOff(text, 0x00a6ff, parsed);
        // Stay responsive for unusually large meshes until workerized topology.
        const snapEdges = parsed.faces.length <= 40_000
          ? extractFeatureEdgeTopology(parsed).edges
          : [];
        if (mountedGroupRef.current)
          disposeColoredGroup(mountedGroupRef.current);
        mountedGroupRef.current = group;
        setColoredGroup(group);
        setFeatureEdges(snapEdges.length <= 15_000 ? snapEdges : []);
      })
      .catch((cause: unknown) => {
        setFeatureEdges([]);
        console.error("[Gallery preview] Could not parse color data:", cause);
      });
    return () => {
      cancelled = true;
    };
  }, [offOutput]);

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
  return (
    <section
      className={`relative flex h-full flex-col overflow-hidden rounded-xl border border-adam-neutral-700 bg-adam-neutral-800 ${constrained ? "min-h-0" : "min-h-[22rem]"}`}
      aria-label="3D model preview"
    >
      <div className="absolute left-3 top-3 z-10 rounded-md border border-white/10 bg-black/45 px-2.5 py-1.5 font-mono text-[10px] text-white/75">
        {entrypoint.path}
      </div>
      {(geometry || coloredGroup) && (
        <div className="min-h-0 flex-1">
          <ThreeScene
            geometry={geometry}
            coloredGroup={coloredGroup}
            featureEdges={featureEdges}
            color="#00A6FF"
            isMobile={isMobile}
          />
        </div>
      )}
      {isCompiling && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/35 backdrop-blur-sm">
          <ActivityIndicator label="Compiling model" size="lg" />
        </div>
      )}
      {!isCompiling && !geometry && !coloredGroup && (
        <div className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center ${constrained ? "" : "min-h-[22rem] sm:p-8"}`}>
          {isError ? (
            <AlertTriangle className="h-7 w-7 text-amber-400" />
          ) : (
            <RefreshCw className="h-6 w-6 animate-spin text-adam-neutral-400" />
          )}
          {failure ? (
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
