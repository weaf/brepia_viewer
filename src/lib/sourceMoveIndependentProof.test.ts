import { describe, expect, it, vi } from "vitest";
import type { ParsedOff } from "@/utils/offParser";
import { discoverScadModuleCalls } from "./sourceMoveProvenance";
import { verifyIndependentSourceMove, isIndependentTopLevelCall } from "./sourceMoveIndependentProof";
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

  it("does not accept arbitrary SCAD edits beyond the generated transform",async()=>{
    const compile=vi.fn(async()=>tetra(-40));
    expect(await verifyIndependentSourceMove({
      source,modified:modified.replace("module body()", "module changed()"),
      candidate,baseline:original,moved,targetPart:1,delta,compile,
    })).toBe(false);
    expect(compile).not.toHaveBeenCalled();
  });
});
