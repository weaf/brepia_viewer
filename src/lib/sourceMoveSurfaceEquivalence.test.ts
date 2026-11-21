import { describe, expect, it } from "vitest";
import type { ParsedOff } from "@/utils/offParser";
import { verifySourceMoveRetessellation } from "./sourceMoveSurfaceEquivalence";

function tetra(x: number): ParsedOff {
  return {
    vertices: [[x,0,0],[x+10,0,0],[x,10,0],[x,0,10]],
    faces: [
      { vertices: [0,1,2], color: null },
      { vertices: [0,3,1], color: null },
      { vertices: [1,3,2], color: null },
      { vertices: [0,2,3], color: null },
    ],
  };
}
function together(...parts: ParsedOff[]): ParsedOff {
  const vertices: ParsedOff["vertices"] = [];
  const faces: ParsedOff["faces"] = [];
  for (const part of parts) {
    const offset = vertices.length;
    vertices.push(...part.vertices.map(v => [...v] as [number,number,number]));
    faces.push(...part.faces.map(f => ({
      vertices: f.vertices.map(index => index + offset) as [number,number,number],
      color: f.color,
    })));
  }
  return {vertices,faces};
}
function movedAndSplit(before: ParsedOff): ParsedOff {
  const copy = structuredClone(before);
  // The four vertices of the second, selected tetrahedron.
  for (let i = 4; i < 8; i++) copy.vertices[i][0] += 5;
  // Split one planar face into three differently tessellated, equivalent faces.
  const face = copy.faces[4];
  const p = face.vertices.map(index => copy.vertices[index]);
  const center = p[0].map((x, i) => (x + p[1][i] + p[2][i]) / 3) as [number,number,number];
  const index = copy.vertices.push(center) - 1;
  copy.faces.splice(4, 1,
    {vertices:[face.vertices[0],face.vertices[1],index],color:null},
    {vertices:[face.vertices[1],face.vertices[2],index],color:null},
    {vertices:[face.vertices[2],face.vertices[0],index],color:null},
  );
  return copy;
}

describe("Source Move precise surface-equivalence fallback", () => {
  const before = together(tetra(-40), tetra(40));

  it("accepts planar retessellation of only the selected translated shell", () => {
    const after = movedAndSplit(before);
    expect(after.faces.length).toBe(before.faces.length+2);
    expect(verifySourceMoveRetessellation(before,after,1,[5,0,0])).toBe(true);
  });

  it("rejects geometry changes on the unselected component", () => {
    const after = movedAndSplit(before);
    after.vertices[0][0] += 0.05;
    expect(verifySourceMoveRetessellation(before,after,1,[5,0,0])).toBe(false);
  });

  it("rejects a moved shell with a real surface deformation", () => {
    const after = movedAndSplit(before);
    after.vertices[7][2] += 0.1;
    expect(verifySourceMoveRetessellation(before,after,1,[5,0,0])).toBe(false);
  });

  it("rejects an entirely missing facet, even if other facets remain", () => {
    const after = movedAndSplit(before);
    after.faces.pop();
    expect(verifySourceMoveRetessellation(before,after,1,[5,0,0])).toBe(false);
  });

  it("rejects wrong part identity", () => {
    expect(verifySourceMoveRetessellation(before,movedAndSplit(before),0,[5,0,0])).toBe(false);
  });

  it("rejects any non-finite delta", () => {
    expect(verifySourceMoveRetessellation(before,movedAndSplit(before),1,[NaN,0,0])).toBe(false);
  });
});
