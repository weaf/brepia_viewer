import type { BrepProject, BrepScalar } from '../brepProject.ts';

type Variant = 'single' | 'deep' | 'double' | 'triple';

const ref = (parameter: string): BrepScalar => ({ parameter });
const add = (...args: BrepScalar[]): BrepScalar => ({
  op: 'add',
  args: [args[0]!, args[1]!],
});
const sub = (...args: BrepScalar[]): BrepScalar => ({
  op: 'sub',
  args: [args[0]!, args[1]!],
});
const mul = (...args: BrepScalar[]): BrepScalar => ({
  op: 'mul',
  args: [args[0]!, args[1]!],
});
const div = (...args: BrepScalar[]): BrepScalar => ({
  op: 'div',
  args: [args[0]!, args[1]!],
});

function sourceFor(variant: Variant): BrepProject {
  const channelCount = variant === 'double' ? 2 : variant === 'triple' ? 3 : 1;
  const defaults =
    variant === 'deep'
      ? { L: 2250, W: 480, H: 500 }
      : variant === 'double'
        ? { L: 2250, W: 650, H: 300 }
        : variant === 'triple'
          ? { L: 2400, W: 720, H: 300 }
          : { L: 2250, W: 350, H: 300 };
  const innerW = sub(ref('W'), mul(2, ref('wall_t')));
  const innerH = sub(ref('H'), ref('wall_t'));
  const startWallCutX = add(mul(ref('L'), -0.5), mul(ref('wall_t'), 0.5));
  const endWallCutX = sub(mul(ref('L'), 0.5), mul(ref('wall_t'), 0.5));
  const dividerLength = sub(
    ref('L'),
    mul(ref('wall_t'), add(ref('startWallEnabled'), ref('endWallEnabled'))),
  );
  const dividerX = mul(
    ref('wall_t'),
    mul(sub(ref('startWallEnabled'), ref('endWallEnabled')), 0.5),
  );
  const nodes: BrepProject['nodes'] = [
    {
      id: 'outer',
      type: 'box',
      width: ref('L'),
      depth: ref('W'),
      height: ref('H'),
    },
    {
      id: 'cavity',
      type: 'transform',
      input: 'cavity_box',
      translate: [0, 0, mul(ref('wall_t'), 0.5)],
    },
    {
      id: 'cavity_box',
      type: 'box',
      width: sub(ref('L'), mul(2, ref('wall_t'))),
      depth: innerW,
      height: innerH,
    },
    { id: 'body', type: 'subtract', base: 'outer', tools: ['cavity'] },
    {
      id: 'start_wall_cut_box',
      type: 'box',
      width: mul(ref('wall_t'), 2),
      depth: innerW,
      height: innerH,
    },
    {
      id: 'start_wall_cut',
      type: 'transform',
      input: 'start_wall_cut_box',
      translate: [startWallCutX, 0, mul(ref('wall_t'), 0.5)],
    },
    {
      id: 'body_start_wall_removed',
      type: 'subtract',
      base: 'body',
      tools: ['start_wall_cut'],
    },
    {
      id: 'body_start_wall_selected',
      type: 'select',
      selector: { parameter: 'startWallEnabled' },
      off: 'body_start_wall_removed',
      on: 'body',
    },
    {
      id: 'end_wall_cut_box',
      type: 'box',
      width: mul(ref('wall_t'), 2),
      depth: innerW,
      height: innerH,
    },
    {
      id: 'end_wall_cut',
      type: 'transform',
      input: 'end_wall_cut_box',
      translate: [endWallCutX, 0, mul(ref('wall_t'), 0.5)],
    },
    {
      id: 'body_end_wall_removed',
      type: 'subtract',
      base: 'body_start_wall_selected',
      tools: ['end_wall_cut'],
    },
    {
      id: 'body_end_walls_selected',
      type: 'select',
      selector: { parameter: 'endWallEnabled' },
      off: 'body_end_wall_removed',
      on: 'body_start_wall_selected',
    },
  ];

  const dividerIds: string[] = [];
  for (let index = 1; index < channelCount; index += 1) {
    const id = `divider_${index}`;
    dividerIds.push(id);
    nodes.push({
      id,
      type: 'box',
      width: dividerLength,
      depth: ref('wall_t'),
      height: sub(ref('H'), ref('wall_t')),
    });
    nodes.push({
      id: `${id}_pos`,
      type: 'transform',
      input: id,
      translate: [
        dividerX,
        sub(mul(ref('W'), sub(div(index, channelCount), 0.5)), 0),
        mul(ref('wall_t'), 0.5),
      ],
    });
  }
  const bodyWithDividers = dividerIds.length
    ? 'body_with_dividers'
    : 'body_end_walls_selected';
  if (dividerIds.length) {
    nodes.push({
      id: bodyWithDividers,
      type: 'union',
      inputs: [
        'body_end_walls_selected',
        ...dividerIds.map((id) => `${id}_pos`),
      ],
    });
  }

  const segmentWidth = div(sub(ref('L'), 10), 3);
  const hingeY = sub(mul(innerW, -0.5), 1);
  const lidIds: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const lid = `lid_${index + 1}`;
    const lidBox = `${lid}_box`;
    const pivotIn = `${lid}_pivot_in`;
    const pivotRot = `${lid}_pivot_rot`;
    const lidPos = `${lid}_pos`;
    const x =
      index === 0
        ? sub(mul(ref('L'), -0.5), sub(0, add(div(sub(ref('L'), 10), 6), 5)))
        : index === 1
          ? 0
          : add(mul(ref('L'), 0.5), sub(0, add(div(sub(ref('L'), 10), 6), 5)));
    nodes.push(
      {
        id: lidBox,
        type: 'box',
        width: segmentWidth,
        depth: add(innerW, 4),
        height: 8,
      },
      {
        id: pivotIn,
        type: 'transform',
        input: lidBox,
        translate: [x, sub(mul(innerW, 0.5), 0), 0],
      },
      {
        id: pivotRot,
        type: 'transform',
        input: pivotIn,
        rotateDeg: [ref('lidOpenAngleDeg'), 0, 0],
        translate: [0, 0, 0],
      },
      {
        id: lidPos,
        type: 'transform',
        input: pivotRot,
        translate: [0, hingeY, sub(mul(ref('H'), 0.5), 5)],
      },
    );
    lidIds.push(lidPos);
  }
  nodes.push(
    {
      id: 'hinge_box',
      type: 'box',
      width: sub(ref('L'), 10),
      depth: 12,
      height: 12,
    },
    {
      id: 'hinge_in',
      type: 'transform',
      input: 'hinge_box',
      translate: [0, sub(mul(innerW, 0.5), 0), 0],
    },
    {
      id: 'hinge_rot',
      type: 'transform',
      input: 'hinge_in',
      rotateDeg: [ref('lidOpenAngleDeg'), 0, 0],
      translate: [0, 0, 0],
    },
    {
      id: 'hinge_pos',
      type: 'transform',
      input: 'hinge_rot',
      translate: [0, hingeY, sub(mul(ref('H'), 0.5), 5)],
    },
    {
      id: 'lid_assembly',
      type: 'union',
      inputs: [...lidIds, 'hinge_pos'],
    },
    {
      id: 'trough_with_lid',
      type: 'union',
      inputs: [bodyWithDividers, 'lid_assembly'],
    },
    {
      id: 'product',
      type: 'select',
      selector: { parameter: 'lidEnabled' },
      off: bodyWithDividers,
      on: 'trough_with_lid',
    },
  );

  return {
    schemaVersion: 1,
    id: `lidded-cable-trough-${variant}`,
    name: `Lidded Cable Trough ${variant}`,
    units: 'mm',
    placement: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
    metadata: {
      objectType: 'cable-trough',
      classification: 'infrastructure-cable-management',
      properties: { channelCount: String(channelCount), lidSegments: '3' },
    },
    parameters: [
      {
        id: 'L',
        label: 'Overall length',
        type: 'number',
        unit: 'mm',
        default: defaults.L,
        min: 1200,
        max: 6000,
        step: 50,
      },
      {
        id: 'W',
        label: 'Overall width',
        type: 'number',
        unit: 'mm',
        default: defaults.W,
        min: 250,
        max: 1200,
        step: 10,
      },
      {
        id: 'H',
        label: 'Overall depth',
        type: 'number',
        unit: 'mm',
        default: defaults.H,
        min: 200,
        max: 900,
        step: 10,
      },
      {
        id: 'wall_t',
        label: 'Wall thickness',
        type: 'number',
        unit: 'mm',
        default: 12,
        min: 6,
        max: 40,
        step: 1,
      },
      {
        id: 'startWallEnabled',
        label: 'Start wall enabled',
        type: 'number',
        unit: 'none',
        default: 1,
        min: 0,
        max: 1,
        step: 1,
      },
      {
        id: 'endWallEnabled',
        label: 'End wall enabled',
        type: 'number',
        unit: 'none',
        default: 1,
        min: 0,
        max: 1,
        step: 1,
      },
      {
        id: 'lidEnabled',
        label: 'Lid enabled',
        type: 'number',
        unit: 'none',
        default: 1,
        min: 0,
        max: 1,
        step: 1,
      },
      {
        id: 'lidOpenAngleDeg',
        label: 'Lid opening angle',
        type: 'number',
        unit: 'deg',
        default: 0,
        min: 0,
        max: 90,
        step: 5,
      },
    ],
    nodes,
    resultNodeId: 'product',
  };
}

function template(
  variant: Variant,
  id: string,
  name: string,
  description: string,
) {
  const source = sourceFor(variant);
  return {
    id,
    version: 1,
    name,
    category: 'Infrastructure',
    description,
    supportedUse:
      'Use for solid-sided infrastructure cable troughs with a recessed segmented inspection lid.',
    source: { kind: 'brep' as const, source },
    presentation: {
      parameterOrder: [
        'L',
        'W',
        'H',
        'wall_t',
        'startWallEnabled',
        'endWallEnabled',
        'lidEnabled',
        'lidOpenAngleDeg',
      ],
      parameters: {
        L: {
          label: 'Length',
          visibility: 'visible' as const,
          tier: 'basic' as const,
        },
        W: {
          label: 'Width',
          visibility: 'visible' as const,
          tier: 'basic' as const,
        },
        H: {
          label: 'Depth',
          visibility: 'visible' as const,
          tier: 'basic' as const,
        },
        wall_t: {
          label: 'Wall thickness',
          visibility: 'visible' as const,
          tier: 'advanced' as const,
        },
        startWallEnabled: {
          label: 'Start wall',
          description:
            'Controls the short wall at the negative-X/start end. 0 removes it; 1 includes it.',
          visibility: 'visible' as const,
          tier: 'basic' as const,
        },
        endWallEnabled: {
          label: 'End wall',
          description:
            'Controls the short wall at the positive-X/end end. 0 removes it; 1 includes it.',
          visibility: 'visible' as const,
          tier: 'basic' as const,
        },
        lidEnabled: {
          label: 'Lid enabled',
          description:
            '0 removes the lid from authoritative geometry; 1 includes it.',
          visibility: 'visible' as const,
          tier: 'basic' as const,
        },
        lidOpenAngleDeg: {
          label: 'Lid opening angle',
          description:
            '0° is recessed closed; positive values open the lid for inspection.',
          unitLabel: '°',
          visibility: 'visible' as const,
          tier: 'basic' as const,
        },
      },
      preview: {
        kind: 'bundled' as const,
        assetId: 'templates/lidded-cable-trough-v1.svg',
      },
      groups: [
        {
          id: 'dimensions',
          label: 'Dimensions',
          parameterIds: ['L', 'W', 'H', 'wall_t'],
        },
        {
          id: 'end-walls',
          label: 'End walls',
          parameterIds: ['startWallEnabled', 'endWallEnabled'],
        },
        {
          id: 'lid',
          label: 'Lid inspection',
          parameterIds: ['lidEnabled', 'lidOpenAngleDeg'],
        },
      ],
    },
  } as const;
}

export const liddedCableTroughV1 = template(
  'single',
  'builtin:cable-trough-lidded',
  'Lidded Cable Trough',
  'Solid-sided single-channel cable trough with a recessed three-segment inspection lid.',
);
export const liddedCableTroughDeepV1 = template(
  'deep',
  'builtin:cable-trough-lidded-deep',
  'Deep Lidded Cable Trough',
  'Deep single-channel infrastructure cable trough with a recessed three-segment inspection lid.',
);
export const doubleLiddedCableTroughV1 = template(
  'double',
  'builtin:cable-trough-double-lidded',
  'Double Lidded Cable Trough',
  'Two-channel cable trough with one full-height divider and a shared recessed inspection lid.',
);
export const tripleLiddedCableTroughV1 = template(
  'triple',
  'builtin:cable-trough-triple-lidded',
  'Triple Lidded Cable Trough',
  'Three-channel cable trough with two full-height dividers and a shared recessed inspection lid.',
);
