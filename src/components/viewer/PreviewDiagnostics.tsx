import { formatPreviewBytes, formatPreviewDuration } from "@/lib/previewDiagnostics";

type PreviewDiagnosticsProps = {
  durationMs: number | null;
  stlBytes: number;
  offBytes: number | null;
  triangleCount: number | null;
  topology: "inspected" | "skipped-for-complexity" | null;
  meshTimings?: { workerTotalMs: number; workerBuffersMs: number; uiAttachMs: number } | null;
};

/** Display-only; gated by the existing Experimental opt-in in the caller. */
export function PreviewDiagnostics({
  durationMs, stlBytes, offBytes, triangleCount, topology, meshTimings,
}: PreviewDiagnosticsProps) {
  return (
    <details
      data-testid="experimental-preview-diagnostics"
      className="z-10 shrink-0 border-t border-white/15 bg-adam-neutral-800 text-adam-text-primary"
    >
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue">
        Preview diagnostics
        <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[10px] font-normal text-amber-200">
          Experimental
        </span>
      </summary>
      <div className="max-h-40 overflow-y-auto px-3 pb-3 text-xs">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2" aria-label="Preview performance statistics">
          <div>
            <dt className="text-adam-neutral-400">OpenSCAD render</dt>
            <dd className="mt-0.5 font-mono" data-testid="preview-render-duration">{formatPreviewDuration(durationMs)}</dd>
          </div>
          <div>
            <dt className="text-adam-neutral-400">STL size</dt>
            <dd className="mt-0.5 font-mono">{formatPreviewBytes(stlBytes)}</dd>
          </div>
          <div>
            <dt className="text-adam-neutral-400">OFF size</dt>
            <dd className="mt-0.5 font-mono">{formatPreviewBytes(offBytes)}</dd>
          </div>
          <div>
            <dt className="text-adam-neutral-400">Triangles</dt>
            <dd className="mt-0.5 font-mono" data-testid="preview-triangle-count">
              {triangleCount === null ? "Analyzing…" : triangleCount.toLocaleString()}
            </dd>
          </div>
          {meshTimings && (
            <>
              <div>
                <dt className="text-adam-neutral-400">OFF worker</dt>
                <dd className="mt-0.5 font-mono" data-testid="preview-off-worker-duration">{formatPreviewDuration(meshTimings.workerTotalMs)}</dd>
              </div>
              <div>
                <dt className="text-adam-neutral-400">Worker buffers</dt>
                <dd className="mt-0.5 font-mono" data-testid="preview-off-buffer-duration">{formatPreviewDuration(meshTimings.workerBuffersMs)}</dd>
              </div>
              <div>
                <dt className="text-adam-neutral-400">Three.js attach</dt>
                <dd className="mt-0.5 font-mono" data-testid="preview-ui-mesh-duration">{formatPreviewDuration(meshTimings.uiAttachMs)}</dd>
              </div>
            </>
          )}
        </dl>
        {topology === "skipped-for-complexity" && (
          <p role="status" className="mt-2 text-amber-200">
            Detailed shell analysis was skipped for this larger model.
          </p>
        )}
        <p className="mt-2 leading-relaxed text-adam-neutral-400">
          OpenSCAD render time excludes model download, initial worker setup and browser mesh parsing.
          OFF worker and Three.js attach times measure mesh preparation and synchronous object setup,
          not browser paint or STL decoding. File sizes measure generated preview data, not RAM usage.
        </p>
      </div>
    </details>
  );
}
