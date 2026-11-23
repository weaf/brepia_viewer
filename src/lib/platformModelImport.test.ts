import { describe, expect, it, vi } from "vitest";
import {
  identifyPlatformModelUrl, isDirectMeshUrl, listPrintablesModelFiles,
  getPrintablesDownloadUrl, fetchPublicMesh,
} from "./platformModelImport";

describe("platform model links", () => {
  it.each([
    ["https://www.printables.com/model/3161-3d-benchy", "printables", "3161"],
    ["https://www.thingiverse.com/thing:763622/files", "thingiverse", "763622"],
    ["https://makerworld.com/en/models/24966-my-model", "makerworld", "24966"],
    ["https://space.snapmaker.com/en/models/12345", "snapmaker-space", "12345"],
  ])("detects %s", (url, platform, modelId) => {
    expect(identifyPlatformModelUrl(url)).toMatchObject({ platform, modelId });
  });
  it.each([
    "https://attacker.example/thing:123", "http://www.printables.com/model/3161-test",
    "https://makerworld.com/en/models/no-id", "https://space.snapmaker.com/en",
    "https://user:secret@printables.com/model/3161-example",
  ])("rejects unsupported or unsafe platform link %s", url => {
    expect(identifyPlatformModelUrl(url)).toBeNull();
  });
  it("recognizes direct STL and 3MF links without confusing platform pages", () => {
    expect(isDirectMeshUrl("https://example.org/files/sample.stl")).toBe(true);
    expect(isDirectMeshUrl("https://example.org/files/sample.3mf?download=1")).toBe(true);
    expect(isDirectMeshUrl("https://www.printables.com/model/3161-3d-benchy")).toBe(false);
    expect(isDirectMeshUrl("https://example.org/files/sample.zip")).toBe(false);
  });
});

describe("public Printables file listing", () => {
  const model = identifyPlatformModelUrl("https://www.printables.com/model/3161-3d-benchy")!;
  it("lists model STL/3MF files and filters unsupported and oversized files", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: { print: { name: "3D Benchy", stls: [
        { id: "10", name: "benchy.stl", fileSize: 128 },
        { id: "11", name: "multi-color.3mf", fileSize: 256 },
        { id: "12", name: "instructions.pdf", fileSize: 100 },
        { id: "13", name: "../oops.stl", fileSize: 100 },
        { id: "14", name: "huge.stl", fileSize: 100_000_000 },
      ] } },
    }), { headers: { "content-type": "application/json" } }));
    const listing = await listPrintablesModelFiles(model, fetcher as typeof fetch);
    expect(listing.title).toBe("3D Benchy");
    expect(listing.files.map(f => f.name)).toEqual(["benchy.stl", "multi-color.3mf"]);
    const [, options] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(options.body).variables.id).toBe("3161");
  });
  it("validates the resolved host and never sends credentials", async () => {
    const file = { id: "10", name: "benchy.stl", bytes: 128, format: "stl" as const };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: { getDownloadLink: { ok: true, output: { link: "https://files.printables.com/media/prints/file.stl" } } },
    })));
    expect(await getPrintablesDownloadUrl(model, file, fetcher as typeof fetch))
      .toBe("https://files.printables.com/media/prints/file.stl");
    expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe("omit");
    await expect(getPrintablesDownloadUrl(model, file, async () => new Response(JSON.stringify({
      data: { getDownloadLink: { ok: true, output: { link: "https://evil.example/file.stl" } } },
    })))).rejects.toThrow(/untrusted/);
  });
  it("rejects oversized downloads even when the server lies about their length", async () => {
    await expect(fetchPublicMesh("https://files.printables.com/x.stl", "x.stl", async () =>
      new Response(new Uint8Array(16_777_217))
    )).rejects.toThrow(/16 MiB/);
  });
});
