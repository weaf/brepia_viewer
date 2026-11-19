import { connectedClosedShells } from "@/utils/orcaSplitSafeThreeMf";
import type { ParsedOff } from "@/utils/offParser";

/**
 * Source-aware Move phase 1: identify possible module call sites and prove a
 * rendered shell comes from a call by compiling a temporary exclusion probe.
 * No source mutations are persisted by this module.
 *
 * Conservative by design: imported modules, opaque loops and cases where
 * exclusion affects other geometry are unsupported, not guessed.
 */
export type SourceMoveCall = {
  id: string;
  name: string;
  start: number;
  line: number;
  callText: string;
  sourceFingerprint: string;
  loopVariable: string | null;
};

export type SourceMoveDiscovery =
  | { status: "available"; calls: SourceMoveCall[] }
  | { status: "too-complex"; calls: [] };

export type SourceMoveMatch =
  | { status: "matched"; partIndex: number; removedFaces: number; addedFaces: 0 }
  | { status: "inactive" | "ambiguous" | "unsafe" | "too-complex"; removedFaces: number; addedFaces: number };

const MAX_SOURCE_BYTES = 256_000;
const MAX_CALL_SITES = 256;
const MAX_GEOMETRY_FACES = 250_000;
const QUANTIZATION = 100; // 0.01 mm, tolerate native OFF float serialization.

function sourceFingerprint(source: string): string {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  }
  return source.length + ":" + (hash >>> 0).toString(16);
}

/** Replace comments and quoted strings with spaces without moving source offsets. */
export function maskScadNonCode(source: string): string {
  // Split by UTF-16 code unit: JavaScript string offsets must remain exact, even after emoji.
  const result = source.split("");
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("//", i)) {
      let end = source.indexOf("\n", i);
      if (end < 0) end = source.length;
      for (; i < end; i += 1) result[i] = " ";
      continue;
    }
    if (source.startsWith("/*", i)) {
      const closing = source.indexOf("*/", i + 2);
      const end = closing < 0 ? source.length : closing + 2;
      for (; i < end; i += 1) if (source[i] !== "\n") result[i] = " ";
      continue;
    }
    if (source[i] === '"') {
      const start = i;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i++] === '"') break;
      }
      for (let k = start; k < Math.min(source.length, i); k += 1) {
        if (source[k] !== "\n") result[k] = " ";
      }
      continue;
    }
    i += 1;
  }
  return result.join("");
}

function closeParen(source: string, start: number): number {
  if (source[start] !== "(") return -1;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Recognize only simple unbraced for-loop instances, never general CSG ancestry. */
function simpleLoopVariable(clean: string, callStart: number): string | null {
  const from = Math.max(0, callStart - 1800);
  const prefix = clean.slice(from, callStart);
  const pattern = /\bfor\s*\(\s*([A-Za-z_]\w*)\s*=/g;
  const loops = Array.from(prefix.matchAll(pattern));
  for (let i = loops.length - 1; i >= 0; i -= 1) {
    const match = loops[i];
    const open = clean.indexOf("(", from + match.index!);
    const end = closeParen(clean, open);
    if (end <= open || end >= callStart) continue;
    const between = clean.slice(end, callStart);
    if (/[;{}]/.test(between) || /\bfor\s*\(/.test(between)) continue;
    return match[1];
  }
  return null;
}

export function discoverScadModuleCalls(source: string): SourceMoveDiscovery {
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
    return { status: "too-complex", calls: [] };
  }
  const clean = maskScadNonCode(source);
  const names = new Set(
    Array.from(clean.matchAll(/\bmodule\s+([A-Za-z_]\w*)\s*\(/g), match => match[1]),
  );
  const calls: SourceMoveCall[] = [];
  const fingerprint = sourceFingerprint(source);
  const pattern = /\b([A-Za-z_]\w*)\s*\(/g;
  for (const match of clean.matchAll(pattern)) {
    const name = match[1];
    const start = match.index;
    if (!names.has(name)) continue;
    if (/\bmodule\s*$/.test(clean.slice(Math.max(0, start - 32), start))) continue;
    const open = clean.indexOf("(", start + name.length);
    const end = closeParen(clean, open);
    if (end < 0 || clean.slice(end).trimStart()[0] !== ";") continue;
    if (calls.length >= MAX_CALL_SITES) return { status: "too-complex", calls: [] };
    calls.push({
      id: name + "@" + start,
      name,
      start,
      line: clean.slice(0, start).split("\n").length,
      callText: source.slice(start, end),
      sourceFingerprint: fingerprint,
      loopVariable: simpleLoopVariable(clean, start),
    });
  }
  return { status: "available", calls };
}

/**
 * A probe runs only against a temporary copy of the source. The selected
 * site is disabled, or only one index of a simple loop is disabled.
 */
export function excludeScadSourceCall(
  source: string,
  call: SourceMoveCall,
  instanceIndex?: number,
): string {
  if (sourceFingerprint(source) !== call.sourceFingerprint) {
    throw new Error("Source changed since this module call was identified.");
  }
  const current = discoverScadModuleCalls(source);
  if (current.status !== "available" ||
      !current.calls.some(item => item.id === call.id && item.callText === call.callText)) {
    throw new Error("Module call can no longer be identified.");
  }
  let guard: string;
  if (call.loopVariable) {
    if (!Number.isInteger(instanceIndex) || instanceIndex! < 0 || instanceIndex! > 255) {
      throw new Error("Looped module call requires an explicit instance index (0–255).");
    }
    guard = "if (" + call.loopVariable + " != " + instanceIndex + ") ";
  } else {
    if (instanceIndex !== undefined) throw new Error("This module call is not indexable.");
    guard = "if (false) ";
  }
  return source.slice(0, call.start) + guard + source.slice(call.start);
}

type Faces = Map<string, number>;

function faceKey(off: ParsedOff, faceIndex: number): string {
  const face = off.faces[faceIndex];
  const vertices = face.vertices.map(vertexIndex => {
    const v = off.vertices[vertexIndex];
    return v.map(coordinate => Math.round(coordinate * QUANTIZATION)).join(",");
  });
  return vertices.sort().join("|");
}

function addFace(counts: Faces, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function faceCounts(off: ParsedOff, indices?: readonly number[]): Faces {
  const result = new Map<string, number>();
  if (indices) {
    for (const index of indices) addFace(result, faceKey(off, index));
  } else {
    for (let index = 0; index < off.faces.length; index += 1) {
      addFace(result, faceKey(off, index));
    }
  }
  return result;
}

function sameFaces(left: Faces, right: Faces): boolean {
  if (left.size !== right.size) return false;
  for (const [face, count] of left) if (right.get(face) !== count) return false;
  return true;
}

/**
 * Verifies an exclusion probe changed exactly ONE edge-connected shell, with
 * every other triangle unchanged. Color/order of OFF faces are irrelevant.
 * This proves identity only for the current rendered configuration.
 */
export function matchSourceProbeToPart(baseline: ParsedOff, probe: ParsedOff): SourceMoveMatch {
  if (baseline.faces.length > MAX_GEOMETRY_FACES || probe.faces.length > MAX_GEOMETRY_FACES) {
    return { status: "too-complex", removedFaces: 0, addedFaces: 0 };
  }
  const before = faceCounts(baseline);
  const after = faceCounts(probe);
  const removed = new Map<string, number>();
  let removedFaces = 0;
  let addedFaces = 0;
  for (const [key, count] of before) {
    const missing = count - (after.get(key) ?? 0);
    if (missing > 0) { removed.set(key, missing); removedFaces += missing; }
  }
  for (const [key, count] of after) addedFaces += Math.max(0, count - (before.get(key) ?? 0));
  if (removedFaces === 0 && addedFaces === 0) {
    return { status: "inactive", removedFaces, addedFaces };
  }
  if (addedFaces !== 0) return { status: "unsafe", removedFaces, addedFaces };
  const shells = connectedClosedShells(baseline);
  const matches: number[] = [];
  for (let index = 0; index < shells.length; index += 1) {
    const shell = shells[index];
    if (shell.faceIndices.length !== removedFaces) continue;
    if (sameFaces(removed, faceCounts(baseline, shell.faceIndices))) matches.push(index);
  }
  if (matches.length === 1) {
    return { status: "matched", partIndex: matches[0], removedFaces, addedFaces: 0 };
  }
  return { status: "ambiguous", removedFaces, addedFaces };
}
