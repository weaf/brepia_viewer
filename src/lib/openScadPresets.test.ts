import { describe, expect, it } from "vitest";
import { normalizeOpenScadProject } from "@shared/openScadProject";
import { updateParameter } from "@/lib/utilsCore";
import parseParameters from "@shared/parseParameters";
import {
  applyParameterSet,
  captureCustomizerValues,
  createSavedVariants,
  mergeImportedVariants,
  parseOpenScadPresetJson,
  serializeOpenScadPresetJson,
} from "./openScadPresets";

const scad = [
  'width = 10; // [1:100]',
  'height = 20;',
  'label = "Tiny";',
  'enabled = true;',
  'dimensions = [1, 2, 3];',
  '',
  'translate([width, 0, 0]) cube([height, dimensions[1], 2]);',
].join("\n");

const project = normalizeOpenScadProject({
  schemaVersion: 1,
  entrypointPath: "model.scad",
  files: [{ path: "model.scad", content: scad }],
});

function source(after: typeof project) {
  return after.files.find(file => file.path === after.entrypointPath)!.content;
}

describe("OpenSCAD saved variants", () => {
  it("reads and writes the official version 1 multi-preset format", () => {
    const input = JSON.stringify({
      fileFormatVersion: "1",
      parameterSets: {
        Small: { width: "100", enabled: "false", label: "hello", dimensions: "[1,2,3]" },
        Large: { width: "180", enabled: "true", label: "big", dimensions: "[4,5,6]" },
      },
    });
    const parsed = parseOpenScadPresetJson(input);
    expect(Object.keys(parsed)).toEqual(["Small", "Large"]);
    expect(parsed.Small.dimensions).toBe("[1,2,3]");
    expect(parsed.Small.enabled).toBe("false");
    expect(parseOpenScadPresetJson(serializeOpenScadPresetJson(parsed))).toEqual(parsed);
  });

  it("captures numeric vectors as one OpenSCAD preset value", () => {
    expect(captureCustomizerValues(scad)).toMatchObject({
      width: "10", height: "20", label: "Tiny", enabled: "true",
      dimensions: "[1,2,3]",
    });
    expect(Object.prototype.hasOwnProperty.call(captureCustomizerValues(scad), "dimensions[1]")).toBe(false);
  });

  it("applies only listed parameters without changing unrelated source", () => {
    const result = applyParameterSet(project, {
      width: "33",
      label: "Full \"size\"",
      enabled: "false",
      dimensions: "[4,5,6]",
      unknownParameter: "999",
    });
    expect(result.applied).toEqual(["width", "label", "enabled", "dimensions"]);
    expect(result.skipped).toEqual(["unknownParameter"]);
    expect(source(result.project)).toContain('width = 33; // [1:100]');
    expect(source(result.project)).toContain('label = "Full \\"size\\"";');
    expect(source(result.project)).toContain("enabled = false;");
    expect(source(result.project)).toContain("dimensions = [4,5,6];");
    expect(source(result.project)).toContain("translate([width, 0, 0]) cube");
    expect(source(project)).toContain("width = 10;");
  });

  it("keeps other variants and models separate", () => {
    const imported = parseOpenScadPresetJson(JSON.stringify({
      fileFormatVersion: "1",
      parameterSets: { Small: { width: "5" } },
    }));
    const merged = mergeImportedVariants({ Small: { width: "10" } }, imported);
    expect(merged.Small.width).toBe("10");
    expect(merged["Small (imported 2)"].width).toBe("5");
    const other = normalizeOpenScadProject({
      schemaVersion: 1, entrypointPath: "other.scad",
      files: [{ path: "other.scad", content: "size = 9; cube(size);" }],
    });
    const one = applyParameterSet(project, merged.Small);
    expect(source(one.project)).toContain("width = 10;");
    expect(other.files[0].content).toBe("size = 9; cube(size);");
  });

  it("restores original values without reverting source changes", () => {
    const saved = createSavedVariants(scad);
    const edited = applyParameterSet(project, { width: "55", enabled: "false" });
    const result = applyParameterSet(edited.project, saved.originalParameters);
    expect(captureCustomizerValues(source(result.project))).toEqual(saved.originalParameters);
    expect(source(result.project)).toContain("translate([width, 0, 0]) cube");
  });

  it("skips malformed and incompatible values instead of corrupting source", () => {
    const result = applyParameterSet(project, {
      width: "Infinity",
      enabled: "not a bool",
      dimensions: "[1,\"wrong\"]",
      label: "new",
    });
    expect(result.skipped).toEqual(["width", "enabled", "dimensions"]);
    expect(source(result.project)).toContain("width = 10;");
    expect(source(result.project)).toContain("enabled = true;");
    expect(source(result.project)).toContain('label = "new";');
  });

  it("edits a numeric vector slider after loading a preset", () => {
    const applied = applyParameterSet(project, { dimensions: "[7,8,9]" });
    const parameter = parseParameters(source(applied.project)).find(item => item.name === "dimensions[1]");
    expect(parameter).toBeDefined();
    const edited = updateParameter(source(applied.project), { ...parameter!, value: 9 });
    expect(edited).toContain("dimensions = [7, 9, 9];");
    expect(edited).toContain("translate([width, 0, 0]) cube");
  });

  it("rejects invalid preset formats and unsafe entries", () => {
    expect(() => parseOpenScadPresetJson("{}")).toThrow();
    expect(() => parseOpenScadPresetJson('{"fileFormatVersion":"2","parameterSets":{}}')).toThrow();
    expect(() => parseOpenScadPresetJson(JSON.stringify({
      fileFormatVersion: "1", parameterSets: { Small: { width: { unexpected: true } } },
    }))).toThrow();
  });
});
