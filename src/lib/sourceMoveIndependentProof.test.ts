import { describe, expect, it, vi } from "vitest";
import type { ParsedOff } from "@/utils/offParser";
import { discoverScadModuleCalls } from "./sourceMoveProvenance";
import { verifyIndependentSourceMove, isIndependentTopLevelCall, isIndependentTopLevelLoopInstance } from "./sourceMoveIndependentProof";
import { writeSourceMoveTranslation, type SourceMoveCandidate } from "./sourceMoveWriteback";

const source=[
  "module body(){ cube(10); }",
  "module lid(){ cube(5); }",
  "if (show_body) { body(); }",
  "if (show_lid) { lid(); }",
].join("\n");
const delta=[5,0,0] as const;

function tetra(x:number):ParsedOff {
  return {
    vertices:[[x,0,0],[x+10,0,0],[x,10,0],[x,0,10]],
    faces:[
      {vertices:[0,1,2],color:null},{vertices:[0,3,1],color:null},
      {vertices:[1,3,2],color:null},{vertices:[0,2,3],color:null},
    ],
  };
}
function combine(...parts:ParsedOff[]):ParsedOff {
  const vertices:ParsedOff["vertices"]=[];
  const faces:ParsedOff["faces"]=[];
  for(const part of parts) {
    const offset=vertices.length;
    vertices.push(...part.vertices.map(v=>[...v] as [number,number,number]));
    faces.push(...part.faces.map(face=>({
      vertices:face.vertices.map(i=>i+offset) as [number,number,number],
      color:face.color,
    })));
  }
  return {vertices,faces};
}
function candidateFor(src:string, name:string):SourceMoveCandidate {
  const result=discoverScadModuleCalls(src);
  if(result.status!=="available") throw new Error("Invalid fixture");
  const call=result.calls.find(call=>call.name===name);
  if(!call) throw new Error("Call not found");
  return {call};
}

describe("Source Move independent top-level proof",()=>{
  const original=combine(tetra(-40),tetra(40));
  const moved=combine(tetra(-40),tetra(45));
  const candidate=candidateFor(source,"lid");
  const modified=writeSourceMoveTranslation(source,candidate,delta);

  it("classifies standalone top-level if calls, rejecting nested or CSG ancestry",()=>{
    expect(isIndependentTopLevelCall(source,candidate)).toBe(true);
    const nested="module body() { lid(); } module lid() { cube(1); }";
    expect(isIndependentTopLevelCall(nested,candidateFor(nested,"lid"))).toBe(false);
    const csg="module lid() { cube(1); } union() { if(show_lid) { lid(); } }";
    expect(isIndependentTopLevelCall(csg,candidateFor(csg,"lid"))).toBe(false);
    const multistatement=[
      "module lid(){ cube(1); }",
      "if(show_lid) { lid(); translate([3,0,0]) cube(1); }",
    ].join("\n");
    expect(isIndependentTopLevelCall(multistatement,candidateFor(multistatement,"lid"))).toBe(false);
    const loop="module lid(i){cube(1);} for(i=[0:2]) lid(i);";
    expect(isIndependentTopLevelCall(loop,candidateFor(loop,"lid"))).toBe(false);
  });

  it("accepts a single exactly translated shell when all disabled-call geometry is byte-identical in OFF",async()=>{
    const compile=vi.fn(async (_src:string)=>tetra(-40));
    const accepted=await verifyIndependentSourceMove({
      source,modified,candidate,baseline:original,moved,targetPart:1,delta,compile,
    });
    expect(accepted).toBe(true);
    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile.mock.calls[0][0]).toContain("if (false) lid();");
    expect(compile.mock.calls[1][0]).toContain("if (false) translate([5, 0, 0]) lid();");
  });

  const remeshedMoved = () => {
    const remeshed=structuredClone(moved);
    const face=remeshed.faces[4];
    const p=face.vertices.map(index=>remeshed.vertices[index]);
    const center=p[0].map((v,i)=>(v+p[1][i]+p[2][i])/3) as [number,number,number];
    const midpoint=remeshed.vertices.push(center)-1;
    remeshed.faces.splice(4,1,
      {vertices:[face.vertices[0],face.vertices[1],midpoint],color:null},
      {vertices:[face.vertices[1],face.vertices[2],midpoint],color:null},
      {vertices:[face.vertices[2],face.vertices[0],midpoint],color:null},
    );
    return remeshed;
  };

  it("accepts an independently translated CLOSED shell despite different triangulation",async()=>{
    const compile=vi.fn()
      .mockResolvedValueOnce(tetra(-40))
      .mockResolvedValueOnce(tetra(-40));
    expect(await verifyIndependentSourceMove({
      source,modified,candidate,baseline:original,moved:remeshedMoved(),
      targetPart:1,delta,compile,
    })).toBe(true);
    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile.mock.calls[0][0]).toContain("if (false) lid();");
    expect(compile.mock.calls[1][0])
      .toContain("if (false) translate([5, 0, 0]) lid();");
  });

  it("rejects a selected shell deformed within the SAME bounding box",async()=>{
    const wrong=remeshedMoved();
    wrong.vertices[wrong.vertices.length-1][2]+=3;
    const compile=vi.fn(async()=>tetra(-40));
    const reasons:string[]=[];
    expect(await verifyIndependentSourceMove({
      source,modified,candidate,baseline:original,moved:wrong,
      targetPart:1,delta,compile,onFailure:reason=>reasons.push(reason),
    })).toBe(false);
    expect(reasons).toContain("moved-shell-shape-invariant-mismatch");
    expect(compile).not.toHaveBeenCalled();
  });

  it("rejects changes to a sibling even with a valid moved selected shell",async()=>{
    const compile=vi.fn()
      .mockResolvedValueOnce(tetra(-40))
      .mockResolvedValueOnce(tetra(-39.9));
    expect(await verifyIndependentSourceMove({
      source,modified,candidate,baseline:original,moved:remeshedMoved(),
      targetPart:1,delta,compile,
    })).toBe(false);
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it("does not accept a changed unused part in isolated compilation",async()=>{
    const compile=vi.fn()
      .mockResolvedValueOnce(tetra(-40))
      .mockResolvedValueOnce(tetra(-39.9));
    expect(await verifyIndependentSourceMove({
      source,modified,candidate,baseline:original,moved,targetPart:1,delta,compile,
    })).toBe(false);
  });

  it("does not accept a moved wrong part, even if isolated geometry looks identical",async()=>{
    const compile=vi.fn(async()=>tetra(-40));
    expect(await verifyIndependentSourceMove({
      source,modified,candidate,baseline:original,
      moved:combine(tetra(-35),tetra(40)),targetPart:1,delta,compile,
    })).toBe(false);
    expect(compile).not.toHaveBeenCalled();
  });

  it("proves a translated instance in an indexed, translate-only top-level loop",async()=>{
    const loopSource=[
      "module link(i) { cube(1); }",
      'if (layout == "print") {',
      "  for(i=[0:count-1]) translate([i*20,0,0]) link(i);",
      "}",
    ].join("\n");
    const loopCandidate={...candidateFor(loopSource,"link"),instanceIndex:1};
    expect(loopCandidate.call.loopVariable).toBe("i");
    expect(isIndependentTopLevelLoopInstance(loopSource,loopCandidate)).toBe(true);
    const rewritten=writeSourceMoveTranslation(loopSource,loopCandidate,delta);
    const compile=vi.fn(async(_src:string)=>tetra(-40));
    expect(await verifyIndependentSourceMove({
      source:loopSource,modified:rewritten,candidate:loopCandidate,
      baseline:original,moved,targetPart:1,delta,compile,
    })).toBe(true);
    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile.mock.calls[0][0]).toContain("if (i != 1) link(i);");
    expect(compile.mock.calls[1][0]).toContain(
      "if (i != 1) if (i == 1) translate([5, 0, 0]) link(i); else link(i);",
    );
  });

  it("rejects rotated, nested CSG, braced and nonzero-start loops",()=>{
    const fixture=(statement:string)=>"module link(i) { cube(1); }\n"+statement;
    const check=(statement:string)=>{
      const scad=fixture(statement);
      const cand={...candidateFor(scad,"link"),instanceIndex:1};
      return isIndependentTopLevelLoopInstance(scad,cand);
    };
    expect(check("for(i=[0:3]) rotate([0,0,90]) link(i);")).toBe(false);
    expect(check("for(i=[0:3]) scale([2,1,1]) link(i);")).toBe(false);
    expect(check("union() { for(i=[0:3]) translate([i*20,0,0]) link(i); }")).toBe(false);
    expect(check("for(i=[1:3]) translate([i*20,0,0]) link(i);")).toBe(false);
    expect(check("for(i=[0,1,2]) translate([i*20,0,0]) link(i);")).toBe(false);
    expect(check("for(i=[0:3]) { translate([i*20,0,0]) link(i); }")).toBe(false);
    expect(check("module extra() { for(i=[0:3]) link(i); }")).toBe(false);
  });

  it("rejects changed siblings even when an indexed moved instance is valid",async()=>{
    const loopSource="module link(i) { cube(1); }\nfor(i=[0:2]) translate([i*20,0,0]) link(i);";
    const loopCandidate={...candidateFor(loopSource,"link"),instanceIndex:1};
    const modifiedLoop=writeSourceMoveTranslation(loopSource,loopCandidate,delta);
    const compile=vi.fn().mockResolvedValueOnce(tetra(-40)).mockResolvedValueOnce(tetra(-39));
    expect(await verifyIndependentSourceMove({
      source:loopSource,modified:modifiedLoop,candidate:loopCandidate,
      baseline:original,moved,targetPart:1,delta,compile,
    })).toBe(false);
  });

  it("does not accept arbitrary SCAD edits beyond the generated transform",async()=>{
    const compile=vi.fn(async()=>tetra(-40));
    expect(await verifyIndependentSourceMove({
      source,modified:modified.replace("module body()", "module changed()"),
      candidate,baseline:original,moved,targetPart:1,delta,compile,
    })).toBe(false);
    expect(compile).not.toHaveBeenCalled();
  });
});
