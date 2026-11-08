import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { exportColoredOffAsOrcaThreeMf } from './orcaThreeMfExport';

const decoder = new TextDecoder();

function off(colors: Array<[number, number, number] | null>): string {
  const vertices: string[] = [];
  const faces: string[] = [];
  for (let index = 0; index < colors.length; index++) {
    const base = index * 3;
    vertices.push(`${base} 0 1`, `${base + 1} 0 1`, `${base} 1 1`);
    const color = colors[index];
    faces.push(
      `3 ${base} ${base + 1} ${base + 2}${color ? ' ' + color.join(' ') + ' 255' : ''}`,
    );
  }
  return ['OFF', `${vertices.length} ${faces.length} 0`, ...vertices, ...faces].join('\n');
}

async function contents(blob: Blob): Promise<Record<string, string>> {
  const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return Object.fromEntries(Object.entries(archive).map(
    ([name, bytes]) => [name, decoder.decode(bytes)],
  ));
}

describe('OrcaSlicer color 3MF export', () => {
  it('keeps raw OpenSCAD geometry, mm units, original winding, and palette', async () => {
    const files = await contents(exportColoredOffAsOrcaThreeMf(
      off([[255, 0, 0], [0, 255, 0], [0, 0, 255]]),
      'Three & colors',
    ));
    const xml = files['3D/3dmodel.model'];
    const settings = JSON.parse(files['Metadata/project_settings.config']);
    expect(xml).toContain('unit="millimeter"');
    expect(xml).toContain('Three &amp; colors');
    expect(xml).toContain('<vertex x="0" y="0" z="1"/>');
    expect(xml).toContain('<vertex x="6" y="1" z="1"/>');
    expect(xml).toContain('<triangle v1="0" v2="1" v3="2" pid="2" p1="0" p2="0" p3="0" paint_color="4"/>');
    expect(xml).toContain('paint_color="8"');
    expect(xml).toContain('paint_color="0C"');
    expect(xml).toContain('<m:color color="#FF0000FF"/>');
    expect(xml).toContain('<m:color color="#00FF00FF"/>');
    expect(xml).toContain('<m:color color="#0000FFFF"/>');
    expect(settings.filament_colour).toEqual(['#FF0000', '#00FF00', '#0000FF']);
    expect(settings.filament_type).toEqual(['PLA', 'PLA', 'PLA']);
    expect(files['Metadata/model_settings.config']).toContain('key="extruder" value="1"');
    expect(files['_rels/.rels']).toContain('/3D/3dmodel.model');
  });

  it('reserves default extruder for uncolored faces and maps named colors to following slots', async () => {
    const files = await contents(exportColoredOffAsOrcaThreeMf(
      off([null, [255, 0, 0], [157, 203, 81], [0, 0, 255]]),
      'Mixed',
    ));
    const xml = files['3D/3dmodel.model'];
    const palette = JSON.parse(files['Metadata/project_settings.config']).filament_colour;
    expect(palette).toEqual(['#A0A0A0', '#FF0000', '#0000FF']);
    expect((xml.match(/<triangle /g) ?? [])).toHaveLength(4);
    expect((xml.match(/paint_color="8"/g) ?? [])).toHaveLength(1);
    expect((xml.match(/paint_color="0C"/g) ?? [])).toHaveLength(1);
  });

  it('preserves legacy no-color behavior and creates no misleading color project metadata', async () => {
    const files = await contents(exportColoredOffAsOrcaThreeMf(off([null, null]), 'Plain'));
    expect(files['Metadata/project_settings.config']).toBeUndefined();
    expect(files['3D/3dmodel.model']).not.toContain('paint_color=');
    expect(files['3D/3dmodel.model']).not.toContain('colorgroup');
    expect((files['3D/3dmodel.model'].match(/<triangle /g) ?? [])).toHaveLength(2);
  });

  it('accepts exactly four filament slots and rejects a fifth', async () => {
    const four = off([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]);
    const files = await contents(exportColoredOffAsOrcaThreeMf(four, 'Four'));
    expect(files['3D/3dmodel.model']).toContain('paint_color="1C"');
    const five = off([
      [255, 0, 0], [0, 255, 0], [0, 0, 255],
      [255, 255, 255], [0, 0, 0],
    ]);
    expect(() => exportColoredOffAsOrcaThreeMf(five, 'Five')).toThrow('more than 4 filaments');
  });

  it('fails clearly on invalid face data, empty OFF, and nonfinite coordinates', () => {
    expect(() => exportColoredOffAsOrcaThreeMf('', 'Empty')).toThrow();
    expect(() => exportColoredOffAsOrcaThreeMf('OFF\n0 0 0', 'Empty')).toThrow('no printable triangles');
    expect(() => exportColoredOffAsOrcaThreeMf(
      'OFF\n3 1 0\nNaN 0 0\n1 0 0\n0 1 0\n3 0 1 2 255 0 0',
      'Bad',
    )).toThrow('invalid vertex coordinates');
  });

  it('returns an actual 3MF ZIP with usable MIME and OPC relationship metadata', async () => {
    const blob = exportColoredOffAsOrcaThreeMf(off([[255, 0, 0]]), 'Single');
    expect(blob.type).toBe('model/3mf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(decoder.decode(bytes.slice(0, 2))).toBe('PK');
    const files = await contents(blob);
    expect(Object.keys(files).sort()).toEqual([
      '3D/3dmodel.model',
      'Metadata/model_settings.config',
      'Metadata/project_settings.config',
      '[Content_Types].xml',
      '_rels/.rels',
    ]);
  });
});
