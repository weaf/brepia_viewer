import { zipSync } from 'fflate';
import { parseColoredOff } from './offParser';

/**
 * Orca/Bambu 3MF color project, derived from the same colored OFF geometry
 * used for OpenSCAD preview. No viewer-only centering or rotation is applied.
 *
 * All unique OpenSCAD colors are preserved independently of the physical
 * printer's nozzle count in the standard 3MF color group. Orca-specific
 * paint_color encodes virtual filament indices (NOT RGB) for the subset
 * OrcaSlicer's painting tool can address. Its matching palette goes in
 * Metadata/project_settings.config. Neither channel identifies real spools:
 * users must map filament colors to their available nozzles before printing.
 */
const encoder = new TextEncoder();
// The painting tool supports sixteen virtual filaments. This is NOT a limit
// on the RGB colors stored in standard 3MF geometry or on exporting a model.
const MAX_SLICER_PAINT_FILAMENTS = 16;
const MAX_OFF_CHARACTERS = 80_000_000;
const MAX_TRIANGLES = 1_000_000;
const UNCOLORED_PLACEHOLDER = '#A0A0A0';

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[char] as string));
}

function toHexByte(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('OpenSCAD OFF contains an invalid face color.');
  }
  return Math.round(value * 255).toString(16).padStart(2, '0').toUpperCase();
}

export function explicitFaceColor(
  color: [number, number, number, number] | null,
): string | null {
  if (!color) return null;
  const [r, g, b, alpha] = color;
  // alpha controls visualization, not the choice of opaque print filament
  void toHexByte(alpha);
  const hex = `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  // The OpenSCAD WASM manifold backend paints otherwise uncolored surfaces
  // with these scheme defaults. They are not user-selected print filaments.
  if (hex === '#F9D72C' || hex === '#9DCB51') return null;
  return hex;
}

function paintCode(slot: number): string {
  if (slot === 1) return '4';
  if (slot === 2) return '8';
  if (slot >= 3 && slot <= MAX_SLICER_PAINT_FILAMENTS) {
    return `${(slot - 3).toString(16).toUpperCase()}C`;
  }
  throw new Error('Unsupported OrcaSlicer filament slot.');
}

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/octet-stream"/></Types>`;
const relationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

/**
 * The result is a color-preserving 3MF PROJECT, not a pre-sliced print.
 * There is no nozzle-dependent limit on colors in the file. Orca painting
 * metadata is included only for palettes its painting tool can represent.
 */
export function exportColoredOffAsOrcaThreeMf(offText: string, title: string): Blob {
  if (offText.length > MAX_OFF_CHARACTERS) {
    throw new Error('Color geometry is too large to export safely in this browser.');
  }
  const parsed = parseColoredOff(offText);
  if (!parsed.vertices.length || !parsed.faces.length) {
    throw new Error('OpenSCAD OFF has no printable triangles.');
  }
  if (parsed.faces.length > MAX_TRIANGLES) {
    throw new Error('Model contains too many triangles for browser color export.');
  }

  const faceColors = parsed.faces.map((face) => explicitFaceColor(face.color));
  const hasUncoloredFaces = faceColors.some((color) => color === null);
  const palette: string[] = hasUncoloredFaces ? [UNCOLORED_PLACEHOLDER] : [];
  const slotForColor = new Map<string, number>();

  // When every face has an explicit color, the first one becomes slot 1.
  // Otherwise slot 1 is reserved for the neutral uncolored placeholder.
  for (const color of faceColors) {
    if (color === null || slotForColor.has(color)) continue;
    palette.push(color);
    slotForColor.set(color, palette.length);
  }

  for (const vertex of parsed.vertices) {
    if (vertex.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error('OpenSCAD OFF contains invalid vertex coordinates.');
    }
  }

  const vertices = parsed.vertices.map(([x, y, z]) =>
    `<vertex x="${x}" y="${y}" z="${z}"/>`,
  ).join('');

  const hasDeclaredColors = slotForColor.size > 0;
  // Never silently assign an unsupported paint index to a different filament.
  // For more than sixteen distinct colors, keep every RGB face in the standard
  // 3MF material group, but omit Orca-specific filament/painting metadata.
  const hasSlicerPainting = hasDeclaredColors &&
    palette.length <= MAX_SLICER_PAINT_FILAMENTS;
  const triangles = parsed.faces.map((face, index) => {
    const [v1, v2, v3] = face.vertices;
    const color = faceColors[index];
    const slot = color === null ? 1 : slotForColor.get(color);
    if (!slot) throw new Error('An OpenSCAD face has no filament mapping.');
    const standardColor = hasDeclaredColors
      ? ` pid="2" p1="${slot - 1}" p2="${slot - 1}" p3="${slot - 1}"`
      : '';
    const paintColor = hasSlicerPainting && color !== null
      ? ` paint_color="${paintCode(slot)}"`
      : '';
    return `<triangle v1="${v1}" v2="${v2}" v3="${v3}"${standardColor}${paintColor}/>`;
  }).join('');

  const materialNamespace = hasDeclaredColors
    ? ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m"'
    : '';
  const colorGroup = hasDeclaredColors
    ? `<m:colorgroup id="2">${palette.map((hex) => `<m:color color="${hex}FF"/>`).join('')}</m:colorgroup>`
    : '';
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${materialNamespace}>
<metadata name="Title">${escapeXml(title)}</metadata>
<metadata name="Application">Brepia Viewer</metadata>
<resources>${colorGroup}<object id="1" type="model" name="${escapeXml(title)}"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object></resources>
<build><item objectid="1"/></build>
</model>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': encoder.encode(contentTypes),
    '_rels/.rels': encoder.encode(relationships),
    '3D/3dmodel.model': encoder.encode(model),
  };

  if (hasSlicerPainting) {
    // The full logical palette is available to Orca even if the selected
    // printer has fewer physical nozzles. This is not a physical spool map.
    // This is only a suggested RGB palette and provisional material type.
    // The user must choose actual filament profiles and verify availability.
    const settings = {
      filament_colour: palette,
      filament_type: palette.map(() => 'PLA'),
      filament_settings_id: palette.map(() => 'Generic PLA'),
    };
    files['Metadata/project_settings.config'] = encoder.encode(JSON.stringify(settings));
    files['Metadata/model_settings.config'] = encoder.encode(
      '<?xml version="1.0" encoding="UTF-8"?><config><object id="1"><metadata key="extruder" value="1"/></object></config>',
    );
  }

  const archive = zipSync(files, { level: 6 });
  return new Blob([archive], { type: 'model/3mf' });
}
