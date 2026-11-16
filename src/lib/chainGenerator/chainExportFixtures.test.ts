import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createChain, generateCaChainScad, updateSegment } from "./chainGenerator";

describe("OpenSCAD CAD acceptance fixtures", () => {
  it("exports desktop self-contained CAD inputs for 1, 5, 25 and 150 links", () => {
    const output = process.env.CHAIN_FIXTURE_DIR;
    if (output) mkdirSync(output, { recursive: true });
    for (const count of [1, 5, 25, 150]) {
      let chain = createChain(count);
      if (count >= 12) {
        chain = updateSegment(chain, 6, { shape: "Sphere", decoration: "Letter", letter: "Ö" });
        chain = updateSegment(chain, 11, { shape: "Pyramid", decoration: "Octopus Head", fit: "Very Loose" });
      }
      const scad = generateCaChainScad(chain, undefined, count === 150 ? "print" : "assembly");
      expect(scad).toContain(`chain_count=${count};`);
      expect(scad).toContain("module female_socket(fit=joint_fit)");
      if (output) writeFileSync(join(output, `chain-${count}.scad`), scad, "utf8");
    }
  });
});
