import { describe, expect, it } from "vitest";
import {
  createChain, resizeChain, updateSegment, resetSegment, segmentAt,
  parseChainJson, serializeChainJson, generateCaChainScad, chainWarnings,
  CHAIN_SCHEMA,
} from "./chainGenerator";

describe("experimental C-joint chain generator", () => {
  it.each([1, 5, 25, 150])("generates %i independently parametrized links", count => {
    const chain = createChain(count);
    const scad = generateCaChainScad(chain);
    expect(scad).toContain(`chain_count=${count};`);
    expect(scad).toContain("module chain_link(i)");
    expect(scad).toContain("module chain_octopus_head()");
    expect(scad).toContain('chain_layout="assembly"');
    expect(scad).not.toContain('include <');
    expect(scad).not.toContain('use <');
    expect(chainWarnings(chain)).toEqual([]);
  });

  it("keeps segment 7 and 12 changes while switching, resizing and round-tripping JSON", () => {
    let chain = createChain(25);
    chain = updateSegment(chain, 6, {shape:"Sphere", decoration:"Letter", letter:"Å", decorationHeight:2});
    chain = updateSegment(chain, 11, {shape:"Pyramid", fit:"Very Loose", decoration:"Octopus Head", decorationScale:1.3});
    expect(segmentAt(chain, 6).letter).toBe("Å");
    expect(segmentAt(chain, 11).decoration).toBe("Octopus Head");
    const restored = parseChainJson(serializeChainJson(chain));
    expect(restored.schema).toBe(CHAIN_SCHEMA);
    expect(segmentAt(restored, 6).shape).toBe("Sphere");
    expect(segmentAt(restored, 11).fit).toBe("Very Loose");
    expect(generateCaChainScad(restored,undefined,"single",11)).toContain("chain_selected=11");
    chain = resizeChain(restored, 150);
    expect(segmentAt(chain, 11).decorationScale).toBe(1.3);
    expect(segmentAt(resetSegment(chain, 6), 6).shape).toBe("Cube");
  });

  it("rejects invalid schema, prototype keys, sizes and incompatible ports", () => {
    expect(() => parseChainJson('{"fileFormatVersion":"1","parameterSets":{}}')).toThrow(/Brepia chain/);
    expect(() => parseChainJson(JSON.stringify({...createChain(2), count:151}))).toThrow(/1–150/);
    expect(() => parseChainJson(JSON.stringify({...createChain(2), overrides:{"__proto__":{shape:"Sphere"}}}))).not.toThrow();
    const mismatch = updateSegment(createChain(5), 1, {connections: {
      front:"male",back:"male",left:"none",right:"none",top:"none",
    }});
    expect(chainWarnings(mismatch).join(" ")).toMatch(/both ports are male/);
    expect(() => generateCaChainScad(mismatch)).toThrow(/both ports are male/);
  });

  it("requires decoration space and preserves source joint fit choices", () => {
    const chain = updateSegment(createChain(1), 0, {decoration:"Octopus Head", connections: {
      front:"male",back:"female",left:"none",right:"none",top:"male",
    }});
    expect(chainWarnings(chain)).toHaveLength(1);
    expect(chainWarnings(chain)[0]).toContain("overlaps");
    const ok = resetSegment(chain,0);
    const code = generateCaChainScad(ok,undefined,"print",0);
    expect(code).toContain('chain_layout="print"');
    expect(code).toContain('mode=="Firm" ? -0.05');
    expect(code).toContain('mode=="Loose" ? 0.15');
    expect(code).toContain('mode=="Very Loose" ? 0.35');
  });
});
