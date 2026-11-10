import { unzipSync, zipSync } from 'fflate';

export type SnapmakerU1Nozzle = '0.2' | '0.4';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const printableArea = ['0.5x1','270.5x1','270.5x271','0.5x271'];

/** Add Snapmaker Orca 2.4.1 U1 project metadata and 3MF build-item
 * placement. Geometry, colors and component structure are untouched.
 * The number of virtual RGB entries is independent of four print heads.
 */
export async function adaptOrca3mfToSnapmakerU1(
  blob: Blob,
  nozzle: SnapmakerU1Nozzle,
): Promise<Blob> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const bytes = files['3D/3dmodel.model'];
  if (!bytes) throw new Error('Missing 3MF model.');
  const xml = decoder.decode(bytes);
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  let vertices = 0;
  for (const match of xml.matchAll(/<vertex\b([^>]*)\/>/g)) {
    const vertex = ['x','y','z'].map(axis => {
      const value = match[1].match(new RegExp(axis + '="([^"]+)"'));
      return value ? Number(value[1]) : NaN;
    });
    if (vertex.some(x => !Number.isFinite(x))) throw new Error('Invalid 3MF vertex coordinates.');
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i],vertex[i]);
      max[i] = Math.max(max[i],vertex[i]);
    }
    vertices++;
  }
  const oldBuild = '<build><item objectid="1"/></build>';
  if (vertices === 0 || !xml.includes(oldBuild)) {
    throw new Error('U1 export requires a native Brepia Orca 3MF.');
  }
  if (max[0]-min[0] > 270 || max[1]-min[1] > 270 || max[2]-min[2] > 270.05) {
    throw new Error('Model exceeds U1 build volume (270 × 270 × 270 mm).');
  }
  const fmt = (x: number) => (Math.abs(x) < 0.0000005 ? 0 : x).toFixed(6);
  const tx = 135.5 - (min[0]+max[0])/2;
  const ty = 136 - (min[1]+max[1])/2;
  const tz = -min[2];
  const matrix = ['1','0','0','0','1','0','0','0','1',fmt(tx),fmt(ty),fmt(tz)].join(' ');
  files['3D/3dmodel.model'] = encoder.encode(
    xml.replace(oldBuild,'<build><item objectid="1" transform="' + matrix + '"/></build>'),
  );
  const oldSettings = files['Metadata/project_settings.config']
    ? JSON.parse(decoder.decode(files['Metadata/project_settings.config'])) as Record<string, unknown>
    : {};
  const profile = 'Snapmaker U1 (' + nozzle + ' nozzle)';
  const virtualColors = Array.isArray(oldSettings.filament_colour) ? oldSettings.filament_colour : [];
  const settings = {
    ...oldSettings,
    printer_model: 'Snapmaker U1',
    printer_settings_id: profile,
    printer_variant: nozzle,
    printer_technology: 'FFF',
    print_compatible_printers: [profile],
    printable_area: printableArea,
    printable_height: '270.05',
    default_bed_type: 'Textured PEI Plate',
    curr_bed_type: 'Textured PEI Plate',
    nozzle_diameter: [nozzle,nozzle,nozzle,nozzle],
    filament_settings_id: Array(virtualColors.length || 1).fill('Generic PLA @U1 ' + nozzle + ' nozzle'),
  };
  files['Metadata/project_settings.config'] = encoder.encode(JSON.stringify(settings));
  return new Blob([zipSync(files,{level:6})],{type:'model/3mf'});
}
