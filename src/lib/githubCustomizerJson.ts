/** Resolve OpenSCAD Customizer JSON from the selected model's GitHub folder.
 * Prefer the exact SCAD basename, otherwise accept a single JSON sibling.
 * Multiple unrelated JSON files are ambiguous and must not be guessed.
 */
export function chooseSiblingCustomizerJson<T extends { path: string }>(
  files: readonly T[],
  entrypoint: string,
): T | null {
  const folder = entrypoint.includes("/")
    ? entrypoint.slice(0, entrypoint.lastIndexOf("/") + 1) : "";
  const siblings = files.filter(file =>
    file.path.startsWith(folder) &&
    !file.path.slice(folder.length).includes("/") &&
    file.path.toLowerCase().endsWith(".json"));
  if (!siblings.length) return null;
  const base = entrypoint.replace(/\.scad(?:\.txt)?$/i, "");
  const preferred = siblings.find(file =>
    file.path.toLowerCase() === (base + ".json").toLowerCase()) ??
    siblings.find(file =>
      file.path.toLowerCase() === (entrypoint + ".json").toLowerCase());
  return preferred ?? (siblings.length === 1 ? siblings[0] : null);
}
