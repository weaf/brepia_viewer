import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getOpenScadEntrypoint, replaceOpenScadProjectFileContent, type OpenScadProject } from "@shared/openScadProject";
import { parseColoredOff } from "@/utils/offParser";
import {
  candidateIsCurrent, findSourceMoveCandidate, verifySourceMoveTranslation,
  writeSourceMoveTranslation, type SourceMoveCandidate, type SourceMoveVector,
} from "@/lib/sourceMoveWriteback";

export type SelectedSourceMove = { partIndex: number; offset: SourceMoveVector };

export function SourceMovePanel({
  project, offOutput, selected, partCount, isCompiling,
  previewProjectColored, onApplySourceMove,
}: {
  project: OpenScadProject;
  offOutput?: Blob;
  selected: SelectedSourceMove | null;
  partCount: number;
  isCompiling: boolean;
  previewProjectColored: (project: OpenScadProject) => Promise<{ stl: Blob; off: Blob | undefined }>;
  onApplySourceMove: (path: string, content: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"identify" | "apply" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [matched, setMatched] = useState<SourceMoveCandidate | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const current = useRef({ project, offOutput, selected });
  current.current = { project, offOutput, selected };

  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    setMatched(null);
    setBusy(null);
    setMessage(null);
    setProgress(null);
    return () => {
      generation.current += 1;
      controller.current?.abort();
    };
  }, [project, offOutput, selected?.partIndex]);

  const selectionStillCurrent = useCallback((request: number, targetPart: number) =>
    generation.current === request &&
    current.current.project === project &&
    current.current.offOutput === offOutput &&
    current.current.selected?.partIndex === targetPart,
  [project, offOutput]);

  const compileSource = useCallback(async (source: string) => {
    const testProject = replaceOpenScadProjectFileContent(project, project.entrypointPath, source);
    const result = await previewProjectColored(testProject);
    if (!result.off) throw new Error("OpenSCAD did not produce OFF data for the source probe.");
    return parseColoredOff(await result.off.text());
  }, [previewProjectColored, project]);

  const identify = async () => {
    if (!selected || !offOutput || busy || isCompiling) return;
    const targetPart = selected.partIndex;
    const request = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setMatched(null);
    setBusy("identify");
    setMessage("Comparing OpenSCAD calls against the selected 3D part…");
    setProgress(null);
    try {
      const source = getOpenScadEntrypoint(project).content;
      const baseline = parseColoredOff(await offOutput.text());
      if (!selectionStillCurrent(request,targetPart)) return;
      const result = await findSourceMoveCandidate({
        source, baseline, targetPart, partCount,
        compile: compileSource, signal: abort.signal,
        onProgress: ({done,total,label}) => {
          if (generation.current === request) setProgress(done + "/" + total + ": " + label);
        },
      });
      if (!selectionStillCurrent(request,targetPart)) return;
      if (result.status === "matched" && result.candidate) {
        setMatched(result.candidate);
        setMessage("Matched part " + (targetPart+1) + " to " + result.candidate.call.name +
          "() at line " + result.candidate.call.line + ".");
      } else {
        setMessage(result.status === "ambiguous"
          ? "Several source calls match. Source editing disabled for this part."
          : result.status === "too-complex"
            ? "Model too complex for source matching. Preview Move remains available."
            : "No safe source match among " + result.tested + "/" + result.total +
              " checked candidates. Preview Move still works.");
      }
    } catch (cause) {
      if (!abort.signal.aborted && generation.current === request) {
        setMessage(cause instanceof Error ? cause.message : "Source analysis failed.");
      }
    } finally {
      if (generation.current === request) {
        setBusy(null);
        setProgress(null);
      }
    }
  };

  const hasOffset = Boolean(selected?.offset.some(value => Math.abs(value) >= 0.00001));
  const preview = useMemo(() => {
    if (!matched || !selected || !hasOffset) return null;
    try {
      const source = getOpenScadEntrypoint(project).content;
      if (!candidateIsCurrent(source, matched)) return null;
      const modified = writeSourceMoveTranslation(source, matched, selected.offset);
      const start = matched.call.start;
      const replaceEnd = Math.min(modified.length, start + 200);
      return { modified, snippet: modified.slice(start,replaceEnd).split("\n")[0] };
    } catch {
      return null;
    }
  }, [matched,selected,hasOffset,project]);

  const apply = async () => {
    if (!selected || !matched || !offOutput || !preview || busy || isCompiling) return;
    const targetPart = selected.partIndex;
    const originalOffset = [...selected.offset] as [number,number,number];
    const request = ++generation.current;
    setBusy("apply");
    setMessage("Compiling changed SCAD and checking every mesh face…");
    try {
      const baseline = parseColoredOff(await offOutput.text());
      const modified = await compileSource(preview.modified);
      if (!selectionStillCurrent(request,targetPart)) return;
      if (!verifySourceMoveTranslation(baseline,modified,targetPart,originalOffset)) {
        setMessage("Verification failed: source rendering does not match the 3D move. Nothing saved.");
        return;
      }
      const latestTarget = current.current.selected;
      if (!latestTarget || latestTarget.offset.some((v,i) => Math.abs(v-originalOffset[i])>0.00001)) {
        setMessage("The part moved while verifying. Try Apply again.");
        return;
      }
      await onApplySourceMove(project.entrypointPath,preview.modified);
      if (generation.current === request) setMessage("SCAD updated and verified. Preview will recompile.");
    } catch (cause) {
      if (generation.current === request) {
        setMessage(cause instanceof Error ? cause.message : "Could not verify source change.");
      }
    } finally {
      if (generation.current === request) setBusy(null);
    }
  };

  return (
    <div data-testid="source-move-panel"
      className="z-10 shrink-0 border-t border-cyan-400/25 bg-adam-neutral-800 px-3 py-2 text-xs text-adam-text-primary">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-auto text-cyan-200">Source Move · Experimental</strong>
        <button type="button" aria-label="Identify source of selected part"
          className="min-h-9 rounded-md border border-cyan-400/40 px-3 disabled:opacity-40"
          disabled={!selected || !offOutput || busy !== null || isCompiling}
          onClick={() => void identify()}>
          {busy === "identify" ? "Identifying…" : "Find source"}
        </button>
        <button type="button" aria-label="Apply Part Move to OpenSCAD code"
          className="min-h-9 rounded-md border border-emerald-400/50 px-3 disabled:opacity-40"
          disabled={!preview || busy !== null || isCompiling}
          onClick={() => void apply()}>
          {busy === "apply" ? "Verifying…" : "Apply to code"}
        </button>
      </div>
      <p className="mt-1 text-adam-neutral-300">
        {selected
          ? "Part " + (selected.partIndex+1) + ": X " + selected.offset[0].toFixed(1) +
            " / Y " + selected.offset[1].toFixed(1) + " / Z " + selected.offset[2].toFixed(1) + " mm"
          : "In Move, choose Selected Part and tap a component in 3D."}
      </p>
      {matched && (
        <details className="mt-1">
          <summary className="cursor-pointer text-cyan-200">
            Source: {matched.call.name}() · line {matched.call.line}
          </summary>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-1.5 text-[11px]">
            {preview?.snippet ?? "Move this part in 3D to see the proposed code."}
          </pre>
        </details>
      )}
      {message && <p role="status" className="mt-1 text-cyan-100">{message}</p>}
      {progress && <p className="mt-0.5 font-mono text-adam-neutral-300">{progress}</p>}
    </div>
  );
}
