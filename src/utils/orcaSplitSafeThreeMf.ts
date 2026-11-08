import { unzipSync, zipSync } from 'fflate';
import { exportColoredOffAsOrcaThreeMf } from './orcaThreeMfExport';
import { parseColoredOff, type ParsedOff } from './offParser';

/**
 * An opt-in Orca/Bambu multi-part 3MF.
 *
 * Orca's paint_color annotation belongs to triangle topology and can be
 * discarded by Split/Cut. Solid, single-color shells are instead written as
 * real 3MF components with per-part extruder metadata. Multi-color shells
 * retain their original triangle paint (not guaranteed through Cut).
 *
 * Never split by RGB face group alone: that creates open/non-printable shells.
 */
const MAX_PARTS = 256;
const MAX_SPLIT_TRIANGLES = 250_000;

/** A file can preserve full RGB even when a reliable independent-part split
 * is not possible. These outcomes must not be presented as split-safe. */
export type OrcaPartsExportOutcome = {
  mode: 'multipart' | 'partial' | 'color-only';
  closedParts: number;
  unsplittableComponents: number;
  reason?: 'single-shell' | 'open-shells' | 'complexity' | 'part-count';
};
const outcomes = new WeakMap<Blob, OrcaPartsExportOutcome>();
export function getOrcaPartsExportOutcome(blob: Blob): OrcaPartsExportOutcome | undefined {
  return outcomes.get(blob);
}
function withOutcome(blob: Blob, outcome: OrcaPartsExportOutcome): Blob {
  outcomes.set(blob, outcome);
  return blob;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function xmlEscape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[c] as string);
}

class DisjointSet {
  private readonly parent: Int32Array;
  constructor(size: number) {
    this.parent = Int32Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[i] !== i) {
      const next = this.parent[i];
      this.parent[i] = root;
      i = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootB] = rootA;
  }
}

type Component = { faceIndices: number[]; closed: boolean };

/** Connect faces by shared *edges*, never by merely touching vertices. */
function connectedClosedShells(parsed: ParsedOff): Component[] {
  const faces = parsed.faces;
  if (faces.length > MAX_SPLIT_TRIANGLES) {
    throw new Error(
      'This model has too many triangles for browser-based split-safe export. Use Orca Color .3MF.',
    );
  }
  const dsu = new DisjointSet(faces.length);
  // Use exact OFF coordinates as vertex identities. Distinct vertex indices at
  // the same coordinate should not create artificial seams, but near-by parts
  // must not be welded together by an arbitrary rounding tolerance.
  const vertexKeys = parsed.vertices.map((v) => v.join(','));
  const edgeOwners = new Map<string, { first: number; count: number }>();
  const faceEdges: string[][] = new Array(faces.length);
  for (let i = 0; i < faces.length; i++) {
    const [a, b, c] = faces[i].vertices;
    const edges = [[a, b], [b, c], [c, a]].map(([v1, v2]) => {
      const k1 = vertexKeys[v1];
      const k2 = vertexKeys[v2];
      return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
    });
    faceEdges[i] = edges;
    for (const key of edges) {
      const owner = edgeOwners.get(key);
      if (owner) {
        dsu.union(i, owner.first);
        owner.count += 1;
      } else edgeOwners.set(key, { first: i, count: 1 });
    }
  }
  const groups = new Map<number, Component>();
  for (let i = 0; i < faces.length; i++) {
    const root = dsu.find(i);
    const existing = groups.get(root);
    if (existing) existing.faceIndices.push(i);
    else groups.set(root, { faceIndices: [i], closed: true });
  }
  for (const component of groups.values()) {
    component.closed = component.faceIndices.every((index) =>
      faceEdges[index].every((key) => edgeOwners.get(key)?.count === 2),
    );
  }
  return [...groups.values()];
}

/** Keep exact triangle colors and winding while reindexing each shell locally. */
function writeShell(
  component: Component,
  parsed: ParsedOff,
  originalTriangles: string[],
  originalVertices: string[],
): { xml: string; slot: number | null } {
  const indexMap = new Map<number, number>();
  const vertices: string[] = [];
  const triangles: string[] = [];
  const slots = new Set<number>();
  let allColored = true;
  for (const i of component.faceIndices) {
    const triangle = originalTriangles[i];
    const material = triangle.match(/\bp1="(\d+)"/);
    if (material) slots.add(Number(material[1]) + 1);
    else allColored = false;
    const transformed = triangle.replace(/\bv([123])="(\d+)"/g, (_, n: string, value: string) => {
      const oldIndex = Number(value);
      let newIndex = indexMap.get(oldIndex);
      if (newIndex === undefined) {
        newIndex = vertices.length;
        indexMap.set(oldIndex, newIndex);
        vertices.push(originalVertices[oldIndex]);
      }
      return `v${n}="${newIndex}"`;
    });
    triangles.push(transformed);
  }
  // Only watertight, uniform-color shells can use a persistent part extruder.
  // Open or mixed shells keep their original per-face paint and color metadata.
  const singleColor = component.closed && allColored && slots.size === 1
    ? [...slots][0] : null;
  // Once the whole *solid* has one color, its permanent part extruder carries
  // the color across Orca Split and edit operations. Painted triangles would
  // override that extruder and may disappear on splitting.
  const content = singleColor !== null
    ? triangles.map((t) => t.replace(/ paint_color="[^"]*"/g, '')).join('')
    : triangles.join('');
  return {
    xml: `<mesh><vertices>${vertices.join('')}</vertices><triangles>${content}</triangles></mesh>`,
    slot: singleColor,
  };
}

export async function exportColoredOffAsOrcaPartsThreeMf(
  offText: string,
  title: string,
): Promise<Blob> {
  const parsed = parseColoredOff(offText);
  if (parsed.faces.length === 0) throw new Error('OpenSCAD OFF has no printable triangles.');

  // Always validate and retain the proven, color-preserving export before any
  // shell operations. A failed / unsupported split must not block saving.
  const regular = exportColoredOffAsOrcaThreeMf(offText, title);
  const colorOnly = (
    reason: OrcaPartsExportOutcome['reason'],
    closedParts = 0,
    unsplittableComponents = 1,
  ): Blob => withOutcome(regular, {
    mode: 'color-only', closedParts, unsplittableComponents, reason,
  });

  // Avoid expensive string edge maps for high-resolution meshes on mobile.
  // Their geometry and paint still export unchanged instead of being rejected.
  if (parsed.faces.length > MAX_SPLIT_TRIANGLES) {
    return colorOnly('complexity');
  }
  const shells = connectedClosedShells(parsed);
  if (shells.length < 2) return colorOnly('single-shell');
  if (shells.length > MAX_PARTS) return colorOnly('part-count');

  const closed = shells.filter((part) => part.closed);
  const open = shells.filter((part) => !part.closed);
  if (!closed.length) return colorOnly('open-shells', 0, open.length);

  // Keep open fragments TOGETHER with every original triangle and per-face
  // color; never misrepresent them as separate printable, closed solids.
  // Closed components remain independently addressable, even when one small
  // face detail is incomplete. This avoids rejecting the entire assembly.
  const parts: Component[] = [...closed];
  if (open.length) {
    parts.push({
      faceIndices: open.flatMap((part) => part.faceIndices).sort((a, b) => a - b),
      closed: false,
    });
  }

  // Reuse exact color and paint codes from the production Orca exporter.
  const files = unzipSync(new Uint8Array(await regular.arrayBuffer()));
  const originalModel = decoder.decode(files['3D/3dmodel.model']);
  const originalVertices = [...originalModel.matchAll(/<vertex\b[^>]*\/>/g)].map((m) => m[0]);
  const originalTriangles = [...originalModel.matchAll(/<triangle\b[^>]*\/>/g)].map((m) => m[0]);
  if (
    originalVertices.length !== parsed.vertices.length ||
    originalTriangles.length !== parsed.faces.length
  ) {
    throw new Error('3MF geometry does not match the OpenSCAD color mesh.');
  }
  const colors = originalModel.match(/<m:colorgroup\b[\s\S]*?<\/m:colorgroup>/)?.[0] ?? '';
  const leafXml: string[] = [];
  const components: string[] = [];
  const partSettings: string[] = [];
  const palette = files['Metadata/project_settings.config']
    ? JSON.parse(decoder.decode(files['Metadata/project_settings.config'])) as { filament_colour?: string[] }
    : null;

  for (let part = 0; part < parts.length; part++) {
    const id = part + 3; // id=1 is assembly, id=2 reserved for 3MF color group
    const shell = writeShell(parts[part], parsed, originalTriangles, originalVertices);
    const assignedSlot = shell.slot !== null &&
      palette && shell.slot <= (palette.filament_colour?.length ?? 0)
      ? shell.slot : null;
    const colorName = shell.slot !== null
      ? (palette?.filament_colour?.[shell.slot - 1] ?? 'Color')
      : 'Mixed';
    const name = xmlEscape(`${title} – part ${part + 1} (${colorName})`);
    leafXml.push(`<object id="${id}" type="model" name="${name}">${shell.xml}</object>`);
    components.push(`<component objectid="${id}"/>`);
    partSettings.push(
      `<part id="${id}" subtype="normal_part"><metadata key="name" value="${name}"/>${assignedSlot !== null ? `<metadata key="extruder" value="${assignedSlot}"/>` : ''}</part>`,
    );
  }

  const wrapper = `<object id="1" type="model" name="${xmlEscape(title)}"><components>${components.join('')}</components></object>`;
  const modified = originalModel.replace(
    /<resources>[\s\S]*?<\/resources>/,
    `<resources>${colors}${leafXml.join('')}${wrapper}</resources>`,
  );
  if (modified === originalModel) throw new Error('Could not assemble multi-part 3MF structure.');
  files['3D/3dmodel.model'] = encoder.encode(modified);
  files['Metadata/model_settings.config'] = encoder.encode(
    `<?xml version="1.0" encoding="UTF-8"?><config><object id="1"><metadata key="name" value="${xmlEscape(title)}"/><metadata key="extruder" value="1"/>${partSettings.join('')}</object></config>`,
  );
  return withOutcome(new Blob([zipSync(files, { level: 6 })], { type: 'model/3mf' }), {
    mode: open.length ? 'partial' : 'multipart',
    closedParts: closed.length,
    unsplittableComponents: open.length,
  });
}
