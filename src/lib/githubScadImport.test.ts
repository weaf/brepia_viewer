import { describe, expect, it, vi } from "vitest";
import {
  inspectGithubScadUrl,
  getGithubScadSelection,
  downloadGithubScadProject,
  findGithubCustomizerJson,
} from "./githubScadImport";

const fileSource = "module knob() { cylinder(h=10, d=12); }\nknob();";
const helperSource = "module knob() { cube([10,10,10]); }";
const repository = {
  default_branch: "master",
};
const branches = [{ name: "master", commit: { sha: "a".repeat(40) } }, { name: "feature/new", commit: { sha: "b".repeat(40) } }];
const tree = {
  truncated: false,
  tree: [
    { path: "knob_factory/knob-factory.scad", type: "blob", mode: "100644", size: new TextEncoder().encode(fileSource).byteLength, sha: "c".repeat(40) },
    { path: "other/main.scad", type: "blob", mode: "100644", size: new TextEncoder().encode("include <helper.scad>;\nknob();").byteLength, sha: "d".repeat(40) },
    { path: "other/helper.scad", type: "blob", mode: "100644", size: new TextEncoder().encode(helperSource).byteLength, sha: "e".repeat(40) },
    { path: "other/README.png", type: "blob", mode: "100644", size: 42, sha: "f".repeat(40) },
  ],
};

function fixtureFetch(responses: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = responses[url];
    if (body === undefined) return new Response("Not found", { status: 404 });
    if (typeof body === "string") return new Response(body);
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const base = "https://api.github.com/repos/tanius/openscad-models";
function fetcher(additions: Record<string, unknown> = {}) {
  return fixtureFetch({
    [base + "/branches?per_page=100&page=1"]: branches,
    [base]: repository,
    [base + "/git/trees/" + "a".repeat(40) + "?recursive=1"]: tree,
    [base + "/git/trees/" + "b".repeat(40) + "?recursive=1"]: tree,
    ...additions,
  });
}

describe("GitHub OpenSCAD URL import", () => {
  it("resolves the user's encoded GitHub blob link", async () => {
    const result = await inspectGithubScadUrl(
      "https://github.com/tanius/openscad-models/blob/master/knob_factory%2Fknob-factory.scad",
      fetcher(),
    );
    expect(result.suggestedScope).toBe("knob_factory");
    expect(result.suggestedEntrypoint).toBe("knob-factory.scad");
    expect(getGithubScadSelection(result, result.suggestedScope).entrypoints).toEqual(["knob-factory.scad"]);
  });

  it("reads the user's repository tree and offers independent model folders", async () => {
    const result = await inspectGithubScadUrl(
      "https://github.com/tanius/openscad-models/tree/master",
      fetcher(),
    );
    expect(result.suggestedScope).toBe("");
    expect(result.scopes).toContain("knob_factory");
    expect(result.scopes).toContain("other");
    expect(getGithubScadSelection(result, "").sources).toHaveLength(3);
  });

  it("resolves branch names containing slashes", async () => {
    const result = await inspectGithubScadUrl(
      "https://github.com/tanius/openscad-models/tree/feature/new/other",
      fetcher(),
    );
    expect(result.branch).toBe("feature/new");
    expect(result.suggestedScope).toBe("other");
  });

  it("downloads and preserves relative include paths with the shared folder importer", async () => {
    const raw = "https://raw.githubusercontent.com/tanius/openscad-models/" + "a".repeat(40);
    const f = fetcher({
      [raw + "/other/main.scad"]: "include <helper.scad>;\nknob();",
      [raw + "/other/helper.scad"]: helperSource,
    });
    const result = await inspectGithubScadUrl("https://github.com/tanius/openscad-models/tree/master/other", f);
    const progress: string[] = [];
    const imported = await downloadGithubScadProject(
      result,
      "other",
      "main.scad",
      (done, total) => progress.push(`${done}/${total}`),
      f,
    );
    expect(imported.project.entrypointPath).toBe("main.scad");
    expect(imported.project.files.map((file) => file.path)).toEqual(["helper.scad", "main.scad"]);
    expect(progress).toEqual(["0/2", "1/2", "2/2"]);
  });

  it("automatically loads the matching Customizer JSON next to the chosen SCAD entrypoint", async () => {
    const code = "/* [Dimensions] */\nwidth = 12; // [4:1:30]\ncube([width,width,5]);";
    const json = JSON.stringify({ fileFormatVersion: "1", parameterSets: {
      Wide: { width: 24 }, Narrow: { width: 8 },
    } });
    const treeWithJson = { ...tree, tree: [
      ...tree.tree.map(item => item.path === "knob_factory/knob-factory.scad"
        ? { ...item, size: new TextEncoder().encode(code).byteLength } : item),
      { path: "knob_factory/knob-factory.json", type: "blob", mode: "100644", sha: "1".repeat(40), size: new TextEncoder().encode(json).byteLength },
      { path: "other/irrelevant.json", type: "blob", mode: "100644", sha: "2".repeat(40), size: 40 },
    ] };
    const raw = "https://raw.githubusercontent.com/tanius/openscad-models/" + "a".repeat(40);
    const f = fetcher({
      [base + "/git/trees/" + "a".repeat(40) + "?recursive=1"]: treeWithJson,
      [raw + "/knob_factory/knob-factory.scad"]: code,
      [raw + "/knob_factory/knob-factory.json"]: json,
    });
    const inspection = await inspectGithubScadUrl("https://github.com/tanius/openscad-models/tree/master/knob_factory", f);
    const progress: string[] = [];
    expect(findGithubCustomizerJson(inspection, "knob_factory", "knob-factory.scad")?.path)
      .toBe("knob_factory/knob-factory.json");
    const imported = await downloadGithubScadProject(inspection, "knob_factory", "knob-factory.scad",
      (done, total) => progress.push(done + "/" + total), f);
    expect(imported.presetFile).toBe("knob-factory.json");
    expect(imported.savedVariants?.parameterSets).toMatchObject({ Wide: { width: "24" }, Narrow: { width: "8" } });
    expect(imported.savedVariants?.originalParameters).toHaveProperty("width");
    expect(imported.savedVariants?.activeName).toBeNull();
    expect(imported.project.files.map(file => file.path)).toEqual(["knob-factory.scad"]);
    expect(imported.importedFiles).toBe(2);
    expect(progress).toEqual(["0/2", "1/2", "2/2"]);
  });

  it("uses an only JSON sibling but never guesses between multiple unrelated JSON files", async () => {
    const mkJson = (name: string) => ({
      path: "knob_factory/" + name, type: "blob", mode: "100644", size: 70, sha: "3".repeat(40),
    });
    const single = fetcher({ [base + "/git/trees/" + "a".repeat(40) + "?recursive=1"]:
      { ...tree, tree: [...tree.tree, mkJson("presets.json")] } });
    const inspection = await inspectGithubScadUrl("https://github.com/tanius/openscad-models/tree/master/knob_factory", single);
    expect(findGithubCustomizerJson(inspection, "knob_factory", "knob-factory.scad")?.path)
      .toBe("knob_factory/presets.json");
    const multi = fetcher({ [base + "/git/trees/" + "a".repeat(40) + "?recursive=1"]:
      { ...tree, tree: [...tree.tree, mkJson("presets.json"), mkJson("settings.json")] } });
    const multiInspection = await inspectGithubScadUrl("https://github.com/tanius/openscad-models/tree/master/knob_factory", multi);
    expect(findGithubCustomizerJson(multiInspection, "knob_factory", "knob-factory.scad")).toBeNull();
  });

  it("opens a model when sibling JSON is invalid and returns a useful warning", async () => {
    const json = "{ invalid }";
    const raw = "https://raw.githubusercontent.com/tanius/openscad-models/" + "a".repeat(40);
    const f = fetcher({
      [base + "/git/trees/" + "a".repeat(40) + "?recursive=1"]: {
        ...tree, tree: [...tree.tree, {
          path: "knob_factory/knob-factory.json", type: "blob", mode: "100644",
          size: new TextEncoder().encode(json).byteLength, sha: "4".repeat(40),
        }],
      },
      [raw + "/knob_factory/knob-factory.scad"]: fileSource,
      [raw + "/knob_factory/knob-factory.json"]: json,
    });
    const inspection = await inspectGithubScadUrl("https://github.com/tanius/openscad-models/tree/master/knob_factory", f);
    const imported = await downloadGithubScadProject(inspection, "knob_factory", "knob-factory.scad", () => {}, f);
    expect(imported.project.entrypointPath).toBe("knob-factory.scad");
    expect(imported.savedVariants).toBeUndefined();
    expect(imported.presetWarning).toMatch(/knob-factory.json.*Invalid OpenSCAD JSON/);
    expect(imported.importedFiles).toBe(1);
  });

  it("rejects invalid urls without requests", async () => {
    const f = fetcher();
    await expect(inspectGithubScadUrl("https://github.com/tanius/openscad-models/blob/master/../../secret.scad", f)).rejects.toThrow(/unsafe|Invalid|Use a GitHub repository/);
    expect(f).not.toHaveBeenCalled();
  });

  it("reports missing files and GitHub rate limits", async () => {
    await expect(inspectGithubScadUrl("https://github.com/tanius/openscad-models/blob/master/not-there.scad", fetcher())).rejects.toThrow(/does not exist/);
    const rateLimited = vi.fn(async () => new Response("API rate limit", {
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
    })) as unknown as typeof fetch;
    await expect(inspectGithubScadUrl("https://github.com/tanius/openscad-models", rateLimited)).rejects.toThrow(/limit/);
  });

  it("rejects too many selected sources before downloading", async () => {
    const bigTree = {
      truncated: false,
      tree: Array.from({ length: 65 }, (_, i) => ({
        path: "models/part-" + i + ".scad",
        type: "blob",
        mode: "100644",
        size: 40,
        sha: "c".repeat(40),
      })),
    };
    const f = fetcher({ [base + "/git/trees/" + "a".repeat(40) + "?recursive=1"]: bigTree });
    const inspected = await inspectGithubScadUrl("https://github.com/tanius/openscad-models/tree/master", f);
    await expect(downloadGithubScadProject(inspected, "models", "part-0.scad", () => {}, f)).rejects.toThrow(/limit/);
  });
});
