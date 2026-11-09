import { describe, expect, it } from "vitest";
import { resolveViewerBackgroundLightness } from "./viewerBackground";

describe("resolveViewerBackgroundLightness", () => {
  it.each([
    [null, 23],
    ["", 23],
    [" ", 23],
    ["n/a", 23],
    ["0", 0],
    ["100", 100],
    ["35", 35],
    ["-12", 0],
    ["140", 100],
  ])("resolves stored value %s", (stored, expected) => {
    expect(resolveViewerBackgroundLightness(stored, 23)).toBe(expected);
  });
});
