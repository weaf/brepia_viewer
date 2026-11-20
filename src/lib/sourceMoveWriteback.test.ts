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
    expect(compile).toHaveBeenCalledTimes(1);
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
