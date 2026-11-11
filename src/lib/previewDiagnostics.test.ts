import { describe, expect, it } from "vitest";
import { formatPreviewBytes, formatPreviewDuration } from "./previewDiagnostics";

describe("Experimental preview performance metrics", () => {
  it("formats worker compile time without implying total page load", () => {
    expect(formatPreviewDuration(250)).toBe("250 ms");
    expect(formatPreviewDuration(2500)).toBe("2.50 s");
    expect(formatPreviewDuration(0)).toBe("0 ms");
  });

  it("formats STL and OFF sizes safely", () => {
    expect(formatPreviewBytes(500)).toBe("500 B");
    expect(formatPreviewBytes(2048)).toBe("2.0 KiB");
    expect(formatPreviewBytes(3145728)).toBe("3.0 MiB");
  });

  it("does not display invalid or unreported data", () => {
    for (const bad of [null, NaN, -2, Infinity]) {
      expect(formatPreviewBytes(bad)).toBe("Unavailable");
      expect(formatPreviewDuration(bad)).toBe("Unavailable");
    }
  });
});
