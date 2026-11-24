import { describe, expect, it } from "vitest";
import { chooseSiblingCustomizerJson } from "./githubCustomizerJson";

describe("GitHub model Customizer JSON discovery", () => {
  const files = [
    { path: "models/box/Box.scad" },
    { path: "models/box/Box.json" },
    { path: "models/box/unrelated.json" },
    { path: "models/snake/presets.json" },
    { path: "models/elsewhere.json" },
  ];
  it("prefers same-named JSON in a folder with multiple JSONs", () => {
    expect(chooseSiblingCustomizerJson(files, "models/box/Box.scad")?.path)
      .toBe("models/box/Box.json");
  });
  it("finds a single generic JSON next to the selected SCAD", () => {
    expect(chooseSiblingCustomizerJson(files, "models/snake/snake.scad")?.path)
      .toBe("models/snake/presets.json");
  });
  it("does not borrow JSON from another directory or guess among unrelated JSONs", () => {
    expect(chooseSiblingCustomizerJson(files, "models/new/main.scad")).toBeNull();
    expect(chooseSiblingCustomizerJson(files, "models/box/Other.scad")).toBeNull();
  });
  it("supports a SCAD.txt source name and case-insensitive matching", () => {
    expect(chooseSiblingCustomizerJson([
      { path: "demo/Model.JSON" }, { path: "demo/settings.json" },
    ], "demo/model.scad.txt")?.path).toBe("demo/Model.JSON");
  });
});
