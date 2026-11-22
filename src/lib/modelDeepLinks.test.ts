import { describe, expect, it } from "vitest";
import { createViewerModelLink, parseViewerModelLink } from "./modelDeepLinks";
import { getModelRepositories, validateModelRepositories } from "./modelRepositories";

describe("shared model links", () => {
  it("round-trips direct HTTPS SCAD source with an existing query", () => {
    const remote = "https://example.org/models/box.scad?download=1";
    const url = createViewerModelLink({ kind: "url", url: remote });
    expect(parseViewerModelLink(new URL(url).search)).toEqual({ kind: "url", url: remote });
  });
  it("round-trips a curated model identity without depending on its display name", () => {
    const link = { kind: "library" as const, repositoryId: "parametric-designs", path: "Box/Box.scad" };
    expect(parseViewerModelLink(new URL(createViewerModelLink(link)).search)).toEqual(link);
  });
  it.each([
    "?model=http%3A%2F%2Fexample.org%2Fm.scad",
    "?model=https%3A%2F%2Fu%3Ap%40example.org%2Fm.scad",
    "?model=https%3A%2F%2Fexample.org%3A8443%2Fm.scad",
    "?model=https%3A%2F%2Fexample.org%2Fm.zip",
    "?model=https%3A%2F%2Fexample.org%2Fm.scad%23fragment",
    "?model=a&model=b",
    "?library=parametric-designs&file=../secret.scad",
    "?library=parametric-designs&file=%2Fabsolute.scad",
    "?library=parametric-designs",
    "?library=parametric-designs&file=a.scad&model=https%3A%2F%2Fexample.org%2Fm.scad",
  ])("rejects malformed link %s", (search) => {
    expect(() => parseViewerModelLink(search)).toThrow();
  });
  it("ignores unrelated URL parameters", () => {
    expect(parseViewerModelLink("?utm_campaign=demo")).toBeNull();
  });
});

describe("reviewable model library JSON", () => {
  const registered = getModelRepositories();
  it("contains the existing library with stable identity", () => {
    expect(registered[0]).toMatchObject({
      id: "parametric-designs",
      owner: "Noty-design",
      repository: "Parametric-designs",
    });
  });
  it("rejects duplicate IDs and unsafe URL fields", () => {
    const entry = registered[0];
    expect(() => validateModelRepositories([entry, entry])).toThrow();
    for (const patch of [
      { owner: "evil.com/pwn" }, { repository: "../evil" },
      { branch: "../../main" }, { path: "../models" },
      { path: "/models" }, { path: "models//test" },
      { id: "ALL" }, { label: "Unsafe\nlabel" },
      { apiUrl: "https://evil.com" },
    ]) {
      expect(() => validateModelRepositories([{ ...entry, ...patch }])).toThrow();
    }
  });
  it("accepts a second ordinary GitHub repository", () => {
    expect(validateModelRepositories([
      registered[0],
      { id: "community", label: "Community", owner: "example", repository: "scad-models", branch: "main", path: "models" },
    ])).toHaveLength(2);
  });
});
