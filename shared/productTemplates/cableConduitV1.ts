import source from './cableConduitV1.json';

export const cableConduitV1 = {
  id: 'builtin:cable-conduit',
  version: 1,
  name: 'Cable Conduit',
  category: 'Electrical',
  description:
    'Hollow 90 degree cable conduit with two straight legs, configurable outside diameter, wall thickness and bend radius.',
  supportedUse:
    'Use for one planar 90 degree hollow conduit run with one straight leg before and after the bend.',
  source: {
    kind: 'brep',
    source,
  },
  presentation: {
    parameterOrder: ['OD', 'wall_t', 'firstLeg', 'secondLeg', 'bendRadius'],
    parameters: {
      OD: { label: 'Outer diameter', visibility: 'visible', tier: 'basic' },
      wall_t: {
        label: 'Wall thickness',
        visibility: 'visible',
        tier: 'basic',
      },
      firstLeg: {
        label: 'First leg',
        visibility: 'visible',
        tier: 'basic',
      },
      secondLeg: {
        label: 'Second leg',
        visibility: 'visible',
        tier: 'basic',
      },
      bendRadius: {
        label: 'Bend radius',
        visibility: 'visible',
        tier: 'basic',
      },
    },
    preview: {
      kind: 'bundled',
      assetId: 'templates/cable-conduit-v1.png',
    },
    groups: [
      {
        id: 'section',
        label: 'Section',
        parameterIds: ['OD', 'wall_t'],
      },
      {
        id: 'route',
        label: 'Route',
        parameterIds: ['firstLeg', 'secondLeg', 'bendRadius'],
      },
    ],
  },
} as const;
