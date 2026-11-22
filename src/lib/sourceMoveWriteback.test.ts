import { describe,expect,it,vi } from "vitest";
import type { ParsedOff } from "@/utils/offParser";
import {
  candidateIsCurrent, findSourceMoveCandidate,
  sourceMoveCandidates, verifySourceMoveTranslation, writeSourceMoveTranslation,
} from "./sourceMoveWriteback";

function box(x: number): ParsedOff {
  return {
    vertices: [[x,0,0],[x+1,0,0],[x,1,0],[x,0,1]],
    faces: [
      { vertices:[0,1,2],color:null },
      { vertices:[0,3,1],color:null },
      { vertices:[1,3,2],color:null },
      { vertices:[0,2,3],color:null },
    ],
  };
}
function combine(...parts: ParsedOff[]): ParsedOff {
  const vertices: ParsedOff["vertices"]=[];
  const faces: ParsedOff["faces"]=[];
  for(const part of parts) {
    const offset=vertices.length;
    vertices.push(...part.vertices);
    faces.push(...part.faces.map(face=>({...face,vertices:face.vertices.map(v=>v+offset) as [number,number,number]})));
  }
  return {vertices,faces};
}
const source=[
  "module lid() { cube(10); }",
  "module body() { cube(5); }",
  "body();",
  "lid();",
].join("\n");

describe("Source Move from selected rendered shell to SCAD",()=>{
  it("writes only the verified module call, not the definition",()=>{
    const chosen=sourceMoveCandidates(source,2).find(x=>x.call.name==="lid")!;
    expect(candidateIsCurrent(source,chosen)).toBe(true);
    const next=writeSourceMoveTranslation(source,chosen,[12,0,-3]);
    expect(next).toContain("translate([12, 0, -3]) lid();");
    expect(next).toContain("module lid() { cube(10); }");
    expect(next).toContain("body();");
    expect(candidateIsCurrent(source+"\n",chosen)).toBe(false);
  });
  it("changes one instance of a generated loop without moving other instances",()=>{
    const s="module link(i) { cube(i); }\nfor(i=[0:2]) translate([i*20,0,0]) link(i);";
    const chosen=sourceMoveCandidates(s,3).find(x=>x.instanceIndex===1)!;
    expect(writeSourceMoveTranslation(s,chosen,[2,3,4])).toContain(
      "if (i == 1) translate([2, 3, 4]) link(i); else link(i);",
    );
  });
  it("requires an actual finite nonzero delta",()=>{
    const chosen=sourceMoveCandidates(source,2)[0];
    expect(()=>writeSourceMoveTranslation(source,chosen,[0,0,0])).toThrow();
    expect(()=>writeSourceMoveTranslation(source,chosen,[Infinity,0,0])).toThrow();
  });
  it("identifies a selected part by compiling independent probe copies",async()=>{
    const baseline=combine(box(0),box(20));
    const compile=vi.fn(async (s:string)=>{
      if(s.includes("if (false) body()")) return box(20);
      if(s.includes("if (false) lid()")) return box(0);
      return baseline;
    });
    const result=await findSourceMoveCandidate({source,baseline,targetPart:1,partCount:2,compile});
    expect(result.status).toBe("matched");
    expect(result.candidate?.call.name).toBe("lid");
    expect(compile).toHaveBeenCalledTimes(2); // main-flow body() is checked before lid().
  });
  it("prioritizes main render calls before many nested geometry helpers",()=>{
    const helpers=Array.from({length:20},(_,i)=>"module helper_"+i+"() { cube(1); }").join("\n");
    const nested=Array.from({length:20},(_,i)=>"helper_"+i+"();").join("\n");
    const model=[
      "module box() { cube(10); }",
      "module lid() { cube(5); }",
      helpers,
      "if(show_box) box();",
      "if(show_lid) lid();",
      "module elaborate_geometry() {",
      nested,
      "}",
    ].join("\n");
    const calls=sourceMoveCandidates(model,2);
    expect(calls.length).toBeGreaterThan(12);
    expect(calls.slice(0,2).map(c=>c.call.name)).toEqual(["box","lid"]);
  });
  it("fairly probes sibling render modules instead of exhausting budget in an inactive branch",()=>{
    const helpers=Array.from({length:18},(_,i)=>"module helper"+i+"() { cube(1); }").join("\n");
    const inactive=Array.from({length:18},(_,i)=>"helper"+i+"();").join("\n");
    const s=[
      "module head() { cube(10); }",
      "module torso() { cube(8); }",
      helpers,
      "module assembled_model() {",inactive,"}",
      "module print_layout() {",
      'translate([0,70,10]) color("blue") head();',
      'translate([0,0,10]) color("blue") torso();',
      "}",
      'module main() { if(mode == "print") print_layout(); else assembled_model(); }',
      "main();",
    ].join("\n");
    const ordered=sourceMoveCandidates(s,2);
    const printHead=ordered.findIndex(x=>x.call.name==="head");
    const printTorso=ordered.findIndex(x=>x.call.name==="torso");
    expect(ordered[0].call.name).toBe("main");
    expect(ordered.slice(1,3).map(x=>x.call.name)).toEqual(["print_layout","assembled_model"]);
    expect(printHead).toBeGreaterThanOrEqual(3);
    expect(printHead).toBeLessThan(7);
    expect(printTorso).toBeLessThan(10);
  });

  it("interleaves loop sites so the first loop cannot consume every probe",()=>{
    const model=[
      "module link(i) { cube(1); }",
      "module endcap(i) { cube(2); }",
      "for(i=[0:9]) translate([i*20,0,0]) link(i);",
      "for(i=[0:9]) translate([i*20,20,0]) endcap(i);",
    ].join("\n");
    const calls=sourceMoveCandidates(model,10);
    expect(calls.slice(0,4).map(c=>[c.call.name,c.instanceIndex])).toEqual([
      ["link",0],["endcap",0],["link",1],["endcap",1],
    ]);
  });
  it("reports exhaustion rather than pretending the untested calls did not exist",async()=>{
    const calls=Array.from({length:16},(_,i)=>"module m"+i+"(){ cube(1); }").join("\n")+"\n"+
      Array.from({length:16},(_,i)=>"m"+i+"();").join("\n");
    const baseline=combine(box(0),box(20));
    const result=await findSourceMoveCandidate({
      source:calls,baseline,targetPart:1,partCount:2,
      compile:async()=>baseline,
    });
    expect(result.status).toBe("budget-exhausted");
    expect(result.tested).toBe(12);
    expect(result.total).toBe(16);
    expect(result.failed).toBe(0);
  });
  it("distinguishes compiler failures from negative geometry evidence",async()=>{
    const baseline=combine(box(0),box(20));
    const result=await findSourceMoveCandidate({
      source,baseline,targetPart:1,partCount:2,
      compile:async()=>{throw new Error("OpenSCAD compile unavailable");},
    });
    expect(result.status).toBe("probe-failed");
    expect(result.failed).toBe(2);
    expect(result.error).toContain("unavailable");
  });
  it("verifies the moved part while every untouched polygon remains identical",()=>{
    const before=combine(box(0),box(20));
    expect(verifySourceMoveTranslation(before,combine(box(0),box(25)),1,[5,0,0])).toBe(true);
    expect(verifySourceMoveTranslation(before,combine(box(1),box(25)),1,[5,0,0])).toBe(false);
    expect(verifySourceMoveTranslation(before,combine(box(0),box(25)),0,[5,0,0])).toBe(false);
  });
  it("does not accept another part or an ambiguous match",async()=>{
    const baseline=combine(box(0),box(20));
    const result=await findSourceMoveCandidate({
      source,baseline,targetPart:1,partCount:2,
      compile:async(_s)=>box(20),
    });
    expect(result.status).toBe("not-found");
  });
});
