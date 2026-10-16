import { zipSync } from "fflate";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

const encoder = new TextEncoder();

function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

/** Packages a compiled STL mesh as a standards-based 3MF ZIP archive. */
export function exportStlAsThreeMf(stl: ArrayBuffer, title: string): Blob {
  const geometry = new STLLoader().parse(stl);
  try {
    const positions = geometry.getAttribute("position");
    if (positions.count === 0 || positions.count % 3 !== 0) {
      throw new Error("The compiled STL does not contain complete triangles.");
    }

    const vertices: string[] = [];
    const triangles: string[] = [];
    const vertexIndices = new Map<string, number>();
    const getVertexIndex = (index: number): number => {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      if (![x, y, z].every(Number.isFinite)) {
        throw new Error("The compiled STL contains invalid vertex coordinates.");
      }
      const key = `${x},${y},${z}`;
      const existing = vertexIndices.get(key);
      if (existing !== undefined) return existing;
      const vertexIndex = vertices.length;
      vertices.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
      vertexIndices.set(key, vertexIndex);
      return vertexIndex;
    };
    for (let index = 0; index < positions.count; index += 3) {
      const v1 = getVertexIndex(index);
      const v2 = getVertexIndex(index + 1);
      const v3 = getVertexIndex(index + 2);
      triangles.push(`<triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`);
    }

    if (vertexIndices.size < 3) {
      throw new Error("The compiled STL does not contain a valid triangle mesh.");
    }

    const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${xmlEscape(title)}</metadata><resources><object id="1" type="model"><mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
    const relationships = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
    const archive = zipSync(
      {
        "[Content_Types].xml": encoder.encode(contentTypes),
        "_rels/.rels": [encoder.encode(relationships), { level: 0 }],
        "3D/3dmodel.model": encoder.encode(model),
      },
      { level: 6 },
    );
    return new Blob([archive], { type: "model/3mf" });
  } finally {
    geometry.dispose();
  }
}
