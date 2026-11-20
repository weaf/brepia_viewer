import type { ParsedOff } from "@/utils/offParser";
import { connectedClosedShells } from "@/utils/orcaSplitSafeThreeMf";
import {
  discoverScadModuleCalls,
  excludeScadSourceCall,
  type SourceMoveCall,
  type SourceMoveMatch,
  matchSourceProbeToPart,
} from "@/lib/sourceMoveProvenance";

export type SourceMoveVector = readonly [number, number, number];
export type SourceMoveCandidate = { call: SourceMoveCall; instanceIndex?: number };
export type SourceMoveProgress = { done: number; total: number; label: string };
export type SourceMoveSearch = {
  status: "matched" | "not-found" | "ambiguous" | "too-complex";
  candidate?: SourceMoveCandidate;
  tested: number;
  total: number;
};

const MAX_PROBES = 12;
const MAX_INSTANCES = 10;
const MAX_FACES = 250_000;
const ROUND = 100; // OFF output has limited decimal precision.

/** A bounded, generic list. Reused source modules and inactive loops must be probed. */
export function sourceMoveCandidates(source: string, partCount: number): SourceMoveCandidate[] {
  const discovery = discoverScadModuleCalls(source);
  if (discovery.status !== "available") return [];
  const entries: SourceMoveCandidate[] = [];
  for (const call of [...discovery.calls].reverse()) {
    if (call.loopVariable) {
      for (let i = 0; i < Math.min(MAX_INSTANCES, partCount); i += 1) {
        entries.push({ call, instanceIndex: i });
      }
    } else entries.push({ call });
  }
  return entries;
}

/**
 * Probes temporary source copies; does not save to the library. Verifies the
 * entire rendered OFF result: exactly the requested shell must disappear.
 */
export async function findSourceMoveCandidate({
  source, baseline, targetPart, partCount, compile, signal, onProgress,
}: {
  source: string;
  baseline: ParsedOff;
  targetPart: number;
  partCount: number;
  compile: (candidateSource: string) => Promise<ParsedOff>;
  signal?: AbortSignal;
  onProgress?: (progress: SourceMoveProgress) => void;
}): Promise<SourceMoveSearch> {
  if (baseline.faces.length === 0 || baseline.faces.length > MAX_FACES) {
    return { status: "too-complex", tested: 0, total: 0 };
  }
  const all = sourceMoveCandidates(source, partCount);
  if (all.length === 0) return { status: "not-found", tested: 0, total: 0 };
  const toCheck = all.slice(0, MAX_PROBES);
  let tested = 0;
  for (const candidate of toCheck) {
    if (signal?.aborted) throw new DOMException("Source analysis cancelled", "AbortError");
    onProgress?.({
      done: tested, total: toCheck.length,
      label: candidate.call.name + (candidate.instanceIndex === undefined ? "" : "(" + candidate.instanceIndex + ")"),
    });
    try {
      const probe = excludeScadSourceCall(source, candidate.call, candidate.instanceIndex);
      const result = await compile(probe);
      if (signal?.aborted) throw new DOMException("Source analysis cancelled", "AbortError");
      const match: SourceMoveMatch = matchSourceProbeToPart(baseline, result);
      if (match.status === "matched" && match.partIndex === targetPart) {
        // The complete post-apply OFF comparison is the decisive correctness
        // gate; do not spend minutes recompiling other candidate calls.
        tested += 1;
        onProgress?.({done:tested,total:toCheck.length,label:"Verified"});
        return {status:"matched",candidate,tested,total:all.length};
      }
    } catch (cause) {
      if (signal?.aborted) throw new DOMException("Source analysis cancelled", "AbortError");
      // A model may be invalid under this temporary exclusion. Other probes
      // remain meaningful; never infer a mapping from a failed compilation.
      console.info("[Source Move] Source probe skipped:", candidate.call.id, cause);
    }
    tested += 1;
  }
  onProgress?.({ done: tested, total: toCheck.length, label: "Done" });
  return { status: "not-found", tested, total: all.length };
}

function numericCoordinate(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > 100_000) {
    throw new Error("Source Move requires finite offsets within 100 m.");
  }
  // Fixed precision avoids huge scientific notation and unstable tiny deltas.
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** Local temporary rewrite, awaiting a geometrically verified preview. */
export function writeSourceMoveTranslation(
  source: string,
  candidate: SourceMoveCandidate,
  delta: SourceMoveVector,
): string {
  if (delta.every(value => Math.abs(value) < 0.00001)) {
    throw new Error("Move the selected part before applying the translation.");
  }
  const translation = "translate([" + delta.map(numericCoordinate).join(", ") + "]) ";
  const { call, instanceIndex } = candidate;
  // Always revalidate against current content and identify the exact site.
  excludeScadSourceCall(source, call, instanceIndex);
  if (!call.loopVariable) {
    return source.slice(0, call.start) + translation + source.slice(call.start);
  }
  if (instanceIndex === undefined) throw new Error("Missing loop instance.");
  const afterCall = call.start + call.callText.length;
  const rest = source.slice(afterCall);
  const semicolon = /^\s*;/.exec(rest);
  if (!semicolon) throw new Error("Loop module call is not a standalone statement.");
  const guarded = "if (" + call.loopVariable + " == " + instanceIndex + ") " +
    translation + call.callText + "; else " + call.callText + ";";
  return source.slice(0, call.start) + guarded + source.slice(afterCall + semicolon[0].length);
}

function polygonKey(off: ParsedOff, faceIndex: number, delta: SourceMoveVector): string {
  return off.faces[faceIndex].vertices.map(i => {
    const v = off.vertices[i];
    return v.map((n, axis) => Math.round((n + delta[axis]) * ROUND)).join(",");
  }).sort().join("|");
}

function countFaces(off: ParsedOff, moved?: Set<number>, delta: SourceMoveVector = [0,0,0]) {
  const counter = new Map<string,number>();
  for (let i = 0; i < off.faces.length; i += 1) {
    const key = polygonKey(off,i,moved?.has(i) ? delta : [0,0,0]);
    counter.set(key,(counter.get(key) ?? 0)+1);
  }
  return counter;
}

/** Real post-compile verification: every triangle, not just a bounding box. */
export function verifySourceMoveTranslation(
  original: ParsedOff,
  translated: ParsedOff,
  partIndex: number,
  delta: SourceMoveVector,
): boolean {
  if (original.faces.length !== translated.faces.length ||
      original.faces.length === 0 || original.faces.length > MAX_FACES) return false;
  const shells = connectedClosedShells(original);
  const shell = shells[partIndex];
  if (!shell || shell.faceIndices.length === 0) return false;
  const expected = countFaces(original, new Set(shell.faceIndices), delta);
  const actual = countFaces(translated);
  if (expected.size !== actual.size) return false;
  for (const [key, count] of expected) if (actual.get(key) !== count) return false;
  return true;
}

/** Reject silent matching to the wrong geometry when a caller reuses a stale selection. */
export function candidateIsCurrent(source: string, candidate: SourceMoveCandidate): boolean {
  const found = discoverScadModuleCalls(source);
  return found.status === "available" &&
    found.calls.some(call => call.id === candidate.call.id &&
      call.callText === candidate.call.callText &&
      call.sourceFingerprint === candidate.call.sourceFingerprint);
}
