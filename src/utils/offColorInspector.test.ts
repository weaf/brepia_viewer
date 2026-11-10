import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { exportColoredOffAsOrcaThreeMf } from './orcaThreeMfExport';
import { exportColoredOffAsOrcaPartsThreeMf, getOrcaPartsExportOutcome } from './orcaSplitSafeThreeMf';
import { inspectColoredOff, MAX_OFF_INSPECTION_TRIANGLES } from './offColorInspector';

type RGB = [number, number, number] | null;
const tetraFaces = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]];

function tetrahedra(shells: RGB[][]): string {
  const vertices: string[] = [];
  const faces: string[] = [];
  shells.forEach((colors, i) => {
    const base = vertices.length;
    const x = i * 20;
    vertices.push(
      String(x) + ' 0 0',
      String(x + 10) + ' 0 0',
      String(x) + ' 10 0',
      String(x) + ' 0 10',
    );
    tetraFaces.forEach(([a, b, c], face) => {
      const color = colors[face];
      faces.push('3 ' + [base + a, base + b, base + c].join(' ') + (color ? ' ' + color.join(' ') : ''));
    });
  });
  return ['OFF', vertices.length + ' ' + faces.length + ' 0', ...vertices, ...faces].join('\n');
}

describe('OFF component and color inspection', () => {
  it('agrees with Orca Parts on two closed independent single-color shells', async () => {
    const red: RGB = [255, 0, 0], blue: RGB = [0, 0, 255];
    const source = tetrahedra([[red, red, red, red], [blue, blue, blue, blue]]);
    const inspected = inspectColoredOff(source);
    expect(inspected.topology).toBe('inspected');
    expect(inspected.triangleCount).toBe(8);
    expect(inspected.palette).toEqual([
      { hex: '#FF0000', triangleCount: 4 },
      { hex: '#0000FF', triangleCount: 4 },
    ]);
    expect(inspected.components).toHaveLength(2);
    expect(inspected.components.map(c => c.singleRgbColor)).toEqual(['#FF0000', '#0000FF']);
    expect(inspected.components.every(c => c.edgeClosed && c.nonTwoIncidentEdgeUses === 0)).toBe(true);
    const outcome = getOrcaPartsExportOutcome(await exportColoredOffAsOrcaPartsThreeMf(source, 'Two'));
    expect(outcome?.mode).toBe('multipart');
    expect(outcome?.closedParts).toBe(2);
  });

  it('does not confuse two surface colors with separate objects', async () => {
    const red: RGB = [255, 0, 0], blue: RGB = [0, 0, 255];
    const source = tetrahedra([[red, red, blue, red]]);
    const inspection = inspectColoredOff(source);
    expect(inspection.palette).toHaveLength(2);
    expect(inspection.components).toHaveLength(1);
    expect(inspection.components[0].edgeClosed).toBe(true);
    expect(inspection.components[0].singleRgbColor).toBeNull();
    const blob = await exportColoredOffAsOrcaPartsThreeMf(source, 'Mixed');
    expect(getOrcaPartsExportOutcome(blob)?.mode).toBe('color-only');
  });

  it('marks separate open triangles as open and not printable', async () => {
    const source = [
      'OFF', '6 2 0',
      '0 0 0', '1 0 0', '0 1 0',
      '10 0 0', '11 0 0', '10 1 0',
      '3 0 1 2 255 0 0', '3 3 4 5 0 0 255',
    ].join('\n');
    const result = inspectColoredOff(source);
    expect(result.components).toHaveLength(2);
    expect(result.components.every(c => !c.edgeClosed && c.nonTwoIncidentEdgeUses === 3)).toBe(true);
    expect(result.components.map(c => c.singleRgbColor)).toEqual([null, null]);
    const output = await exportColoredOffAsOrcaPartsThreeMf(source, 'Open');
    expect(getOrcaPartsExportOutcome(output)?.mode).toBe('color-only');
  });

  it('matches Orca RGB handling for OpenSCAD default yellow and uncolored faces', () => {
    const yellow: RGB = [249, 215, 44], red: RGB = [255, 0, 0];
    const result = inspectColoredOff(tetrahedra([[yellow, red, null, red]]));
    expect(result.palette).toEqual([{ hex: '#FF0000', triangleCount: 2 }]);
    expect(result.uncoloredTriangles).toBe(2);
    expect(result.components[0].singleRgbColor).toBeNull();
  });

  it('keeps all 17 distinct RGB colors, independent of virtual paint slots or nozzles', async () => {
    const colors: RGB[][] = Array.from({ length: 17 }, (_, i) => {
      const rgb: RGB = [1 + i, 48 + i, 100 + i];
      return [rgb, rgb, rgb, rgb];
    });
    const source = tetrahedra(colors);
    const inspected = inspectColoredOff(source);
    expect(inspected.palette).toHaveLength(17);
    const blob = exportColoredOffAsOrcaThreeMf(source, 'Seventeen colors');
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const xml = new TextDecoder().decode(files['3D/3dmodel.model']);
    for (const color of inspected.palette) {
      expect(xml).toContain('color="' + color.hex + 'FF"');
    }
  });

  it('skips expensive topology but still reports raw palette for large meshes', () => {
    const triangles = MAX_OFF_INSPECTION_TRIANGLES + 1;
    const source = ['OFF', '3 ' + triangles + ' 0',
      '0 0 0', '1 0 0', '0 1 0',
      ...Array.from({ length: triangles }, () => '3 0 1 2 255 0 0'),
    ].join('\n');
    const result = inspectColoredOff(source);
    expect(result.topology).toBe('skipped-for-complexity');
    expect(result.components).toHaveLength(0);
    expect(result.palette).toEqual([{ hex: '#FF0000', triangleCount: triangles }]);
  });

  it('rejects invalid vertices instead of presenting unreliable shell geometry', () => {
    expect(() => inspectColoredOff(['OFF', '3 1 0', 'NaN 0 0', '1 0 0', '0 1 0', '3 0 1 2'].join('\n'))).toThrow(/non-finite/);
  });
});
