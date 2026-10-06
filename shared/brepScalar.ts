import type {
  BrepNode,
  BrepParameterUnit,
  BrepProfileLoop,
  BrepProject,
  BrepScalar,
  BrepScalarExpression,
  BrepVector3,
} from './brepProject.ts';

export const BREP_SCALAR_MAX_ABS_VALUE = 1_000_000_000;
export const BREP_SCALAR_EXPRESSION_MAX_DEPTH = 12;
export const BREP_SCALAR_EXPRESSION_MAX_NODES = 64;

export type BrepScalarValidationErrorCode =
  'invalid_scalar' | 'invalid_parameter' | 'invalid_reference';

export class BrepScalarValidationError extends Error {
  constructor(
    public readonly code: BrepScalarValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BrepScalarValidationError';
  }
}

export class BrepScalarEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrepScalarEvaluationError';
  }
}

type ScalarNormalizationOptions = {
  field: string;
  parameterIds: ReadonlySet<string>;
  parameterUnits: ReadonlyMap<string, BrepParameterUnit>;
  allowedUnits: readonly BrepParameterUnit[];
  normalizeNumber: (value: unknown, field: string) => number;
  normalizeParameterId: (value: unknown, kind: string) => string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isBrepParameterReference(
  value: BrepScalar,
): value is Exclude<BrepScalar, number | BrepScalarExpression> {
  return typeof value !== 'number' && 'parameter' in value;
}

export function isBrepScalarExpression(
  value: BrepScalar,
): value is BrepScalarExpression {
  return typeof value !== 'number' && 'op' in value;
}

function scalarPossibleUnits(
  value: BrepScalar,
  parameterUnits: ReadonlyMap<string, BrepParameterUnit>,
): Set<BrepParameterUnit> {
  if (typeof value === 'number') {
    return new Set<BrepParameterUnit>(['mm', 'deg', 'none']);
  }
  if (isBrepParameterReference(value)) {
    const unit = parameterUnits.get(value.parameter);
    return unit ? new Set([unit]) : new Set();
  }

  const leftUnits = scalarPossibleUnits(value.args[0], parameterUnits);
  if (value.op === 'neg') return leftUnits;
  const rightUnits = scalarPossibleUnits(value.args[1], parameterUnits);
  const result = new Set<BrepParameterUnit>();

  for (const left of leftUnits) {
    for (const right of rightUnits) {
      if (value.op === 'add' || value.op === 'sub') {
        if (left === right) result.add(left);
        continue;
      }
      if (value.op === 'mul') {
        if (left === 'none') result.add(right);
        else if (right === 'none') result.add(left);
        continue;
      }
      if (right === 'none') result.add(left);
      else if (left === right) result.add('none');
    }
  }
  return result;
}

export function brepScalarPossibleUnits(
  value: BrepScalar,
  parameterUnits: ReadonlyMap<string, BrepParameterUnit>,
): BrepParameterUnit[] {
  return [...scalarPossibleUnits(value, parameterUnits)].sort();
}

function normalizedExpression(
  value: Record<string, unknown>,
  options: ScalarNormalizationOptions,
  depth: number,
  state: { nodes: number },
): BrepScalarExpression {
  if (depth > BREP_SCALAR_EXPRESSION_MAX_DEPTH) {
    throw new BrepScalarValidationError(
      'invalid_scalar',
      `${options.field} scalar expression exceeds maximum depth ${BREP_SCALAR_EXPRESSION_MAX_DEPTH}.`,
    );
  }
  state.nodes += 1;
  if (state.nodes > BREP_SCALAR_EXPRESSION_MAX_NODES) {
    throw new BrepScalarValidationError(
      'invalid_scalar',
      `${options.field} scalar expression exceeds maximum node count ${BREP_SCALAR_EXPRESSION_MAX_NODES}.`,
    );
  }

  const op = value.op;
  if (!['add', 'sub', 'mul', 'div', 'neg'].includes(String(op))) {
    throw new BrepScalarValidationError(
      'invalid_scalar',
      `${options.field} scalar expression op must be add, sub, mul, div, or neg.`,
    );
  }
  if (!Array.isArray(value.args)) {
    throw new BrepScalarValidationError(
      'invalid_scalar',
      `${options.field} scalar expression args must be an array.`,
    );
  }

  const arity = op === 'neg' ? 1 : 2;
  if (value.args.length !== arity) {
    throw new BrepScalarValidationError(
      'invalid_scalar',
      `${options.field} scalar expression ${String(op)} requires exactly ${arity} argument${arity === 1 ? '' : 's'}.`,
    );
  }

  const args = value.args.map((argument, index) =>
    normalizeScalarTree(
      argument,
      { ...options, field: `${options.field}.${String(op)}.args[${index}]` },
      depth + 1,
      state,
    ),
  );

  if (op === 'neg') return { op: 'neg', args: [args[0]!] };
  return {
    op: op as 'add' | 'sub' | 'mul' | 'div',
    args: [args[0]!, args[1]!],
  };
}

function normalizeScalarTree(
  value: unknown,
  options: ScalarNormalizationOptions,
  depth: number,
  state: { nodes: number },
): BrepScalar {
  if (typeof value === 'number')
    return options.normalizeNumber(value, options.field);
  if (!isRecord(value)) {
    throw new BrepScalarValidationError(
      'invalid_scalar',
      `${options.field} must be a number, published parameter reference, or bounded scalar expression.`,
    );
  }

  if ('parameter' in value && !('op' in value)) {
    const parameter = options.normalizeParameterId(
      value.parameter,
      `${options.field} parameter reference`,
    );
    if (!options.parameterIds.has(parameter)) {
      throw new BrepScalarValidationError(
        'invalid_reference',
        `${options.field} references unknown published parameter ${parameter}.`,
      );
    }
    return { parameter };
  }
  if ('op' in value && !('parameter' in value)) {
    return normalizedExpression(value, options, depth, state);
  }

  throw new BrepScalarValidationError(
    'invalid_scalar',
    `${options.field} scalar object must contain exactly one parameter reference or expression op.`,
  );
}

export function normalizeBrepScalarValue(
  value: unknown,
  options: ScalarNormalizationOptions,
): BrepScalar {
  const normalized = normalizeScalarTree(value, options, 0, { nodes: 0 });
  const units = scalarPossibleUnits(normalized, options.parameterUnits);
  if (!options.allowedUnits.some((unit) => units.has(unit))) {
    throw new BrepScalarValidationError(
      'invalid_parameter',
      `${options.field} scalar expression must resolve to unit ${options.allowedUnits.join(' or ')}.`,
    );
  }
  if (
    isBrepScalarExpression(normalized) &&
    normalized.op === 'div' &&
    typeof normalized.args[1] === 'number' &&
    normalized.args[1] === 0
  ) {
    throw new BrepScalarValidationError(
      'invalid_parameter',
      `${options.field} scalar expression divides by zero.`,
    );
  }
  return normalized;
}

export function brepScalarParameterReferences(value: BrepScalar): string[] {
  const references = new Set<string>();
  const visit = (scalar: BrepScalar): void => {
    if (typeof scalar === 'number') return;
    if (isBrepParameterReference(scalar)) {
      references.add(scalar.parameter);
      return;
    }
    scalar.args.forEach(visit);
  };
  visit(value);
  return [...references].sort((left, right) =>
    left.localeCompare(right, 'en-US'),
  );
}

export function brepScalarReferencesParameter(
  value: BrepScalar,
  parameterId: string,
): boolean {
  return brepScalarParameterReferences(value).includes(parameterId);
}

function checkedResolvedNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > BREP_SCALAR_MAX_ABS_VALUE) {
    throw new BrepScalarEvaluationError(
      `${label} must resolve to a finite value with absolute value <= ${BREP_SCALAR_MAX_ABS_VALUE}.`,
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

export function resolveBrepScalar(
  value: BrepScalar,
  parameterValues: Readonly<Record<string, number>>,
): number {
  const visit = (scalar: BrepScalar, depth: number): number => {
    if (depth > BREP_SCALAR_EXPRESSION_MAX_DEPTH) {
      throw new BrepScalarEvaluationError(
        `Scalar expression exceeds maximum depth ${BREP_SCALAR_EXPRESSION_MAX_DEPTH}.`,
      );
    }
    if (typeof scalar === 'number')
      return checkedResolvedNumber(scalar, 'Scalar literal');
    if (isBrepParameterReference(scalar)) {
      if (
        !Object.prototype.hasOwnProperty.call(parameterValues, scalar.parameter)
      ) {
        throw new BrepScalarEvaluationError(
          `Missing scalar parameter value ${scalar.parameter}.`,
        );
      }
      return checkedResolvedNumber(
        parameterValues[scalar.parameter]!,
        `Scalar parameter ${scalar.parameter}`,
      );
    }

    const left = visit(scalar.args[0], depth + 1);
    let result: number;
    if (scalar.op === 'neg') result = -left;
    else {
      const right = visit(scalar.args[1], depth + 1);
      switch (scalar.op) {
        case 'add':
          result = left + right;
          break;
        case 'sub':
          result = left - right;
          break;
        case 'mul':
          result = left * right;
          break;
        case 'div':
          if (right === 0)
            throw new BrepScalarEvaluationError(
              'Scalar expression divides by zero.',
            );
          result = left / right;
          break;
      }
    }
    return checkedResolvedNumber(result, `Scalar ${scalar.op} result`);
  };
  return visit(value, 0);
}

export function formatBrepScalar(value: BrepScalar): string {
  if (typeof value === 'number') return String(value);
  if (isBrepParameterReference(value)) return value.parameter;
  if (value.op === 'neg') return `-(${formatBrepScalar(value.args[0])})`;
  const symbol = { add: '+', sub: '-', mul: '*', div: '/' }[value.op];
  return `(${formatBrepScalar(value.args[0])} ${symbol} ${formatBrepScalar(value.args[1])})`;
}

function appendVectorScalars(
  scalars: Array<{ value: BrepScalar; field: string }>,
  vector: BrepVector3 | undefined,
  field: string,
): void {
  if (!vector) return;
  vector.forEach((value, index) =>
    scalars.push({ value, field: `${field}[${index}]` }),
  );
}

function appendProfileLoopScalars(
  scalars: Array<{ value: BrepScalar; field: string }>,
  loop: BrepProfileLoop,
  field: string,
): void {
  switch (loop.type) {
    case 'rectangle':
      scalars.push(
        { value: loop.width, field: `${field}.width` },
        { value: loop.height, field: `${field}.height` },
      );
      break;
    case 'circle':
      scalars.push({ value: loop.radius, field: `${field}.radius` });
      break;
    case 'closedPolyline':
      loop.points.forEach((point, index) => {
        scalars.push(
          { value: point.u, field: `${field}.points[${index}].u` },
          { value: point.v, field: `${field}.points[${index}].v` },
        );
      });
      break;
  }
}

function appendProfileScalars(
  scalars: Array<{ value: BrepScalar; field: string }>,
  node: Extract<BrepNode, { type: 'extrude' | 'revolve' }>,
): void {
  appendProfileLoopScalars(scalars, node.profile, `${node.id}.profile`);
  node.profile.holes?.forEach((hole, index) => {
    const field = `${node.id}.profile.holes[${index}]`;
    scalars.push(
      { value: hole.offsetU, field: `${field}.offsetU` },
      { value: hole.offsetV, field: `${field}.offsetV` },
    );
    appendProfileLoopScalars(scalars, hole.loop, `${field}.loop`);
  });
}

function projectScalars(
  project: BrepProject,
): Array<{ value: BrepScalar; field: string }> {
  const scalars: Array<{ value: BrepScalar; field: string }> = [];
  appendVectorScalars(scalars, project.placement.origin, 'placement.origin');
  appendVectorScalars(scalars, project.placement.xAxis, 'placement.xAxis');
  appendVectorScalars(scalars, project.placement.yAxis, 'placement.yAxis');
  for (const point of project.projectObject?.points ?? []) {
    appendVectorScalars(
      scalars,
      point.position,
      `projectObject.points.${point.id}.position`,
    );
    appendVectorScalars(
      scalars,
      point.direction,
      `projectObject.points.${point.id}.direction`,
    );
  }
  for (const node of project.nodes) {
    switch (node.type) {
      case 'box':
        scalars.push(
          { value: node.width, field: `${node.id}.width` },
          { value: node.depth, field: `${node.id}.depth` },
          { value: node.height, field: `${node.id}.height` },
        );
        break;
      case 'cylinder':
        scalars.push(
          { value: node.radius, field: `${node.id}.radius` },
          { value: node.height, field: `${node.id}.height` },
        );
        break;
      case 'extrude':
        scalars.push({ value: node.depth, field: `${node.id}.depth` });
        appendProfileScalars(scalars, node);
        break;
      case 'revolve':
        appendProfileScalars(scalars, node);
        break;
      case 'sweep':
        scalars.push(
          { value: node.profile.radius, field: `${node.id}.profile.radius` },
          {
            value: node.path.firstLegLength,
            field: `${node.id}.path.firstLegLength`,
          },
          {
            value: node.path.secondLegLength,
            field: `${node.id}.path.secondLegLength`,
          },
          { value: node.path.bendRadius, field: `${node.id}.path.bendRadius` },
        );
        break;
      case 'transform':
        appendVectorScalars(scalars, node.translate, `${node.id}.translate`);
        appendVectorScalars(scalars, node.rotateDeg, `${node.id}.rotateDeg`);
        break;
      case 'mirror':
        scalars.push({ value: node.offset, field: `${node.id}.offset` });
        break;
      case 'linearPattern':
        scalars.push({ value: node.spacing, field: `${node.id}.spacing` });
        break;
      case 'rectangularPattern':
        scalars.push(
          { value: node.spacingA, field: `${node.id}.spacingA` },
          { value: node.spacingB, field: `${node.id}.spacingB` },
        );
        break;
      case 'circularPattern':
        appendVectorScalars(scalars, node.center, `${node.id}.center`);
        scalars.push({
          value: node.angleStepDeg,
          field: `${node.id}.angleStepDeg`,
        });
        break;
      case 'fillet':
        scalars.push({ value: node.radius, field: `${node.id}.radius` });
        break;
      case 'select':
        break;
      case 'subtract':
      case 'union':
      case 'intersect':
        break;
    }
  }
  return scalars;
}

export function validateBrepProjectScalarValues(
  project: BrepProject,
  parameterValues: Readonly<Record<string, number>>,
): void {
  for (const scalar of projectScalars(project)) {
    try {
      resolveBrepScalar(scalar.value, parameterValues);
    } catch (error) {
      throw new BrepScalarEvaluationError(
        `${scalar.field} evaluation failed: ${error instanceof Error ? error.message : 'unknown scalar error'}`,
      );
    }
  }
}

export function validateBrepProjectScalarDefaults(project: BrepProject): void {
  const defaults = Object.fromEntries(
    project.parameters.map((parameter) => [parameter.id, parameter.default]),
  );
  validateBrepProjectScalarValues(project, defaults);
}

export function brepNodeScalarParameterReferences(node: BrepNode): string[] {
  const references = new Set<string>();
  const append = (scalar: BrepScalar): void => {
    for (const parameter of brepScalarParameterReferences(scalar))
      references.add(parameter);
  };
  const appendVector = (vector: BrepVector3 | undefined): void =>
    vector?.forEach(append);
  const appendLoop = (loop: BrepProfileLoop): void => {
    switch (loop.type) {
      case 'rectangle':
        append(loop.width);
        append(loop.height);
        break;
      case 'circle':
        append(loop.radius);
        break;
      case 'closedPolyline':
        loop.points.forEach((point) => {
          append(point.u);
          append(point.v);
        });
        break;
    }
  };
  const appendProfile = (
    profileNode: Extract<BrepNode, { type: 'extrude' | 'revolve' }>,
  ): void => {
    appendLoop(profileNode.profile);
    profileNode.profile.holes?.forEach((hole) => {
      append(hole.offsetU);
      append(hole.offsetV);
      appendLoop(hole.loop);
    });
  };
  switch (node.type) {
    case 'box':
      append(node.width);
      append(node.depth);
      append(node.height);
      break;
    case 'cylinder':
      append(node.radius);
      append(node.height);
      break;
    case 'extrude':
      append(node.depth);
      appendProfile(node);
      break;
    case 'revolve':
      appendProfile(node);
      break;
    case 'sweep':
      append(node.profile.radius);
      append(node.path.firstLegLength);
      append(node.path.secondLegLength);
      append(node.path.bendRadius);
      break;
    case 'transform':
      appendVector(node.translate);
      appendVector(node.rotateDeg);
      break;
    case 'mirror':
      append(node.offset);
      break;
    case 'linearPattern':
      append(node.spacing);
      break;
    case 'rectangularPattern':
      append(node.spacingA);
      append(node.spacingB);
      break;
    case 'circularPattern':
      appendVector(node.center);
      append(node.angleStepDeg);
      break;
    case 'fillet':
      append(node.radius);
      break;
    case 'select':
      break;
    case 'subtract':
    case 'union':
    case 'intersect':
      break;
  }
  return [...references].sort((left, right) =>
    left.localeCompare(right, 'en-US'),
  );
}
