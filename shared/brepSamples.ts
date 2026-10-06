import { BREP_PROJECT_SCHEMA_VERSION, type BrepProject } from './brepProject';

/** Representative reusable project object for the Phase 1 vertical slice. */
export const phaseOneCabinetProject: BrepProject = {
  schemaVersion: BREP_PROJECT_SCHEMA_VERSION,
  id: 'phaseOneCabinet',
  name: 'Phase 1 equipment cabinet',
  units: 'mm',
  placement: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
  metadata: { objectType: 'cabinet', classification: 'railway-equipment' },
  parameters: [
    {
      id: 'width',
      label: 'Width',
      type: 'number',
      unit: 'mm',
      default: 1200,
      min: 600,
      max: 2400,
      step: 50,
    },
    {
      id: 'height',
      label: 'Height',
      type: 'number',
      unit: 'mm',
      default: 1800,
      min: 800,
      max: 3000,
      step: 50,
    },
  ],
  nodes: [
    {
      id: 'cabinetBody',
      type: 'box',
      width: { parameter: 'width' },
      depth: 600,
      height: { parameter: 'height' },
    },
    { id: 'cableHole', type: 'cylinder', radius: 40, height: 620 },
    {
      id: 'positionedHole',
      type: 'transform',
      input: 'cableHole',
      translate: [600, 300, -10],
    },
    {
      id: 'cabinetWithCableHole',
      type: 'subtract',
      base: 'cabinetBody',
      tools: ['positionedHole'],
    },
  ],
  resultNodeId: 'cabinetWithCableHole',
};
