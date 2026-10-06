import { jsonSchema, zodSchema } from 'ai';
import { z } from 'zod';
import {
  BREP_PROJECT_MAX_ABS_SCALAR,
  BREP_PROJECT_MAX_DESCRIPTION_CHARS,
  BREP_PROJECT_MAX_ID_CHARS,
  BREP_PROJECT_MAX_METADATA_PROPERTIES,
  BREP_PROJECT_MAX_NAME_CHARS,
  BREP_PROJECT_MAX_NODE_INPUTS,
  BREP_PROJECT_MAX_NODES,
  BREP_PROJECT_MAX_OBJECT_POINTS,
  BREP_PROJECT_MAX_PARAMETERS,
  BREP_PROJECT_MAX_PATTERN_COUNT,
  BREP_PROJECT_MAX_PROFILE_HOLES,
  BREP_PROJECT_MAX_PROFILE_POINTS,
  BREP_PROJECT_MAX_PROFILE_TOTAL_POINTS,
  BREP_PROJECT_SCHEMA_VERSION,
  type BrepProject,
} from './brepProject.ts';
import { normalizeBrepAiProjectCandidate } from './brepAiProject.ts';

const brepIdSchema = z
  .string()
  .min(1)
  .max(BREP_PROJECT_MAX_ID_CHARS)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

const brepScalarNumberSchema = z
  .number()
  .min(-BREP_PROJECT_MAX_ABS_SCALAR)
  .max(BREP_PROJECT_MAX_ABS_SCALAR);

const brepParameterReferenceSchema = z
  .object({ parameter: brepIdSchema })
  .strict();

const brepScalarSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    brepScalarNumberSchema,
    brepParameterReferenceSchema,
    z
      .object({
        op: z.enum(['add', 'sub', 'mul', 'div']),
        args: z.tuple([brepScalarSchema, brepScalarSchema]),
      })
      .strict(),
    z
      .object({
        op: z.literal('neg'),
        args: z.tuple([brepScalarSchema]),
      })
      .strict(),
  ]),
);

function brepVector3SchemaFor(scalarSchema: z.ZodTypeAny) {
  return z.tuple([scalarSchema, scalarSchema, scalarSchema]);
}

const brepVector3Schema = brepVector3SchemaFor(brepScalarSchema);

const brepPlacementSchema = z
  .object({
    origin: brepVector3Schema,
    xAxis: brepVector3Schema,
    yAxis: brepVector3Schema,
  })
  .strict();

const brepMetadataSchema = z
  .object({
    objectType: z.string().min(1).max(BREP_PROJECT_MAX_NAME_CHARS).optional(),
    classification: z
      .string()
      .min(1)
      .max(BREP_PROJECT_MAX_NAME_CHARS)
      .optional(),
    properties: z
      .record(
        brepIdSchema,
        z.string().min(1).max(BREP_PROJECT_MAX_DESCRIPTION_CHARS),
      )
      .refine(
        (value) =>
          Object.keys(value).length <= BREP_PROJECT_MAX_METADATA_PROPERTIES,
        `BRep metadata may contain at most ${BREP_PROJECT_MAX_METADATA_PROPERTIES} properties.`,
      )
      .optional(),
  })
  .strict();

const brepProjectObjectPointSchema = z
  .object({
    id: brepIdSchema,
    kind: z.enum(['connection', 'mounting', 'cable']),
    position: brepVector3Schema,
    direction: brepVector3Schema.optional(),
    label: z.string().min(1).max(BREP_PROJECT_MAX_NAME_CHARS).optional(),
  })
  .strict();

const brepProjectObjectSchema = z
  .object({
    footprintNodeId: brepIdSchema.optional(),
    clearanceEnvelopeNodeId: brepIdSchema.optional(),
    maintenanceEnvelopeNodeId: brepIdSchema.optional(),
    points: z
      .array(brepProjectObjectPointSchema)
      .max(BREP_PROJECT_MAX_OBJECT_POINTS)
      .optional(),
  })
  .strict();

const brepPublishedNumberParameterSchema = z
  .object({
    id: brepIdSchema,
    label: z.string().min(1).max(BREP_PROJECT_MAX_NAME_CHARS),
    type: z.literal('number'),
    unit: z.enum(['mm', 'deg', 'none']),
    default: brepScalarNumberSchema,
    min: brepScalarNumberSchema.optional(),
    max: brepScalarNumberSchema.optional(),
    step: brepScalarNumberSchema.optional(),
    description: z
      .string()
      .min(1)
      .max(BREP_PROJECT_MAX_DESCRIPTION_CHARS)
      .optional(),
  })
  .strict();

const brepEdgeSelectorSchema = z
  .object({
    kind: z.literal('parallelToAxis'),
    axis: z.enum(['x', 'y', 'z']),
  })
  .strict();

const brepBoxNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('box'),
    width: brepScalarSchema,
    depth: brepScalarSchema,
    height: brepScalarSchema,
  })
  .strict();

const brepCylinderNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('cylinder'),
    radius: brepScalarSchema,
    height: brepScalarSchema,
  })
  .strict();

function createBrepProfileLoopSchema(scalarSchema: z.ZodTypeAny) {
  const pointSchema = z.object({ u: scalarSchema, v: scalarSchema }).strict();
  return z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('rectangle'),
        width: scalarSchema,
        height: scalarSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal('circle'),
        radius: scalarSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal('closedPolyline'),
        points: z
          .array(pointSchema)
          .min(3)
          .max(BREP_PROJECT_MAX_PROFILE_POINTS),
      })
      .strict(),
  ]);
}

function createBrepExtrudeProfileSchema(scalarSchema: z.ZodTypeAny) {
  const pointSchema = z.object({ u: scalarSchema, v: scalarSchema }).strict();
  const loopSchema = createBrepProfileLoopSchema(scalarSchema);
  const holeSchema = z
    .object({
      loop: loopSchema,
      offsetU: scalarSchema,
      offsetV: scalarSchema,
    })
    .strict();
  const holesSchema = z
    .array(holeSchema)
    .max(BREP_PROJECT_MAX_PROFILE_HOLES)
    .optional();

  return z
    .discriminatedUnion('type', [
      z
        .object({
          type: z.literal('rectangle'),
          width: scalarSchema,
          height: scalarSchema,
          holes: holesSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('circle'),
          radius: scalarSchema,
          holes: holesSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('closedPolyline'),
          points: z
            .array(pointSchema)
            .min(3)
            .max(BREP_PROJECT_MAX_PROFILE_POINTS),
          holes: holesSchema,
        })
        .strict(),
    ])
    .superRefine((profile, context) => {
      const outerPoints =
        profile.type === 'closedPolyline' ? profile.points.length : 0;
      const holePoints = (profile.holes ?? []).reduce(
        (sum, hole) =>
          sum +
          (hole.loop.type === 'closedPolyline' ? hole.loop.points.length : 0),
        0,
      );
      if (outerPoints + holePoints > BREP_PROJECT_MAX_PROFILE_TOTAL_POINTS) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['holes'],
          message: `BRep extrusion profile may contain at most ${BREP_PROJECT_MAX_PROFILE_TOTAL_POINTS} explicit closedPolyline points across outer and holes.`,
        });
      }
    });
}

const brepExtrudeProfileSchema =
  createBrepExtrudeProfileSchema(brepScalarSchema);
const brepRevolveProfileSchema = createBrepProfileLoopSchema(brepScalarSchema);

const brepExtrudeNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('extrude'),
    profile: brepExtrudeProfileSchema,
    axis: z.enum(['x', 'y', 'z']),
    depth: brepScalarSchema,
  })
  .strict();

const brepRevolveNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('revolve'),
    profile: brepRevolveProfileSchema,
    axis: z.enum(['x', 'y', 'z']),
  })
  .strict();

const brepSweepNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('sweep'),
    profile: z
      .object({
        type: z.literal('circle'),
        radius: brepScalarSchema,
      })
      .strict(),
    path: z
      .object({
        type: z.literal('planarElbow90'),
        planeNormalAxis: z.enum(['x', 'y', 'z']),
        firstLegLength: brepScalarSchema,
        secondLegLength: brepScalarSchema,
        bendRadius: brepScalarSchema,
      })
      .strict(),
  })
  .strict();

const brepTransformNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('transform'),
    input: brepIdSchema,
    translate: brepVector3Schema.optional(),
    rotateDeg: brepVector3Schema.optional(),
  })
  .strict();

const brepMirrorNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('mirror'),
    input: brepIdSchema,
    normalAxis: z.enum(['x', 'y', 'z']),
    offset: brepScalarSchema,
  })
  .strict();

const brepLinearPatternNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('linearPattern'),
    input: brepIdSchema,
    axis: z.enum(['x', 'y', 'z']),
    count: z.number().int().min(2).max(BREP_PROJECT_MAX_PATTERN_COUNT),
    spacing: brepScalarSchema,
  })
  .strict();

const brepRectangularPatternNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('rectangularPattern'),
    input: brepIdSchema,
    axisA: z.enum(['x', 'y', 'z']),
    axisB: z.enum(['x', 'y', 'z']),
    countA: z.number().int().min(2).max(BREP_PROJECT_MAX_PATTERN_COUNT),
    countB: z.number().int().min(2).max(BREP_PROJECT_MAX_PATTERN_COUNT),
    spacingA: brepScalarSchema,
    spacingB: brepScalarSchema,
  })
  .strict();

const brepCircularPatternNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('circularPattern'),
    input: brepIdSchema,
    axis: z.enum(['x', 'y', 'z']),
    center: brepVector3Schema,
    count: z.number().int().min(2).max(BREP_PROJECT_MAX_PATTERN_COUNT),
    angleStepDeg: brepScalarSchema,
  })
  .strict();

const brepSubtractNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('subtract'),
    base: brepIdSchema,
    tools: z.array(brepIdSchema).min(1).max(BREP_PROJECT_MAX_NODE_INPUTS),
  })
  .strict();

const brepUnionNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('union'),
    inputs: z.array(brepIdSchema).min(2).max(BREP_PROJECT_MAX_NODE_INPUTS),
  })
  .strict();

const brepIntersectNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('intersect'),
    inputs: z.array(brepIdSchema).min(2).max(BREP_PROJECT_MAX_NODE_INPUTS),
  })
  .strict();

const brepFilletNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('fillet'),
    input: brepIdSchema,
    radius: brepScalarSchema,
    selector: brepEdgeSelectorSchema,
  })
  .strict();

const brepSelectNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('select'),
    selector: z.object({ parameter: brepIdSchema }).strict(),
    off: brepIdSchema,
    on: brepIdSchema,
  })
  .strict();

const brepNodeSchema = z.discriminatedUnion('type', [
  brepBoxNodeSchema,
  brepCylinderNodeSchema,
  brepExtrudeNodeSchema,
  brepRevolveNodeSchema,
  brepSweepNodeSchema,
  brepTransformNodeSchema,
  brepMirrorNodeSchema,
  brepLinearPatternNodeSchema,
  brepRectangularPatternNodeSchema,
  brepCircularPatternNodeSchema,
  brepSubtractNodeSchema,
  brepUnionNodeSchema,
  brepIntersectNodeSchema,
  brepFilletNodeSchema,
  brepSelectNodeSchema,
]);

export const brepAiProjectSchema = z
  .object({
    schemaVersion: z.literal(BREP_PROJECT_SCHEMA_VERSION),
    id: brepIdSchema,
    name: z.string().min(1).max(BREP_PROJECT_MAX_NAME_CHARS),
    units: z.literal('mm'),
    placement: brepPlacementSchema,
    metadata: brepMetadataSchema.optional(),
    projectObject: brepProjectObjectSchema.optional(),
    parameters: z
      .array(brepPublishedNumberParameterSchema)
      .max(BREP_PROJECT_MAX_PARAMETERS),
    nodes: z.array(brepNodeSchema).min(1).max(BREP_PROJECT_MAX_NODES),
    resultNodeId: brepIdSchema,
  })
  .strict()
  .superRefine((project, context) => {
    try {
      normalizeBrepAiProjectCandidate(project);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          error instanceof Error
            ? error.message
            : 'Invalid canonical BRep project snapshot.',
      });
    }
  });

export const brepAiBuildInputSchema = z
  .object({
    title: z.string().min(1).max(BREP_PROJECT_MAX_NAME_CHARS),
    version: z.string().min(1).max(32).default('v1'),
    project: brepAiProjectSchema,
  })
  .strict();

export type BrepAiBuildInput = Omit<
  z.infer<typeof brepAiBuildInputSchema>,
  'project'
> & { project: BrepProject };

export const BREP_AI_PROVIDER_EXPRESSION_MAX_DEPTH = 2;

function createBrepProviderScalarSchema(depth: number): z.ZodTypeAny {
  const leafSchema = z.union([
    brepScalarNumberSchema,
    brepParameterReferenceSchema,
  ]);
  if (depth <= 0) return leafSchema;

  const childSchema = createBrepProviderScalarSchema(depth - 1);
  const expressionSchema = z
    .object({
      op: z.enum(['add', 'sub', 'mul', 'div', 'neg']),
      args: z.array(childSchema).min(1).max(2),
    })
    .strict()
    .superRefine((expression, context) => {
      const expectedArgs = expression.op === 'neg' ? 1 : 2;
      if (expression.args.length !== expectedArgs) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['args'],
          message: `${expression.op} requires exactly ${expectedArgs} scalar argument${expectedArgs === 1 ? '' : 's'}.`,
        });
      }
    });

  return z.union([
    brepScalarNumberSchema,
    brepParameterReferenceSchema,
    expressionSchema,
  ]);
}

const brepProviderScalarSchema = createBrepProviderScalarSchema(
  BREP_AI_PROVIDER_EXPRESSION_MAX_DEPTH,
);
const brepProviderVector3Schema = brepVector3SchemaFor(
  brepProviderScalarSchema,
);
const brepProviderPlacementSchema = z
  .object({
    origin: brepProviderVector3Schema,
    xAxis: brepProviderVector3Schema,
    yAxis: brepProviderVector3Schema,
  })
  .strict();
const brepProviderProjectObjectPointSchema = z
  .object({
    id: brepIdSchema,
    kind: z.enum(['connection', 'mounting', 'cable']),
    position: brepProviderVector3Schema,
    direction: brepProviderVector3Schema.optional(),
    label: z.string().min(1).max(BREP_PROJECT_MAX_NAME_CHARS).optional(),
  })
  .strict();
const brepProviderProjectObjectSchema = z
  .object({
    footprintNodeId: brepIdSchema.optional(),
    clearanceEnvelopeNodeId: brepIdSchema.optional(),
    maintenanceEnvelopeNodeId: brepIdSchema.optional(),
    points: z
      .array(brepProviderProjectObjectPointSchema)
      .max(BREP_PROJECT_MAX_OBJECT_POINTS)
      .optional(),
  })
  .strict();
const brepProviderBoxNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('box'),
    width: brepProviderScalarSchema,
    depth: brepProviderScalarSchema,
    height: brepProviderScalarSchema,
  })
  .strict();
const brepProviderCylinderNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('cylinder'),
    radius: brepProviderScalarSchema,
    height: brepProviderScalarSchema,
  })
  .strict();
const brepProviderExtrudeProfileSchema = createBrepExtrudeProfileSchema(
  brepProviderScalarSchema,
);
const brepProviderRevolveProfileSchema = createBrepProfileLoopSchema(
  brepProviderScalarSchema,
);
const brepProviderExtrudeNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('extrude'),
    profile: brepProviderExtrudeProfileSchema,
    axis: z.enum(['x', 'y', 'z']),
    depth: brepProviderScalarSchema,
  })
  .strict();
const brepProviderRevolveNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('revolve'),
    profile: brepProviderRevolveProfileSchema,
    axis: z.enum(['x', 'y', 'z']),
  })
  .strict();
const brepProviderSweepNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('sweep'),
    profile: z
      .object({
        type: z.literal('circle'),
        radius: brepProviderScalarSchema,
      })
      .strict(),
    path: z
      .object({
        type: z.literal('planarElbow90'),
        planeNormalAxis: z.enum(['x', 'y', 'z']),
        firstLegLength: brepProviderScalarSchema,
        secondLegLength: brepProviderScalarSchema,
        bendRadius: brepProviderScalarSchema,
      })
      .strict(),
  })
  .strict();
const brepProviderTransformNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('transform'),
    input: brepIdSchema,
    translate: brepProviderVector3Schema.optional(),
    rotateDeg: brepProviderVector3Schema.optional(),
  })
  .strict();
const brepProviderMirrorNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('mirror'),
    input: brepIdSchema,
    normalAxis: z.enum(['x', 'y', 'z']),
    offset: brepProviderScalarSchema,
  })
  .strict();
const brepProviderLinearPatternNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('linearPattern'),
    input: brepIdSchema,
    axis: z.enum(['x', 'y', 'z']),
    count: z.number().int().min(2).max(BREP_PROJECT_MAX_PATTERN_COUNT),
    spacing: brepProviderScalarSchema,
  })
  .strict();
const brepProviderRectangularPatternNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('rectangularPattern'),
    input: brepIdSchema,
    axisA: z.enum(['x', 'y', 'z']),
    axisB: z.enum(['x', 'y', 'z']),
    countA: z.number().int().min(2).max(BREP_PROJECT_MAX_PATTERN_COUNT),
    countB: z.number().int().min(2).max(BREP_PROJECT_MAX_PATTERN_COUNT),
    spacingA: brepProviderScalarSchema,
    spacingB: brepProviderScalarSchema,
  })
  .strict();
const brepProviderCircularPatternNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('circularPattern'),
    input: brepIdSchema,
    axis: z.enum(['x', 'y', 'z']),
    center: brepProviderVector3Schema,
    count: z.number().int().min(2).max(BREP_PROJECT_MAX_PATTERN_COUNT),
    angleStepDeg: brepProviderScalarSchema,
  })
  .strict();
const brepProviderFilletNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('fillet'),
    input: brepIdSchema,
    radius: brepProviderScalarSchema,
    selector: brepEdgeSelectorSchema,
  })
  .strict();
const brepProviderSelectNodeSchema = z
  .object({
    id: brepIdSchema,
    type: z.literal('select'),
    selector: z.object({ parameter: brepIdSchema }).strict(),
    off: brepIdSchema,
    on: brepIdSchema,
  })
  .strict();
const brepProviderNodeSchema = z.discriminatedUnion('type', [
  brepProviderBoxNodeSchema,
  brepProviderCylinderNodeSchema,
  brepProviderExtrudeNodeSchema,
  brepProviderRevolveNodeSchema,
  brepProviderSweepNodeSchema,
  brepProviderTransformNodeSchema,
  brepProviderMirrorNodeSchema,
  brepProviderLinearPatternNodeSchema,
  brepProviderRectangularPatternNodeSchema,
  brepProviderCircularPatternNodeSchema,
  brepSubtractNodeSchema,
  brepUnionNodeSchema,
  brepIntersectNodeSchema,
  brepProviderFilletNodeSchema,
  brepProviderSelectNodeSchema,
]);
const brepAiProviderProjectSchema = z
  .object({
    schemaVersion: z.literal(BREP_PROJECT_SCHEMA_VERSION),
    id: brepIdSchema,
    name: z.string().min(1).max(BREP_PROJECT_MAX_NAME_CHARS),
    units: z.literal('mm'),
    placement: brepProviderPlacementSchema,
    metadata: brepMetadataSchema.optional(),
    projectObject: brepProviderProjectObjectSchema.optional(),
    parameters: z
      .array(brepPublishedNumberParameterSchema)
      .max(BREP_PROJECT_MAX_PARAMETERS),
    nodes: z.array(brepProviderNodeSchema).min(1).max(BREP_PROJECT_MAX_NODES),
    resultNodeId: brepIdSchema,
  })
  .strict();
export const brepAiProviderBuildInputZodSchema = z
  .object({
    title: z.string().min(1).max(BREP_PROJECT_MAX_NAME_CHARS),
    version: z.string().min(1).max(32).default('v1'),
    project: brepAiProviderProjectSchema,
  })
  .strict();
const brepAiProviderJsonSchema = zodSchema(brepAiProviderBuildInputZodSchema);

export const brepAiBuildProviderInputSchema = jsonSchema<BrepAiBuildInput>(
  () => brepAiProviderJsonSchema.jsonSchema,
  {
    validate: async (value) => {
      const result = await brepAiBuildInputSchema.safeParseAsync(value);
      return result.success
        ? { success: true, value: result.data as BrepAiBuildInput }
        : { success: false, error: result.error };
    },
  },
);

export const brepAiBuildOutputSchema = z
  .object({
    status: z.literal('success'),
    message: z.string().min(1),
  })
  .strict();

export type BrepAiBuildOutput = z.infer<typeof brepAiBuildOutputSchema>;
