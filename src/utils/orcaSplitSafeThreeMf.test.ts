import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { exportColoredOffAsOrcaPartsThreeMf, getOrcaPartsExportOutcome } from './orcaSplitSafeThreeMf';
import { exportColoredOffAsOrcaThreeMf } from './orcaThreeMfExport';

const decoder = new TextDecoder();
type RGB = [number, number, number] | null;

/** Fully closed tetrahedra, already in model coordinates (mm). */
function tetrahedra(facesPerShell: RGB[][]): string {
  const vertices: string[] = [];
  const faces: string[] = [];
  const tetraFaces = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]];
  for (let i = 0; i < facesPerShell.length; i++) {
    const x = i * 15, base = i * 4;
    vertices.push(`${x} 0 3`, `${x + 10} 0 3`, `${x} 10 3`, `${x} 0 13`);
    tetraFaces.forEach(([a, b, c], face) => {
      const rgb = facesPerShell[i][face];
      faces.push(`3 ${base + a} ${base + b} ${base + c}${rgb ? ' ' + rgb.join(' ') : ''}`);
    });
  }
  return ['OFF', `${vertices.length} ${faces.length} 0`, ...vertices, ...faces].join('\n');
}

async function entries(blob: Blob): Promise<Record<string, string>> {
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return Object.fromEntries(Object.entries(zip).map(([k, v]) => [k, decoder.decode(v)]));
}

describe('Orca split-safe parts 3MF', () => {
  it('keeps differently colored closed solids as native independent parts with per-part extruders', async () => {
    const red: RGB = [255, 0, 0];
    const blue: RGB = [0, 0, 255];
    const files = await entries(await exportColoredOffAsOrcaPartsThreeMf(
      tetrahedra([[red, red, red, red], [blue, blue, blue, blue]]),
      'Red & Blue',
    ));
    const xml = files['3D/3dmodel.model'];
    const metadata = files['Metadata/model_settings.config'];
    expect(xml).toContain('unit="millimeter"');
    expect(xml).toContain('<object id="1" type="model" name="Red &amp; Blue"><components>');
    expect(xml).toContain('<component objectid="3"/>');
    expect(xml).toContain('<component objectid="4"/>');
    expect(xml).toContain('<build><item objectid="1"/></build>');
    expect(xml).toContain('<vertex x="15" y="0" z="3"/>');
    expect((xml.match(/<triangle /g) ?? [])).toHaveLength(8);
    expect((xml.match(/<object id="/g) ?? [])).toHaveLength(3);
    // Physical part extruders, rather than fragile painted-face annotations.
    expect(xml).not.toContain('paint_color=');
    expect(xml).toContain('<m:color color="#FF0000FF"/>');
    expect(xml).toContain('<m:color color="#0000FFFF"/>');
    expect(metadata).toContain('<part id="3" subtype="normal_part">');
    expect(metadata).toContain('<part id="4" subtype="normal_part">');
    expect(metadata).toMatch(/<part id="3"[^>]*>[\s\S]*?key="extruder" value="1"/);
    expect(metadata).toMatch(/<part id="4"[^>]*>[\s\S]*?key="extruder" value="2"/);
    const palette = JSON.parse(files['Metadata/project_settings.config']).filament_colour;
    expect(palette).toEqual(['#FF0000', '#0000FF']);
    expect(files['_rels/.rels']).toContain('/3D/3dmodel.model');
  });

  it('retains triangle painting on a multi-color connected shell rather than creating open color surfaces', async () => {
    const red: RGB = [255, 0, 0], blue: RGB = [0, 0, 255];
    const files = await entries(await exportColoredOffAsOrcaPartsThreeMf(
      tetrahedra([[red, red, blue, red], [blue, blue, blue, blue]]),
      'Mixed shell',
    ));
    const model = files['3D/3dmodel.model'];
    // Mixed shell remains one complete closed tetra, not a broken color surface.
    expect((model.match(/<triangle /g) ?? [])).toHaveLength(8);
    expect((model.match(/paint_color=/g) ?? [])).toHaveLength(4);
    expect((model.match(/<object id="/g) ?? [])).toHaveLength(3);
    expect(files['Metadata/model_settings.config']).toContain('Mixed');
  });

  it('exports single-shell color geometry intact without inventing multipart topology', async () => {
    const red: RGB = [255, 0, 0];
    const input = tetrahedra([[red, red, red, red]]);
    const blob = await exportColoredOffAsOrcaPartsThreeMf(input, 'Single');
    const files = await entries(blob);
    const original = await entries(exportColoredOffAsOrcaThreeMf(input, 'Single'));
    expect(files).toEqual(original);
    expect(getOrcaPartsExportOutcome(blob)).toMatchObject({
      mode: 'color-only', reason: 'single-shell',
      closedParts: 0, unsplittableComponents: 1,
    });
    expect((files['3D/3dmodel.model'].match(/<object id="/g) ?? [])).toHaveLength(1);
  });

  it('preserves open non-printable surfaces without pretending they are split-safe', async () => {
    const input = [
      'OFF', '6 2 0',
      '0 0 0', '1 0 0', '0 1 0',
      '10 0 0', '11 0 0', '10 1 0',
      '3 0 1 2 255 0 0', '3 3 4 5 0 0 255',
    ].join('\n');
    const blob = await exportColoredOffAsOrcaPartsThreeMf(input, 'Open');
    const files = await entries(blob);
    const original = await entries(exportColoredOffAsOrcaThreeMf(input, 'Open'));
    expect(files).toEqual(original);
    expect(getOrcaPartsExportOutcome(blob)).toMatchObject({
      mode: 'color-only', reason: 'open-shells', closedParts: 0,
    });
  });

  it('separates closed solids while keeping open face fragments painted and grouped', async () => {
    const red: RGB = [255, 0, 0], blue: RGB = [0, 0, 255];
    const source = tetrahedra([[red, red, red, red], [blue, blue, blue, blue]]);
    const lines = source.split('\n');
    const input = [
      'OFF', '11 9 0',
      ...lines.slice(2, 10),
      '60 0 0', '61 0 0', '60 1 0',
      ...lines.slice(10),
      '3 8 9 10 255 255 255',
    ].join('\n');
    const blob = await exportColoredOffAsOrcaPartsThreeMf(input, 'Three with open face');
    const files = await entries(blob);
    const xml = files['3D/3dmodel.model'];
    expect((xml.match(/<triangle /g) ?? [])).toHaveLength(9);
    expect((xml.match(/<object id="/g) ?? [])).toHaveLength(4);
    expect(xml).toContain('paint_color=');
    expect(xml).toContain('<component objectid="5"/>');
    expect(getOrcaPartsExportOutcome(blob)).toMatchObject({
      mode: 'partial', closedParts: 2, unsplittableComponents: 1,
    });
    const metadata = files['Metadata/model_settings.config'];
    expect(metadata).toMatch(/<part id="3"[^>]*>[\s\S]*?key="extruder" value="1"/);
    expect(metadata).toMatch(/<part id="4"[^>]*>[\s\S]*?key="extruder" value="2"/);
    expect(metadata).toContain('<part id="5" subtype="normal_part"><metadata key="name"');
    expect(metadata).not.toMatch(/<part id="5"[^>]*>[\s\S]*?key="extruder"/);
  });



  it('does not fail on large high-resolution OFF and clearly reports the safe color-only fallback', async () => {
    // 250,001 triangles is deliberately too expensive for browser edge maps;
    // the ordinary color exporter must still retain the full mesh and colors.
    const faceCount = 250_001;
    const header = 'OFF\n3 ' + faceCount + ' 0\n0 0 0\n1 0 0\n0 1 0\n';
    const input = header + '3 0 1 2 255 0 0\n'.repeat(faceCount);
    const blob = await exportColoredOffAsOrcaPartsThreeMf(input, 'Large');
    expect(getOrcaPartsExportOutcome(blob)).toMatchObject({
      mode: 'color-only', reason: 'complexity',
    });
    const files = await entries(blob);
    const xml = files['3D/3dmodel.model'];
    expect((xml.match(/<triangle /g) ?? [])).toHaveLength(faceCount);
    expect(xml).toContain('<m:color color="#FF0000FF"/>');
  });
  it('never fabricates an extruder for palettes beyond supported virtual filament limits', async () => {
    const shades: RGB[][] = Array.from({ length: 17 }, (_, i) =>
      Array.from({ length: 4 }, () => [i * 12, 20, 150] as RGB),
    );
    const files = await entries(await exportColoredOffAsOrcaPartsThreeMf(
      tetrahedra(shades), 'Seventeen',
    ));
    const model = files['3D/3dmodel.model'];
    expect((model.match(/<m:color /g) ?? [])).toHaveLength(17);
    expect((model.match(/<triangle /g) ?? [])).toHaveLength(68);
    expect(model).not.toContain('paint_color=');
    expect(files['Metadata/project_settings.config']).toBeUndefined();
    expect(files['Metadata/model_settings.config']).not.toContain('key="extruder" value="17"');
  });
});
