import { describe, expect, it } from "vitest";
import { createMeshModelProject } from "./meshModelImport";

function tetrahedron(): Uint8Array {
  const triangles = [
    [[0,0,0],[1,0,0],[0,1,0]],
    [[0,0,0],[0,0,1],[1,0,0]],
    [[0,0,0],[0,1,0],[0,0,1]],
    [[1,0,0],[0,0,1],[0,1,0]],
  ];
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const triangle of triangles) {
    offset += 12;
    for (const vertex of triangle) for (const component of vertex) {
      view.setFloat32(offset, component, true);
      offset += 4;
    }
    offset += 2;
  }
  return bytes;
}

describe("mesh model import", () => {
  it("wraps a real binary STL as an OpenSCAD project with a stored asset", async () => {
    const bytes = tetrahedron();
    const file = new File([bytes], "sample.stl");
    const prepared = await createMeshModelProject(file);
    expect(prepared.name).toBe("sample");
    expect(prepared.project.entrypointPath).toBe("main.scad");
    expect(prepared.project.files[0].content).toContain('import("model.stl")');
    expect(prepared.assets).toHaveLength(1);
    expect(prepared.assets[0].bytes.byteLength).toBe(bytes.byteLength);
  });
  it("does not accept HTML or arbitrary binary as a mesh", async () => {
    await expect(createMeshModelProject(new File(["<html>not an STL</html>"], "fake.stl")))
      .rejects.toThrow(/not a valid/);
  });
  it("rejects a ZIP with a .stl filename and invalid extensions", async () => {
    await expect(createMeshModelProject(new File([new Uint8Array([80,75,3,4])], "bad.stl")))
      .rejects.toThrow(/not a valid/);
    await expect(createMeshModelProject(new File([tetrahedron()], "bad.svg")))
      .rejects.toThrow(/STL or 3MF/);
  });
});
