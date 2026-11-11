import type { BuiltInModel } from "@/services/localModelLibrary";

export type BuiltInGalleryCard =
  | { kind: "model"; key: string; entry: BuiltInModel }
  | {
      kind: "folder";
      key: string;
      folder: string;
      label: string;
      repositoryId: string;
      representative: BuiltInModel;
      entries: BuiltInModel[];
      totalCount: number;
    };

function folderOf(path: string): string | null {
  const firstSlash = path.indexOf("/");
  return firstSlash > 0 ? path.slice(0, firstSlash) : null;
}

function groupKey(repositoryId: string, folder: string): string {
  // Keep different repositories and ambiguous folder strings separate.
  return JSON.stringify([repositoryId, folder]);
}

function matches(model: BuiltInModel, search: string): boolean {
  return !search || (model.name + " " + model.category + " " + model.path)
    .toLocaleLowerCase().includes(search);
}

/** Present folders containing multiple OpenSCAD models as one expandable card. */
export function buildBuiltInGalleryCards(
  models: readonly BuiltInModel[],
  query: string,
): BuiltInGalleryCard[] {
  const search = query.trim().toLocaleLowerCase();
  const byFolder = new Map<string, BuiltInModel[]>();
  for (const model of models) {
    const folder = folderOf(model.path);
    if (!folder) continue;
    const key = groupKey(model.repositoryId, folder);
    const members = byFolder.get(key) ?? [];
    members.push(model);
    byFolder.set(key, members);
  }

  const seen = new Set<string>();
  const result: BuiltInGalleryCard[] = [];
  for (const model of models) {
    const folder = folderOf(model.path);
    const key = folder ? groupKey(model.repositoryId, folder) : null;
    const group = key ? byFolder.get(key) : undefined;
    if (folder && key && group && group.length > 1) {
      if (seen.has(key)) continue;
      seen.add(key);
      const entries = group.filter((entry) => matches(entry, search));
      if (!entries.length) continue;
      const canonical = (folder + "/" + folder + ".scad").toLocaleLowerCase();
      const representative =
        entries.find((entry) => entry.path.toLocaleLowerCase() === canonical)
        ?? entries.find((entry) => entry.path.split("/").length === 2 && !/\.bak\.scad$/i.test(entry.path))
        ?? entries[0];
      result.push({
        kind: "folder",
        key: "folder:" + key,
        folder,
        label: folder.replace(/[_-]+/g, " "),
        repositoryId: model.repositoryId,
        representative,
        entries,
        totalCount: group.length,
      });
    } else if (matches(model, search)) {
      result.push({
        kind: "model",
        key: "model:" + model.repositoryId + ":" + model.path,
        entry: model,
      });
    }
  }
  return result;
}
