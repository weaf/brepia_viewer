import { describe, expect, it } from "vitest";
import type { BuiltInModel } from "@/services/localModelLibrary";
import { buildBuiltInGalleryCards } from "./builtInGalleryGroups";

function model(path: string, repositoryId = "parametric-designs"): BuiltInModel {
  const segments = path.split("/");
  return {
    repositoryId,
    path,
    name: (segments.at(-1) ?? path).replace(/\.scad$/i, ""),
    category: ["Parametric designs", ...segments.slice(0, -1)].join(" / "),
    size: 200,
    sha: path,
    url: "https://example.test/" + path,
  };
}

const catalog = [
  model("chain_ring/key_ring.scad"),
  model("dovetail/beta/dovetal_test.scad"),
  model("dovetail/dovetail.bak.scad"),
  model("dovetail/dovetail.scad"),
  model("root.scad"),
  model("another/part.scad"),
];

describe("built-in gallery folders", () => {
  it("creates one dovetail card with three children including the beta folder", () => {
    const cards = buildBuiltInGalleryCards(catalog, "");
    expect(cards).toHaveLength(4);
    const card = cards.find((value) => value.kind === "folder");
    expect(card).toMatchObject({ kind: "folder", folder: "dovetail", label: "dovetail", totalCount: 3 });
    if (card?.kind !== "folder") throw new Error("Missing dovetail folder");
    expect(card.representative.path).toBe("dovetail/dovetail.scad");
    expect(card.entries.map((entry) => entry.path)).toEqual([
      "dovetail/beta/dovetal_test.scad",
      "dovetail/dovetail.bak.scad",
      "dovetail/dovetail.scad",
    ]);
  });

  it("keeps root files and single-file folders as model cards", () => {
    const cards = buildBuiltInGalleryCards(catalog, "");
    expect(cards.filter((card) => card.kind === "model").map((card) => card.kind === "model" && card.entry.path))
      .toEqual(["chain_ring/key_ring.scad", "root.scad", "another/part.scad"]);
  });

  it("searches nested filenames without splitting an existing folder", () => {
    const cards = buildBuiltInGalleryCards(catalog, "DOVETAL_TEST");
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.kind).toBe("folder");
    if (card.kind !== "folder") return;
    expect(card.entries.map((entry) => entry.path)).toEqual(["dovetail/beta/dovetal_test.scad"]);
    expect(card.totalCount).toBe(3);
  });

  it("never merges folders across repositories", () => {
    const cards = buildBuiltInGalleryCards([...catalog, model("dovetail/unique.scad", "other")], "");
    expect(cards.filter((card) => card.kind === "folder")).toHaveLength(1);
    expect(cards.some((card) => card.kind === "model" && card.entry.repositoryId === "other")).toBe(true);
  });

  it("filters backup names and returns nothing for missing results", () => {
    expect(buildBuiltInGalleryCards(catalog, "BAK")).toMatchObject([{
      kind: "folder", entries: [{ path: "dovetail/dovetail.bak.scad" }],
    }]);
    expect(buildBuiltInGalleryCards(catalog, "no-such-file")).toEqual([]);
  });
});
