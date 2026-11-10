import { parseColoredOff, type ParsedOff } from './offParser';
import { explicitFaceColor } from './orcaThreeMfExport';
import { connectedClosedShells } from './orcaSplitSafeThreeMf';

/**
 * Read-only, raw OFF inspection. Component means an edge-connected triangle
 * island, not an OpenSCAD source object, slicer component or printable part.
 *
 * Color interpretation is intentionally shared with the Orca 3MF exporter.
 * Component topology is intentionally shared with Orca Parts split logic.
 */
export interface OffColorInspection {
  triangleCount: number;
  palette: Array<{ hex: string; triangleCount: number }>;
  uncoloredTriangles: number;
  topology: 'inspected' | 'skipped-for-complexity';
  components: Array<{
    index: number;
    triangleCount: number;
    edgeClosed: boolean;
    nonTwoIncidentEdgeUses: number;
    palette: string[];
    uncoloredTriangles: number;
    singleRgbColor: string | null;
  }>;
}

// Keep expensive edge-map construction off the critical path for large models.
// A later worker-based panel can raise this limit after profiling.
export const MAX_OFF_INSPECTION_TRIANGLES = 12_000;

export function inspectColoredOff(text: string): OffColorInspection {
  if (text.length > 80_000_000) {
    throw new Error('OFF model too large for safe browser inspection.');
  }
  return inspectParsedColoredOff(parseColoredOff(text));
}

export function inspectParsedColoredOff(parsed: ParsedOff): OffColorInspection {
  if (!parsed.vertices.length || !parsed.faces.length) {
    throw new Error('OFF model has no triangle geometry.');
  }
  if (parsed.vertices.some(vertex => vertex.some(value => !Number.isFinite(value)))) {
    throw new Error('OFF model contains non-finite vertex coordinates.');
  }

  const faceColors = parsed.faces.map(face => explicitFaceColor(face.color));
  const paletteCounts = new Map<string, number>();
  let uncoloredTriangles = 0;
  for (const hex of faceColors) {
    if (hex === null) uncoloredTriangles++;
    else paletteCounts.set(hex, (paletteCounts.get(hex) ?? 0) + 1);
  }
  const base = {
    triangleCount: parsed.faces.length,
    palette: Array.from(paletteCounts, ([hex, triangleCount]) => ({ hex, triangleCount })),
    uncoloredTriangles,
  };
  if (parsed.faces.length > MAX_OFF_INSPECTION_TRIANGLES) {
    return { ...base, topology: 'skipped-for-complexity', components: [] };
  }

  const shells = connectedClosedShells(parsed);
  return {
    ...base,
    topology: 'inspected',
    components: shells.map((shell, index) => {
      const shellPalette = new Set<string>();
      let shellUncolored = 0;
      for (const faceIndex of shell.faceIndices) {
        const hex = faceColors[faceIndex];
        if (hex === null) shellUncolored++;
        else shellPalette.add(hex);
      }
      const colors = Array.from(shellPalette);
      return {
        index: index + 1,
        triangleCount: shell.faceIndices.length,
        edgeClosed: shell.closed,
        nonTwoIncidentEdgeUses: shell.openEdges,
        palette: colors,
        uncoloredTriangles: shellUncolored,
        // A mixed-colored closed shell is never called a single-color part.
        singleRgbColor: shell.closed && shellUncolored === 0 && colors.length === 1
          ? colors[0] : null,
      };
    }),
  };
}
