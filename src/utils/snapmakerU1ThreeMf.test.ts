import {describe,expect,it} from 'vitest';
import {unzipSync} from 'fflate';
import {exportColoredOffAsOrcaThreeMf} from './orcaThreeMfExport';
import {exportColoredOffAsOrcaPartsThreeMf} from './orcaSplitSafeThreeMf';
import {adaptOrca3mfToSnapmakerU1} from './snapmakerU1ThreeMf';

const source = [
  'OFF','8 8 0',
  '-10 -5 -3','-8 -5 -3','-9 -3 -3','-9 -4 -1',
  '10 5 0','12 5 0','11 7 0','11 6 2',
  '3 0 2 1 255 0 0 255','3 0 1 3 255 0 0 255',
  '3 1 2 3 255 0 0 255','3 2 0 3 255 0 0 255',
  '3 4 6 5 0 0 255 255','3 4 5 7 0 0 255 255',
  '3 5 6 7 0 0 255 255','3 6 4 7 0 0 255 255',
].join('\n');
async function unpack(blob:Blob) {
 const entries=unzipSync(new Uint8Array(await blob.arrayBuffer()));
 return {xml:new TextDecoder().decode(entries['3D/3dmodel.model']),
  cfg:JSON.parse(new TextDecoder().decode(entries['Metadata/project_settings.config']))};
}
describe('U1 3MF export',()=>{
 it.each(['0.2','0.4'] as const)('applies the %s nozzle profile but preserves vertices, triangles and colors',async nozzle=>{
  const original=await unpack(exportColoredOffAsOrcaThreeMf(source,'Test'));
  const targeted=await unpack(await adaptOrca3mfToSnapmakerU1(exportColoredOffAsOrcaThreeMf(source,'Test'),nozzle));
  expect(targeted.cfg.printer_model).toBe('Snapmaker U1');
  expect(targeted.cfg.printer_settings_id).toBe('Snapmaker U1 ('+nozzle+' nozzle)');
  expect(targeted.cfg.filament_colour).toEqual(original.cfg.filament_colour);
  expect(targeted.cfg.nozzle_diameter).toEqual([nozzle,nozzle,nozzle,nozzle]);
  expect(targeted.xml).toContain('transform="1 0 0 0 1 0 0 0 1 134.500000 135.000000 3.000000"');
  expect(targeted.xml.match(/<vertex\b[^>]*\/>/g)).toEqual(original.xml.match(/<vertex\b[^>]*\/>/g));
  expect(targeted.xml.match(/<triangle\b[^>]*\/>/g)).toEqual(original.xml.match(/<triangle\b[^>]*\/>/g));
 });
 it('preserves separate parts',async()=>{
  const regular=await exportColoredOffAsOrcaPartsThreeMf(source,'Parts');
  const original=await unpack(regular);
  const targeted=await unpack(await adaptOrca3mfToSnapmakerU1(regular,'0.2'));
  expect((targeted.xml.match(/<component objectid/g)??[])).toHaveLength(2);
  expect(targeted.xml.match(/<triangle\b[^>]*\/>/g)).toEqual(original.xml.match(/<triangle\b[^>]*\/>/g));
 });
});
