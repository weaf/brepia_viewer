import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createChain, generateCaChainScad } from "./chainGenerator/chainGenerator";
import { parseColoredOff } from "@/utils/offParser";
import { matchSourceProbeToPart, excludeScadSourceCall } from "./sourceMoveProvenance";
import { isIndependentTopLevelLoopInstance, verifyIndependentSourceMove } from "./sourceMoveIndependentProof";
import {
  sourceMoveCandidates, findSourceMoveCandidate, verifySourceMoveTranslation,
  writeSourceMoveTranslation,
} from "./sourceMoveWriteback";

const native = process.env.SOURCE_MOVE_NATIVE_CHAIN === "1" ? it : it.skip;

describe("Source Move real parametrized C-chain proof", () => {
  native("identifies and moves only the second generated link, preserving the other links", async () => {
    // The actual unmodified Viewer generator and bundled C connector source,
    // not a simplified hand-written approximation.
    const source = generateCaChainScad(createChain(3), undefined, "print");
    const candidates = sourceMoveCandidates(source, 3);
    const candidate = candidates.find(entry =>
      entry.call.name === "chain_link" && entry.instanceIndex === 1 &&
      source.slice(Math.max(0, entry.call.start - 140), entry.call.start)
        .includes("chain_print_pitch"),
    );
    expect(candidate, "Select index 1 from the real print-layout loop").toBeDefined();
    expect(isIndependentTopLevelLoopInstance(source, candidate!)).toBe(true);

    const directory = mkdtempSync(path.join(os.tmpdir(), "source-move-chain-"));
    let sequence = 0;
    const compile = (scad: string) => {
      sequence += 1;
      const input = path.join(directory, String(sequence) + ".scad");
      const output = path.join(directory, String(sequence) + ".off");
      writeFileSync(input, scad);
      execFileSync("openscad", ["-o", output, input], {
        timeout: 240_000, maxBuffer: 4 * 1024 * 1024,
      });
      return parseColoredOff(readFileSync(output, "utf8"));
    };
    try {
      const baseline = compile(source);
      const excluded = compile(excludeScadSourceCall(source, candidate!.call, 1));
      const identity = matchSourceProbeToPart(baseline, excluded);
      expect(identity.status, JSON.stringify(identity)).toBe("matched");
      if (identity.status !== "matched") throw Error("Chain index cannot be attributed");
      const found = await findSourceMoveCandidate({
        source, baseline, partCount: 3, targetPart: identity.partIndex,
        compile: async scad => compile(scad),
      });
      expect(found.status).toBe("matched");
      expect(found.candidate?.call.id).toBe(candidate!.call.id);
      expect(found.candidate?.instanceIndex).toBe(1);

      const delta = [5, 0, 0] as const;
      const modified = writeSourceMoveTranslation(source, found.candidate!, delta);
      expect(modified).toContain(
        "translate(i == 1 ? [5, 0, 0] : [0, 0, 0]) chain_link(i);",
      );
      const moved = compile(modified);
      const exact = verifySourceMoveTranslation(baseline, moved, identity.partIndex, delta);
      const reasons: string[] = [];
      const independent = exact ? false : await verifyIndependentSourceMove({
        source, modified, candidate: found.candidate!, baseline, moved,
        targetPart: identity.partIndex, delta, compile: async scad => compile(scad),
        onFailure: reason => reasons.push(reason),
      });
      expect(exact || independent, "Native chain rejected: " + reasons.join(",")).toBe(true);
      expect(baseline.faces.length).toBeGreaterThan(1000);
      expect(excluded.faces.length).toBeLessThan(baseline.faces.length);
      expect(moved.faces.length).toBeGreaterThan(1000);
      console.log("SOURCE_MOVE_NATIVE_CHAIN_PASS", JSON.stringify({
        originalFaces: baseline.faces.length,
        withoutSelectedFaces: excluded.faces.length,
        movedFaces: moved.faces.length,
        selectedPart: identity.partIndex + 1,
        selectedIndex: 1,
        sourceLine: candidate!.call.line,
        verifiedTranslationMm: delta,
        exact, independent,
        compileCount: sequence,
      }));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 1_800_000);
});
