import { describe, expect, it, vi } from "vitest";
import type { ParsedOff } from "@/utils/offParser";
import { proveTranslatedShellsWithCsg } from "./sourceMoveCsgSolidProof";

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
    faces.push(...part.faces.map(f=>({
      vertices:f.vertices.map(index=>index+offset) as [number,number,number],color:null,
    })));
  }
  return {vertices,faces};
}
function witness(x:number,y:number,z:number):ParsedOff {
  const points:ParsedOff["vertices"]=[
    [x,y,z],[x+1,y,z],[x+1,y+1,z],[x,y+1,z],
    [x,y,z+1],[x+1,y,z+1],[x+1,y+1,z+1],[x,y+1,z+1],
  ];
  const triangles: [number,number,number][]=[
    [0,2,1],[0,3,2],[4,5,6],[4,6,7],
    [0,1,5],[0,5,4],[1,2,6],[1,6,5],
    [2,3,7],[2,7,6],[3,0,4],[3,4,7],
  ];
  return {vertices:points,faces:triangles.map(vertices=>({vertices,color:null}))};
}

describe("Source Move bidirectional solid equivalence",()=>{
  const original=combine(tetra(-40),tetra(40));
  const moved=combine(tetra(-40),tetra(48.5));
  const marker=witness(158.5,110,110);

  it("requires BOTH directional CSG differences to contain only the distant witness",async()=>{
    const compile=vi.fn()
      .mockResolvedValueOnce(tetra(48.5))
      .mockResolvedValueOnce(tetra(48.5))
      .mockResolvedValueOnce(marker)
      .mockResolvedValueOnce(marker);
    expect(await proveTranslatedShellsWithCsg(original,moved,1,[8.5,0,0],compile)).toBe(true);
    expect(compile).toHaveBeenCalledTimes(4);
    for(const args of compile.mock.calls.slice(0,2)) {
      expect(args[0]).toContain("!polyhedron(points=");
    }
    for(const args of compile.mock.calls.slice(2)) {
      expect(args[0]).toContain("!union()");
      expect(args[0]).toContain("difference()");
      expect(args[0]).toContain("polyhedron(points=");
      expect(args[0]).toContain("translate([158.5,110,110]) cube");
    }
  });

  it("rejects a reverse CSG difference with an additional solid region",async()=>{
    const compile=vi.fn()
      .mockResolvedValueOnce(tetra(48.5))
      .mockResolvedValueOnce(tetra(48.5))
      .mockResolvedValueOnce(marker)
      .mockResolvedValueOnce(combine(marker,tetra(10)));
    const reasons:string[]=[];
    expect(await proveTranslatedShellsWithCsg(original,moved,1,[8.5,0,0],compile,
      reason=>reasons.push(reason))).toBe(false);
    expect(reasons).toContain("csg-negative-difference");
  });

  it("rejects missing witness output rather than guessing an empty CSG result",async()=>{
    const compile=vi.fn(async()=>({vertices:[],faces:[]}));
    expect(await proveTranslatedShellsWithCsg(original,moved,1,[8.5,0,0],compile))
      .toBe(false);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("rejects incorrect move placement before invoking the expensive CSG compiler",async()=>{
    const compile=vi.fn(async()=>marker);
    expect(await proveTranslatedShellsWithCsg(original,moved,1,[5,0,0],compile)).toBe(false);
    expect(compile).not.toHaveBeenCalled();
  });

  it("rejects invalid coordinates and non-finite movement",async()=>{
    const compile=vi.fn(async()=>marker);
    expect(await proveTranslatedShellsWithCsg(original,moved,1,[NaN,0,0],compile)).toBe(false);
    expect(compile).not.toHaveBeenCalled();
  });
});
