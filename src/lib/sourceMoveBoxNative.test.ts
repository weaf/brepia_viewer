import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseColoredOff } from "@/utils/offParser";
import { matchSourceProbeToPart, excludeScadSourceCall } from "./sourceMoveProvenance";
import {
  sourceMoveCandidates, verifySourceMoveTranslation, writeSourceMoveTranslation,
} from "./sourceMoveWriteback";

// Run only in the dedicated GitHub Actions integration job. Normal unit tests
// never fetch files or require native OpenSCAD on developer workstations.
const native = process.env.SOURCE_MOVE_NATIVE_BOX === "1" ? it : it.skip;

describe("Source Move real OpenSCAD Box proof", () => {
  native("maps the lid from source, moves only it and verifies the complete OFF mesh", () => {
    const fixture = process.env.SOURCE_MOVE_BOX_FILE;
    expect(fixture, "Pinned real Box fixture must be supplied").toBeTruthy();
    const source = readFileSync(fixture!, "utf8");
    const all = sourceMoveCandidates(source, 2);
    const lid = all.find(candidate => candidate.call.name === "generate_lid" && !candidate.call.loopVariable);
    expect(lid, "Real Box lid should have a distinct call site").toBeDefined();
    // The source-first manifest exposes the call before any native compile.
    expect(all.findIndex(candidate => candidate.call.id === lid!.call.id)).toBe(1);
    const directory = mkdtempSync(path.join(os.tmpdir(), "source-move-box-"));
    const compile = (name: string, scad: string) => {
      const scadPath = path.join(directory, name + ".scad");
      const offPath = path.join(directory, name + ".off");
      writeFileSync(scadPath, scad);
      execFileSync("openscad", ["-o", offPath, "-D", "show_mounting_rails=false", scadPath], {
        timeout: 600_000, maxBuffer: 4 * 1024 * 1024,
      });
      return parseColoredOff(readFileSync(offPath, "utf8"));
    };
    try {
      const baseline = compile("baseline", source);
      expect(baseline.faces.length).toBeGreaterThan(1_000);
      const excludedSource = excludeScadSourceCall(source, lid!.call);
      const excluded = compile("without-lid", excludedSource);
      const match = matchSourceProbeToPart(baseline, excluded);
      expect(match.status, JSON.stringify(match)).toBe("matched");
      if (match.status !== "matched") throw new Error("Unverifiable lid-source mapping");
      const offset = [5, 0, 0] as const;
      const changedSource = writeSourceMoveTranslation(source, lid!, offset);
      expect(changedSource).toContain("translate([5, 0, 0]) generate_lid();");
      expect(changedSource).toContain("generate_box();");
      const changed = compile("moved-lid", changedSource);
      // Check every OFF face; the box, rails state and any other geometry must
      // remain unchanged. The new render must equal exactly the chosen shell
      // translated by 5 mm.
      expect(verifySourceMoveTranslation(baseline, changed, match.partIndex, offset)).toBe(true);
      console.log("SOURCE_MOVE_REAL_BOX_PASS", JSON.stringify({
        originalFaces: baseline.faces.length,
        withoutLidFaces: excluded.faces.length,
        movedFaces: changed.faces.length,
        lidFaces: match.removedFaces,
        lidPart: match.partIndex + 1,
        lidSourceLine: lid!.call.line,
        sourceCandidateRank: 2,
        verifiedTranslationMm: offset,
      }));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 1_800_000);
});
