import source from './cableTrayV1.json';

export const cableTrayV1 = {
  id: 'builtin:cable-tray',
  version: 1,
  name: 'Cable Tray',
  category: 'Electrical',
  description:
    'Straight perforated cable tray with parametric length, width, side height and material thickness.',
  supportedUse:
    'Use for straight fabricated cable-management tray runs with fixed repeated bottom perforations.',
  source: {
    kind: 'brep',
    source,
  },
  presentation: {
    parameterOrder: ['L', 'W', 'H', 'sheet_t'],
    parameters: {
      L: { label: 'Length', visibility: 'visible', tier: 'basic' },
      W: { label: 'Width', visibility: 'visible', tier: 'basic' },
      H: { label: 'Side height', visibility: 'visible', tier: 'basic' },
      sheet_t: {
        label: 'Material thickness',
        visibility: 'visible',
        tier: 'basic',
      },
    },
    preview: {
      kind: 'bundled',
      assetId: 'templates/cable-tray-v1.png',
    },
    groups: [
      {
        id: 'dimensions',
        label: 'Dimensions',
        parameterIds: ['L', 'W', 'H', 'sheet_t'],
      },
    ],
  },
} as const;
