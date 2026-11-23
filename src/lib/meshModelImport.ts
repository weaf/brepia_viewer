import { OPENSCAD_PROJECT_MAX_ASSET_BYTES, normalizeOpenScadProject } from "@shared/openScadProject";
import type { ScadFolderAssetInput } from "@/lib/scadImport";
import type { OpenScadProject } from "@shared/openScadProject";

const MAX_3MF_BYTES = 8 * 1024 * 1024;
const MAX_UNPACKED_3MF_BYTES = 48 * 1024 * 1024;

export type MeshModelProject = {
  name: string;
  project: OpenScadProject;
  assets: ScadFolderAssetInput[];
};

function validStl(bytes: Uint8Array): boolean {
  if (bytes.byteLength >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triangles = view.getUint32(80, true);
    if (triangles > 0 && 84 + triangles * 50 === bytes.byteLength) return true;
  }
  if (bytes.byteLength < 40) return false;
  const start = new TextDecoder().decode(bytes.subarray(0, Math.min(8192, bytes.length)));
  return /^\s*solid\b/i.test(start) && /\bfacet\s+normal\b/i.test(start) &&
    /\bvertex\s+[-+0-9.eE]+/i.test(start);
}

async function convert3mfToStl(input: File): Promise<Uint8Array> {
  if (input.size > MAX_3MF_BYTES) {
    throw new Error("This 3MF exceeds the 8 MiB conversion limit. Try a smaller original STL.");
  }
  // Guard against ZIP bombs before delegating XML/geometry parsing to Three.js.
  const { ZipReader, BlobReader } = await import("@zip.js/zip.js");
  const reader = new ZipReader(new BlobReader(input));
  try {
    const entries = await reader.getEntries();
    let unpacked = 0;
    for (const entry of entries) {
      if (!Number.isFinite(entry.uncompressedSize) ||
          entry.uncompressedSize < 0 || entry.uncompressedSize > MAX_UNPACKED_3MF_BYTES) {
        throw new Error("3MF contains oversized or invalid archive entries.");
      }
      unpacked += entry.uncompressedSize;
      if (unpacked > MAX_UNPACKED_3MF_BYTES) {
        throw new Error("3MF archive contains too much uncompressed data.");
      }
    }
  } finally { await reader.close(); }
  const [{ ThreeMFLoader }, { STLExporter }] = await Promise.all([
    import("three/examples/jsm/loaders/3MFLoader.js"),
    import("three/examples/jsm/exporters/STLExporter.js"),
  ]);
  let meshCount = 0;
  let model;
  try {
    model = new ThreeMFLoader().parse(await input.arrayBuffer());
    model.traverse(object => {
      if (object.type === "Mesh") meshCount += 1;
    });
    if (!meshCount) throw new Error("3MF does not contain a previewable mesh.");
  } catch {
    throw new Error("This 3MF could not be decoded as a 3D mesh. Slicer-only 3MF projects are not yet supported.");
  }
  // OpenSCAD handles validated STL assets. The mesh-only conversion intentionally
  // does not claim to preserve 3MF print profiles, materials, colors or plates.
  const result = new STLExporter().parse(model, { binary: true });
  if (typeof result === "string") throw new Error("Could not export this 3MF geometry.");
  const bytes = new Uint8Array(result.buffer, result.byteOffset, result.byteLength).slice();
  if (bytes.byteLength > OPENSCAD_PROJECT_MAX_ASSET_BYTES || !validStl(bytes)) {
    throw new Error("Converted mesh exceeds the 16 MiB STL limit or is invalid.");
  }
  return bytes;
}

export async function createMeshModelProject(file: File): Promise<MeshModelProject> {
  const filename = file.name;
  if (!/^[^\\/\x00-\x1f]{1,128}\.(?:stl|3mf)$/i.test(filename) ||
      file.size === 0 || file.size > OPENSCAD_PROJECT_MAX_ASSET_BYTES) {
    throw new Error("Choose a nonempty STL or 3MF file smaller than 16 MiB.");
  }
  const format = filename.toLowerCase().endsWith(".3mf") ? "3mf" : "stl";
  const bytes = format === "3mf"
    ? await convert3mfToStl(file)
    : new Uint8Array(await file.arrayBuffer());
  if (!validStl(bytes)) {
    throw new Error("This file is not a valid binary or ASCII STL model.");
  }
  const name = filename.replace(/\.(?:stl|3mf)$/i, "");
  const assetPath = "model.stl";
  const project = normalizeOpenScadProject({
    schemaVersion: 1,
    entrypointPath: "main.scad",
    files: [{
      path: "main.scad",
      content: `// Imported mesh: ${filename.replace(/[^a-zA-Z0-9._ -]/g, "_")}\n// Geometry can be moved and transformed. The original parametric CAD source is not available.\nimport("model.stl");\n`,
    }],
  });
  return { name, project, assets: [{ path: assetPath, bytes }] };
}
