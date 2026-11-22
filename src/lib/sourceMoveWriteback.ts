import type { ParsedOff } from "@/utils/offParser";
import { connectedClosedShells } from "@/utils/orcaSplitSafeThreeMf";
import {
  discoverScadModuleCalls,
  excludeScadSourceCall,
  maskScadNonCode,
  type SourceMoveCall,
  type SourceMoveMatch,
  matchSourceProbeToPart,
} from "@/lib/sourceMoveProvenance";

export type SourceMoveVector = readonly [number, number, number];
export type SourceMoveCandidate = { call: SourceMoveCall; instanceIndex?: number };
export type SourceMoveProgress = { done: number; total: number; label: string };
export type SourceMoveSearch = {
  status: "matched" | "not-found" | "ambiguous" | "too-complex" | "budget-exhausted" | "probe-failed";
  candidate?: SourceMoveCandidate;
  tested: number;
  total: number;
  failed: number;
  error?: string;
};

const MAX_PROBES = 12;
const MAX_INSTANCES = 10;
const MAX_FACES = 250_000;
const ROUND = 100; // OFF output has limited decimal precision.

/**
 * Distinguish calls in the entrypoint's main render flow from calls inside
 * module definitions. OpenSCAD modules can contain many helper calls, none of
 * which may be active in a given configuration. This is a probe priority, not
 * proof of ownership: only OFF comparison can establish a match.
 */
function moduleBodyRanges(source: string): Array<{ name: string; start: number; end: number }> {
  const clean = maskScadNonCode(source);
  const ranges: Array<{ name: string; start: number; end: number }> = [];
  for (const match of clean.matchAll(/\bmodule\s+[A-Za-z_]\w*\s*\(/g)) {
    const openParen = clean.indexOf("(", match.index);
    let cursor = openParen;
    let parens = 0;
    for (; cursor < clean.length; cursor += 1) {
      if (clean[cursor] === "(") parens += 1;
      else if (clean[cursor] === ")") {
        parens -= 1;
        if (parens === 0) { cursor += 1; break; }
      }
    }
    if (parens !== 0) continue;
    while (cursor < clean.length && /\s/.test(clean[cursor])) cursor += 1;
    // Braced module bodies can be classified safely. For unbraced module
    // definitions, retain the existing conservative geometry-based fallback.
    if (clean[cursor] !== "{") continue;
    const bodyStart = cursor;
    let braces = 0;
    for (; cursor < clean.length; cursor += 1) {
      if (clean[cursor] === "{") braces += 1;
      else if (clean[cursor] === "}") {
        braces -= 1;
        if (braces === 0) {
          ranges.push({ name: match[0].split(/\s+/)[1].split("(")[0], start: bodyStart, end: cursor });
          break;
        }
      }
    }
  }
  return ranges;
}

/** Fairly distribute loop instances instead of using the whole probe budget on one site. */
function expandCalls(calls: readonly SourceMoveCall[], partCount: number): SourceMoveCandidate[] {
  const limits = calls.map(call => call.loopVariable ? Math.min(MAX_INSTANCES, partCount) : 1);
  const entries: SourceMoveCandidate[] = [];
  for (let instance = 0; instance < Math.max(0, ...limits); instance += 1) {
    calls.forEach((call, index) => {
      if (instance < limits[index]) {
        entries.push(call.loopVariable ? { call, instanceIndex: instance } : { call });
      }
    });
  }
  return entries;
}

/**
 * Try entrypoint calls first, then breadth-first descendants of those
 * calls, then unreachable nested helpers. Every site is still checked against
 * the complete OFF mesh. Never associate a part based on name or order alone.
 */
export function sourceMoveCandidates(source: string, partCount: number): SourceMoveCandidate[] {
  const discovery = discoverScadModuleCalls(source);
  if (discovery.status !== "available") return [];
  const ranges = moduleBodyRanges(source);
  const roots: SourceMoveCall[] = [];
  const byOwner = new Map<string, SourceMoveCall[]>();
  for (const call of discovery.calls) {
    // Prefer the smallest containing definition if a source nests modules.
    const owner = ranges
      .filter(range => call.start > range.start && call.start < range.end)
      .sort((a,b) => (a.end-a.start)-(b.end-b.start))[0];
    if (!owner) roots.push(call);
    else {
      const owned = byOwner.get(owner.name) ?? [];
      owned.push(call);
      byOwner.set(owner.name,owned);
    }
  }
  // Traverse source call ownership breadth-first. Interleave sibling module
  // bodies to avoid spending the entire probe budget on one *inactive*
  // dispatcher branch. Every candidate still needs a real exclusion proof.
  const levels: SourceMoveCall[][] = [roots];
  const visited = new Set(roots.map(call => call.id));
  let frontier = roots;
  for (let depth=0; depth<12 && frontier.length; depth+=1) {
    const buckets = frontier.map(call => byOwner.get(call.name) ?? []);
    const next: SourceMoveCall[] = [];
    for (let index=0; index<Math.max(0,...buckets.map(bucket=>bucket.length)); index+=1) {
      for (const bucket of buckets) {
        const call=bucket[index];
        if(call && !visited.has(call.id)) {
          visited.add(call.id);
          next.push(call);
        }
      }
    }
    if(!next.length) break;
    levels.push(next);
    frontier=next;
  }
  const unused = discovery.calls.filter(call => !visited.has(call.id));
  return [
    ...levels.flatMap(level => expandCalls(level,partCount)),
    ...expandCalls(unused.filter(call=>Boolean(call.loopVariable)),partCount),
    ...expandCalls(unused.filter(call=>!call.loopVariable),partCount),
  ];
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
    return { status: "too-complex", tested: 0, total: 0, failed: 0 };
  }
  const all = sourceMoveCandidates(source, partCount);
  if (all.length === 0) return { status: "not-found", tested: 0, total: 0, failed: 0 };
  const toCheck = all.slice(0, MAX_PROBES);
  let tested = 0;
  let failed = 0;
  let firstError: string | undefined;
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
        onProgress?.({done:tested,total:toCheck.length,label:"Source candidate matched"});
        return {status:"matched",candidate,tested,total:all.length,failed};
      }
    } catch (cause) {
      if (signal?.aborted) throw new DOMException("Source analysis cancelled", "AbortError");
      // A model may be invalid under this temporary exclusion. Other probes
      // remain meaningful; never infer a mapping from a failed compilation.
      failed += 1;
      if (firstError === undefined) firstError = cause instanceof Error ? cause.message : String(cause);
      console.info("[Source Move] Source probe skipped:", candidate.call.id, cause);
    }
    tested += 1;
  }
  onProgress?.({ done: tested, total: toCheck.length, label: "Done" });
  return {
    status: tested === failed ? "probe-failed" : all.length > tested ? "budget-exhausted" : "not-found",
    tested, total: all.length, failed, error: firstError,
  };
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

/**
 * Failure-only diagnostics for a real OpenSCAD recompile. These numbers do
 * not relax the fail-closed verification gate: the caller must still use
 * verifySourceMoveTranslation before any persistent change.
 */
export function diagnoseSourceMoveTranslation(
  original: ParsedOff,
  translated: ParsedOff,
  partIndex: number,
  delta: SourceMoveVector,
): {
  beforeFaces: number;
  afterFaces: number;
  selectedShellFaces: number | null;
  missingExpectedFaces: number;
  extraActualFaces: number;
  expectedDistinctFaces: number;
  actualDistinctFaces: number;
  firstMissingFace: string | null;
  firstExtraFace: string | null;
  matchingAtCoarserResolution: boolean;
} {
  const empty = {
    beforeFaces: original.faces.length, afterFaces: translated.faces.length,
    selectedShellFaces: null, missingExpectedFaces: 0, extraActualFaces: 0,
    expectedDistinctFaces: 0, actualDistinctFaces: 0,
    firstMissingFace: null, firstExtraFace: null,
    matchingAtCoarserResolution: false,
  };
  if (original.faces.length > MAX_FACES || translated.faces.length > MAX_FACES) return empty;
  const shell = connectedClosedShells(original)[partIndex];
  if (!shell) return empty;
  const selected = new Set(shell.faceIndices);
  const expected = countFaces(original, selected, delta);
  const actual = countFaces(translated);
  let missing = 0;
  let extra = 0;
  let firstMissingFace: string | null = null;
  let firstExtraFace: string | null = null;
  for (const [key, count] of expected) {
    const deficit = count - (actual.get(key) ?? 0);
    if (deficit > 0) {
      missing += deficit;
      firstMissingFace ??= key;
    }
  }
  for (const [key, count] of actual) {
    const surplus = count - (expected.get(key) ?? 0);
    if (surplus > 0) {
      extra += surplus;
      firstExtraFace ??= key;
    }
  }
  // A coarse diagnostic is informative only; never use it to accept a save.
  const coarse = (off: ParsedOff, afterMove: boolean) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < off.faces.length; i += 1) {
      const moved = !afterMove && selected.has(i);
      const key = off.faces[i].vertices.map(index => {
        const v = off.vertices[index];
        return v.map((value, axis) =>
          Math.round((value + (moved ? delta[axis] : 0)) * 10),
        ).join(",");
      }).sort().join("|");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const coarseBefore = coarse(original, false);
  const coarseAfter = coarse(translated, true);
  const matchingAtCoarserResolution = coarseBefore.size === coarseAfter.size &&
    [...coarseBefore].every(([key, count]) => coarseAfter.get(key) === count);
  return {
    ...empty, selectedShellFaces: shell.faceIndices.length,
    missingExpectedFaces: missing, extraActualFaces: extra,
    expectedDistinctFaces: expected.size, actualDistinctFaces: actual.size,
    firstMissingFace, firstExtraFace, matchingAtCoarserResolution,
  };
}

/** Reject silent matching to the wrong geometry when a caller reuses a stale selection. */
export function candidateIsCurrent(source: string, candidate: SourceMoveCandidate): boolean {
  const found = discoverScadModuleCalls(source);
  return found.status === "available" &&
    found.calls.some(call => call.id === candidate.call.id &&
      call.callText === candidate.call.callText &&
      call.sourceFingerprint === candidate.call.sourceFingerprint);
}
