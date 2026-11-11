import { describe, expect, it } from "vitest";
import { readExperimentalMode } from "./experimentalMode";

describe("experimental mode preference", () => {
  it("is opt-in and defaults off for missing or unknown values", () => {
    expect(readExperimentalMode(null)).toBe(false);
    expect(readExperimentalMode("")).toBe(false);
    expect(readExperimentalMode("false")).toBe(false);
    expect(readExperimentalMode("TRUE")).toBe(false);
    expect(readExperimentalMode("1")).toBe(false);
  });
  it("restores only an explicitly enabled mode", () => {
    expect(readExperimentalMode("true")).toBe(true);
  });
});
