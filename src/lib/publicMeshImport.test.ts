import { describe, expect, it, vi } from "vitest";
import { fetchPublicMesh, isDirectMeshUrl } from "./publicMeshImport";
import { OPENSCAD_PROJECT_MAX_ASSET_BYTES } from "@shared/openScadProject";
const url = "https://example.org/model.stl";
describe("direct mesh download", () => {
  it.each([url, "https://example.org/model.3mf?download=1"])("recognizes %s", value => expect(isDirectMeshUrl(value)).toBe(true));
  it.each(["http://example.org/m.stl", "https://u:p@example.org/m.stl", "https://example.org:8443/m.stl", url+"#x", "https://example.org/model/123"])("rejects %s", value => expect(isDirectMeshUrl(value)).toBe(false));
  it("downloads without credentials or redirects", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1,2,3])));
    const file = await fetchPublicMesh(url,"model.stl",fetcher as typeof fetch);
    expect(file.size).toBe(3);
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({credentials:"omit",mode:"cors",redirect:"error"}));
  });
  it("rejects HTML, bad status and declared oversize", async () => {
    for (const response of [
      new Response("<html>login</html>", {headers:{"content-type":"text/html"}}),
      new Response("Forbidden",{status:403}),
      new Response("x",{headers:{"content-length":String(OPENSCAD_PROJECT_MAX_ASSET_BYTES+1)}}),
    ]) {
      await expect(fetchPublicMesh(url,"model.stl",vi.fn(async()=>response) as typeof fetch)).rejects.toThrow();
    }
  });
  it("enforces the actual byte limit even without content length", async () => {
    const chunk = new Uint8Array(1024*1024);
    let n=0;
    const stream = new ReadableStream<Uint8Array>({pull(controller){if(n++<17)controller.enqueue(chunk);else controller.close();}});
    await expect(fetchPublicMesh(url,"model.stl",vi.fn(async()=>new Response(stream)) as typeof fetch)).rejects.toThrow(/asset limit/);
  });
  it("does not fetch unsafe paths or invalid filenames", async () => {
    const fetcher=vi.fn(async()=>new Response("x"));
    await expect(fetchPublicMesh(url+"#bad","model.stl",fetcher as typeof fetch)).rejects.toThrow();
    await expect(fetchPublicMesh(url,"../model.stl",fetcher as typeof fetch)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
