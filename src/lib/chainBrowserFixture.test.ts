import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createChain, generateCaChainScad } from "./chainGenerator/chainGenerator";

const selected = process.env.SOURCE_MOVE_CHAIN_BROWSER_FIXTURE === "1" ? it : it.skip;
describe("real chain Chrome fixture", () => {
  selected("writes self-contained Viewer C-chain with three individually selectable links", () => {
    const scad = generateCaChainScad(createChain(3), undefined, "print");
    expect(scad).toContain("for(i=[0:chain_count-1])");
    expect(scad).toContain("chain_count=3;");
    mkdirSync(".output", { recursive: true });
    writeFileSync(".output/source-move-chain-fixture.scad", scad);
  });
});
