import { describe, expect, it } from "vitest";
import type { ParsedOff } from "@/utils/offParser";
import {
  discoverScadModuleCalls, excludeScadSourceCall, maskScadNonCode, matchSourceProbeToPart,
} from "./sourceMoveProvenance";

function candidates(source: string) {
  const discovery = discoverScadModuleCalls(source);
  expect(discovery.status).toBe("available");
  return discovery.calls;
}

function tetrahedron(x: number): ParsedOff {
  return {
    vertices: [[x,0,0],[x+1,0,0],[x,1,0],[x,0,1]],
    faces: [
      { vertices:[0,1,2], color:null },
      { vertices:[0,3,1], color:null },
      { vertices:[1,3,2], color:null },
      { vertices:[0,2,3], color:null },
    ],
  };
}

function combined(...parts: ParsedOff[]): ParsedOff {
  const vertices: ParsedOff["vertices"] = [];
  const faces: ParsedOff["faces"] = [];
  for (const part of parts) {
    const offset = vertices.length;
    vertices.push(...part.vertices);
    faces.push(...part.faces.map(face => ({
      vertices: face.vertices.map(index => index + offset) as [number,number,number],
      color: face.color,
    })));
  }
  return { vertices, faces };
}

describe("general OpenSCAD source-to-rendered-part probes", () => {
  it("discovers the Box lid without treating comments and strings as code", () => {
    const code = [
      'module generate_box() { cube(10); }',
      'module generate_lid() { cube(5); }',
      '// generate_lid();',
      'echo("generate_lid();");',
      'if (show_box) { generate_box(); }',
      'if (show_lid) { generate_lid(); }',
    ].join("\n");
    const calls = candidates(code);
    expect(calls.map(call => call.name)).toEqual(["generate_box", "generate_lid"]);
    const lid = calls[1];
    const result = excludeScadSourceCall(code, lid);
    expect(result).toContain("if (show_lid) { if (false) generate_lid(); }");
    expect(result).toContain("if (show_box) { generate_box(); }");
    expect(() => excludeScadSourceCall(code + "\n", lid)).toThrow(/Source changed/);
    expect(maskScadNonCode(code)).not.toContain('echo("generate_lid();")');
  });

  it("preserves JavaScript offsets through Unicode and escaped comments", () => {
    const code = [
      "// 🐍 OpenSCAD uses UTF-16 offsets in the browser",
      "module part() { cube(1); }",
      "/* 🐙 part(); */",
      "part();",
    ].join("\n");
    const calls = candidates(code);
    expect(calls).toHaveLength(1);
    expect(calls[0].start).toBe(code.lastIndexOf("part();"));
    expect(excludeScadSourceCall(code,calls[0])).toContain("if (false) part();");
  });

  it("finds the Megabot head in a transformed print-layout call", () => {
    const code = [
      'module body_head() { sphere(5); }',
      'module body_torso() { sphere(5); }',
      'module print_layout() {',
      '  translate([0,70,20]) color("blue") body_head();',
      '  translate([0,0,20]) color("blue") body_torso();',
      '}',
      'print_layout();',
    ].join("\n");
    const calls = candidates(code);
    const head = calls.find(call => call.name === "body_head")!;
    expect(head.loopVariable).toBeNull();
    expect(excludeScadSourceCall(code, head)).toContain('color("blue") if (false) body_head();');
  });

  it("isolates one link in a general unbraced OpenSCAD for-loop", () => {
    const code = [
      'module chain_link(i) { cube(10); }',
      'if(chain_layout == "print") {',
      '  for(i=[0:chain_count-1]) translate([(i%5)*39, floor(i/5)*39, 0]) chain_link(i);',
      '} else {',
      '  for(i=[0:chain_count-1]) translate([i*30, 0, 0]) chain_link(i);',
      '}',
    ].join("\n");
    const calls = candidates(code);
    const links = calls.filter(call => call.name === "chain_link");
    expect(links).toHaveLength(2);
    expect(links.every(call => call.loopVariable === "i")).toBe(true);
    expect(excludeScadSourceCall(code, links[0], 2)).toContain('if (i != 2) chain_link(i);');
    expect(excludeScadSourceCall(code, links[0], 2)).toContain('translate([i*30, 0, 0]) chain_link(i);');
    expect(() => excludeScadSourceCall(code, links[0])).toThrow(/instance index/);
  });

  it("does not guess an index inside a braced or multi-statement loop", () => {
    const source = [
      'module item() { cube(1); }',
      'for(i=[0:4]) { let(x=i) item(); }',
    ].join("\n");
    const calls = candidates(source);
    expect(calls).toHaveLength(1);
    expect(calls[0].loopVariable).toBeNull();
    expect(() => excludeScadSourceCall(source, calls[0], 1)).toThrow(/not indexable/);
  });

  it("identifies a single removed OFF shell regardless of vertex order", () => {
    const a = tetrahedron(0), b = tetrahedron(20);
    const result = matchSourceProbeToPart(combined(a,b), a);
    expect(result).toEqual({status:"matched",partIndex:1,removedFaces:4,addedFaces:0});
  });

  it("rejects inactive, ambiguous and source-altering probes", () => {
    const a=tetrahedron(0), b=tetrahedron(20);
    expect(matchSourceProbeToPart(combined(a,b),combined(a,b)).status).toBe("inactive");
    expect(matchSourceProbeToPart(combined(a,b),combined(a,tetrahedron(25))).status).toBe("unsafe");
    expect(matchSourceProbeToPart(combined(a,b),{vertices:[],faces:[]}).status).toBe("ambiguous");
  });
});
