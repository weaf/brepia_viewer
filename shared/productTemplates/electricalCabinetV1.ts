import source from './electricalCabinetV1.json';

export const electricalCabinetV1 = {
  id: 'builtin:electrical-cabinet',
  version: 1,
  name: 'Electrical Cabinet',
  category: 'Electrical',
  description:
    'Parametric wall-mounted electrical control cabinet with hinged door, mounting plate, DIN rails, ventilation and cable entry.',
  supportedUse:
    'Use for configurable wall-mounted electrical enclosures with a hinged front door and internal mounting hardware.',
  source: {
    kind: 'brep',
    source,
  },
  presentation: {
    parameterOrder: [
      'W',
      'H',
      'D',
      'sheet_t',
      'doorOpenAngleDeg',
      'door_clear',
      'plate_margin',
      'rail_inset',
      'rail_spacing',
      'vent_pitch',
    ],
    parameters: {
      W: { label: 'Width', visibility: 'visible', tier: 'basic' },
      H: { label: 'Height', visibility: 'visible', tier: 'basic' },
      D: { label: 'Depth', visibility: 'visible', tier: 'basic' },
      sheet_t: {
        label: 'Sheet thickness',
        visibility: 'visible',
        tier: 'basic',
      },
      doorOpenAngleDeg: {
        label: 'Door opening angle',
        description: '0° is closed; positive values open the door outward.',
        unitLabel: '°',
        visibility: 'visible',
        tier: 'basic',
      },
      door_clear: { visibility: 'hidden', tier: 'advanced' },
      plate_margin: { visibility: 'hidden', tier: 'advanced' },
      rail_inset: { visibility: 'hidden', tier: 'advanced' },
      rail_spacing: { visibility: 'hidden', tier: 'advanced' },
      vent_pitch: { visibility: 'hidden', tier: 'advanced' },
    },
    preview: {
      kind: 'bundled',
      assetId: 'templates/electrical-cabinet-v1.png',
    },
    groups: [
      {
        id: 'dimensions',
        label: 'Dimensions',
        parameterIds: ['W', 'H', 'D', 'sheet_t'],
      },
      {
        id: 'door',
        label: 'Door',
        parameterIds: ['doorOpenAngleDeg'],
      },
    ],
  },
} as const;
