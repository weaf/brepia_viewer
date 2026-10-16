export const OPENSCAD_EXPORT_FORMATS = [
  { id: 'stl', label: '.STL', description: '3D mesh', mimeType: 'model/stl', exportFormat: 'binstl', enabled: true },
  { id: 'off', label: '.OFF', description: 'Mesh with color support', mimeType: 'application/octet-stream', exportFormat: 'off', enabled: true },
  { id: 'wrl', label: '.WRL', description: 'VRML model', mimeType: 'model/vrml', exportFormat: 'wrl', enabled: true },
  { id: 'amf', label: '.AMF', description: 'Additive manufacturing', mimeType: 'application/x-amf', exportFormat: 'amf', enabled: true },
  { id: '3mf', label: '.3MF', description: '3D Manufacturing Format', mimeType: 'model/3mf', exportFormat: '3mf', enabled: true },
  { id: 'csg', label: '.CSG', description: 'Constructive solid geometry', mimeType: 'text/plain', exportFormat: 'csg', enabled: true },
  { id: 'dxf', label: '.DXF', description: '2D projection', mimeType: 'application/dxf', exportFormat: 'dxf', enabled: true },
  { id: 'svg', label: '.SVG', description: '2D vector drawing', mimeType: 'image/svg+xml', exportFormat: 'svg', enabled: true },
  { id: 'pdf', label: '.PDF', description: 'Not enabled in this WASM build', mimeType: 'application/pdf', exportFormat: 'pdf', enabled: false },
  { id: 'png', label: '.PNG', description: 'Not enabled in this WASM build', mimeType: 'image/png', exportFormat: 'png', enabled: false },
  { id: 'echo', label: '.ECHO', description: 'Echo output', mimeType: 'text/plain', exportFormat: 'echo', enabled: true },
  { id: 'ast', label: '.AST', description: 'Abstract syntax tree', mimeType: 'text/plain', exportFormat: 'ast', enabled: true },
  { id: 'term', label: '.TERM', description: 'Term output', mimeType: 'text/plain', exportFormat: 'term', enabled: true },
  { id: 'nef3', label: '.NEF3', description: 'OpenCSG geometry', mimeType: 'application/octet-stream', exportFormat: 'nef3', enabled: true },
  { id: 'nefdbg', label: '.NEFDBG', description: 'OpenCSG debug geometry', mimeType: 'application/octet-stream', exportFormat: 'nefdbg', enabled: true },
  { id: 'param', label: '.PARAM', description: 'Customizer parameters', mimeType: 'application/json', exportFormat: 'param', enabled: true },
  { id: 'pov', label: '.POV', description: 'POV-Ray scene', mimeType: 'application/x-pov', exportFormat: 'pov', enabled: true },
] as const;

export type OpenScadExportFormat = (typeof OPENSCAD_EXPORT_FORMATS)[number]['id'];
export type EnabledOpenScadExportFormat = Extract<
  (typeof OPENSCAD_EXPORT_FORMATS)[number],
  { enabled: true }
>['id'];

export function isOpenScadExportFormat(value: string): value is EnabledOpenScadExportFormat {
  return OPENSCAD_EXPORT_FORMATS.some((format) => format.id === value && format.enabled);
}

export function getOpenScadExportFormat(value: string) {
  const format = OPENSCAD_EXPORT_FORMATS.find((item) => item.id === value);
  if (!format || !format.enabled) {
    throw new Error(`Unsupported OpenSCAD export format: ${value}`);
  }
  return format;
}
