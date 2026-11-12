import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { parseColoredOff, type ParsedOff } from './offParser';
import { stripOpenscadDefaults, type PreparedOffMesh } from './preparedOffMesh';

// Build a Three.js Group whose meshes preserve OpenSCAD's color() calls from
// an OFF file. `fallbackColor` is used for faces without explicit color. The
// material parameters match the live viewer's OpenSCADPreview path so the
// preview thumbnail reads the same way as the in-editor render.
//
// Returns null when the OFF parses to zero usable faces — callers should fall
// back to the single-color STL render path in that case.
export function buildColoredGroupFromOff(
  offText: string,
  fallbackColor: number,
  preParsed?: ParsedOff,
): Group | null {
  const parsed = preParsed ?? parseColoredOff(offText);

  for (const face of parsed.faces) {
    face.color = stripOpenscadDefaults(face.color);
  }

  const buckets = new Map<string, typeof parsed.faces>();
  for (const face of parsed.faces) {
    const key = face.color ? face.color.join(',') : '__default';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(face);
    else buckets.set(key, [face]);
  }

  const group = new Group();
  for (const [key, faces] of buckets) {
    const positions = new Float32Array(faces.length * 9);
    for (let f = 0; f < faces.length; f++) {
      const [a, b, c] = faces[f].vertices;
      const va = parsed.vertices[a];
      const vb = parsed.vertices[b];
      const vc = parsed.vertices[c];
      const base = f * 9;
      positions[base + 0] = va[0];
      positions[base + 1] = va[1];
      positions[base + 2] = va[2];
      positions[base + 3] = vb[0];
      positions[base + 4] = vb[1];
      positions[base + 5] = vb[2];
      positions[base + 6] = vc[0];
      positions[base + 7] = vc[1];
      positions[base + 8] = vc[2];
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    const firstFace = faces[0];
    const faceColor = key === '__default' ? null : firstFace.color;
    const mat = coloredMaterial(faceColor, fallbackColor);

    group.add(new Mesh(geom, mat));
  }

  if (group.children.length === 0) return null;
  return group;
}

function coloredMaterial(
  faceColor: [number, number, number, number] | null,
  fallbackColor: number,
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: faceColor
      ? (Math.round(faceColor[0] * 255) << 16) |
        (Math.round(faceColor[1] * 255) << 8) |
        Math.round(faceColor[2] * 255)
      : fallbackColor,
    metalness: faceColor ? 0.05 : 0.6,
    roughness: faceColor ? 0.7 : 0.3,
    envMapIntensity: faceColor ? 0.15 : 0.3,
    transparent: faceColor ? faceColor[3] < 1 : false,
    opacity: faceColor ? faceColor[3] : 1,
  });
}

/**
 * Experimental-only fast attach path. Float32Arrays arrive via transfer from
 * the OFF analysis worker and are adopted without an additional copy.
 * Rendering materials and scene objects remain on the main thread.
 */
export function buildColoredGroupFromPreparedOff(
  prepared: PreparedOffMesh,
  fallbackColor: number,
): Group | null {
  const group = new Group();
  for (const bucket of prepared.buckets) {
    if (bucket.positions.length === 0) continue;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(bucket.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(bucket.normals, 3));
    group.add(new Mesh(geometry, coloredMaterial(bucket.color, fallbackColor)));
  }
  return group.children.length ? group : null;
}

export function disposeColoredGroup(group: Group): void {
  group.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    obj.geometry?.dispose();
    const mat = obj.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
