import {
  BREP_PROJECT_MAX_DESCRIPTION_CHARS,
  BREP_PROJECT_MAX_NAME_CHARS,
  type BrepParameterUnit,
} from './brepProject.ts';
import {
  normalizeParametricProjectSource,
  type ParametricProjectSource,
} from './parametricProjectSource.ts';

export const BUILTIN_PRODUCT_TEMPLATE_ID_PATTERN =
  /^builtin:[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PRODUCT_TEMPLATE_MAX_CATEGORY_CHARS = 120;
export const PRODUCT_TEMPLATE_MAX_GROUPS = 32;
export const PRODUCT_TEMPLATE_MAX_PREVIEW_ASSET_ID_CHARS = 256;
export const PRODUCT_TEMPLATE_MAX_UNIT_LABEL_CHARS = 48;
export const PRODUCT_TEMPLATE_MAX_SUPPORTED_USE_CHARS = 320;
export const BUNDLED_PRODUCT_TEMPLATE_PREVIEW_ASSET_ID_PATTERN =
  /^templates\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.(?:png|jpe?g|webp|avif|svg)$/;

export type ProductTemplatePresentationTier = 'basic' | 'advanced';
export type ProductTemplateParameterVisibility = 'visible' | 'hidden';

export type ProductTemplateParameterPresentation = Readonly<{
  label?: string;
  description?: string;
  unitLabel?: string;
  visibility?: ProductTemplateParameterVisibility;
  tier?: ProductTemplatePresentationTier;
}>;

export type ProductTemplatePresentationGroup = Readonly<{
  id: string;
  label: string;
  description?: string;
  tier?: ProductTemplatePresentationTier;
  parameterIds: readonly string[];
}>;

export type ProductTemplatePresentation = Readonly<{
  parameterOrder?: readonly string[];
  parameters?: Readonly<Record<string, ProductTemplateParameterPresentation>>;
  groups?: readonly ProductTemplatePresentationGroup[];
  preview?: Readonly<{
    kind: 'bundled';
    assetId: string;
  }>;
}>;

export type BuiltinProductTemplate = Readonly<{
  id: string;
  version: number;
  name: string;
  category: string;
  description?: string;
  supportedUse?: string;
  source: Extract<ParametricProjectSource, { kind: 'brep' }>;
  presentation?: ProductTemplatePresentation;
}>;

export type ResolvedProductTemplateParameterPresentation = Readonly<{
  id: string;
  label: string;
  description?: string;
  unit: BrepParameterUnit;
  unitLabel?: string;
  default: number;
  min?: number;
  max?: number;
  step?: number;
  visibility: ProductTemplateParameterVisibility;
  tier: ProductTemplatePresentationTier;
  group?: Readonly<{
    id: string;
    label: string;
    description?: string;
    tier: ProductTemplatePresentationTier;
  }>;
}>;

export type ProductTemplateErrorCode =
  | 'invalid_template'
  | 'invalid_id'
  | 'invalid_version'
  | 'invalid_metadata'
  | 'invalid_source'
  | 'invalid_presentation'
  | 'duplicate_template_version';

export class ProductTemplateError extends Error {
  constructor(
    public readonly code: ProductTemplateErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProductTemplateError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(
  value: unknown,
  field: string,
  maxChars: number,
  required = true,
): string | undefined {
  if (value == null && !required) return undefined;
  if (typeof value !== 'string') {
    throw new ProductTemplateError(
      'invalid_metadata',
      `${field} must be text.`,
    );
  }
  const normalized = value.trim();
  if ((required && normalized.length === 0) || normalized.length > maxChars) {
    throw new ProductTemplateError(
      'invalid_metadata',
      `${field} must be ${required ? 'non-empty and ' : ''}at most ${maxChars} characters.`,
    );
  }
  return normalized;
}

function normalizeParameterReferences(
  value: unknown,
  field: string,
  parameterIds: ReadonlySet<string>,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new ProductTemplateError(
      'invalid_presentation',
      `${field} must be an array of published parameter IDs.`,
    );
  }

  const seen = new Set<string>();
  const normalized = value.map((parameterId, index) => {
    if (typeof parameterId !== 'string' || parameterId.length === 0) {
      throw new ProductTemplateError(
        'invalid_presentation',
        `${field}[${index}] must be a published parameter ID.`,
      );
    }
    if (!parameterIds.has(parameterId)) {
      throw new ProductTemplateError(
        'invalid_presentation',
        `${field} references unknown published parameter ${parameterId}.`,
      );
    }
    if (seen.has(parameterId)) {
      throw new ProductTemplateError(
        'invalid_presentation',
        `${field} contains duplicate published parameter ${parameterId}.`,
      );
    }
    seen.add(parameterId);
    return parameterId;
  });

  return normalized;
}

function normalizeTier(
  value: unknown,
  field: string,
): ProductTemplatePresentationTier | undefined {
  if (value == null) return undefined;
  if (value !== 'basic' && value !== 'advanced') {
    throw new ProductTemplateError(
      'invalid_presentation',
      `${field} must be basic or advanced.`,
    );
  }
  return value;
}

function normalizeVisibility(
  value: unknown,
  field: string,
): ProductTemplateParameterVisibility | undefined {
  if (value == null) return undefined;
  if (value !== 'visible' && value !== 'hidden') {
    throw new ProductTemplateError(
      'invalid_presentation',
      `${field} must be visible or hidden.`,
    );
  }
  return value;
}

const GEOMETRY_AUTHORITY_PRESENTATION_KEYS = new Set([
  'default',
  'min',
  'max',
  'step',
  'unit',
  'type',
]);

function normalizeParameterPresentation(
  value: unknown,
  parameterId: string,
): ProductTemplateParameterPresentation {
  if (!isRecord(value)) {
    throw new ProductTemplateError(
      'invalid_presentation',
      `Product template presentation for parameter ${parameterId} must be an object.`,
    );
  }

  for (const key of GEOMETRY_AUTHORITY_PRESENTATION_KEYS) {
    if (key in value) {
      throw new ProductTemplateError(
        'invalid_presentation',
        `Product template presentation for parameter ${parameterId} cannot define canonical geometry field ${key}.`,
      );
    }
  }

  const label = normalizeText(
    value.label,
    `Product template parameter ${parameterId} display label`,
    BREP_PROJECT_MAX_NAME_CHARS,
    false,
  );
  const description = normalizeText(
    value.description,
    `Product template parameter ${parameterId} help`,
    BREP_PROJECT_MAX_DESCRIPTION_CHARS,
    false,
  );
  const unitLabel = normalizeText(
    value.unitLabel,
    `Product template parameter ${parameterId} unitLabel`,
    PRODUCT_TEMPLATE_MAX_UNIT_LABEL_CHARS,
    false,
  );
  const visibility = normalizeVisibility(
    value.visibility,
    `Product template parameter ${parameterId} visibility`,
  );
  const tier = normalizeTier(
    value.tier,
    `Product template parameter ${parameterId} tier`,
  );

  return {
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    ...(unitLabel ? { unitLabel } : {}),
    ...(visibility ? { visibility } : {}),
    ...(tier ? { tier } : {}),
  };
}

function normalizePresentation(
  value: unknown,
  parameterIds: ReadonlySet<string>,
): ProductTemplatePresentation | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    throw new ProductTemplateError(
      'invalid_presentation',
      'Product template presentation must be an object.',
    );
  }

  const parameterOrder =
    value.parameterOrder == null
      ? undefined
      : normalizeParameterReferences(
          value.parameterOrder,
          'Product template parameterOrder',
          parameterIds,
        );

  let parameters:
    | Readonly<Record<string, ProductTemplateParameterPresentation>>
    | undefined;
  if (value.parameters != null) {
    if (!isRecord(value.parameters)) {
      throw new ProductTemplateError(
        'invalid_presentation',
        'Product template presentation parameters must be an object keyed by published parameter ID.',
      );
    }

    const normalizedParameters: Record<
      string,
      ProductTemplateParameterPresentation
    > = {};
    for (const [parameterId, parameterPresentation] of Object.entries(
      value.parameters,
    ).sort(([left], [right]) => left.localeCompare(right, 'en-US'))) {
      if (!parameterIds.has(parameterId)) {
        throw new ProductTemplateError(
          'invalid_presentation',
          `Product template presentation references unknown published parameter ${parameterId}.`,
        );
      }
      normalizedParameters[parameterId] = normalizeParameterPresentation(
        parameterPresentation,
        parameterId,
      );
    }
    parameters = normalizedParameters;
  }

  let groups: readonly ProductTemplatePresentationGroup[] | undefined;
  if (value.groups != null) {
    if (!Array.isArray(value.groups)) {
      throw new ProductTemplateError(
        'invalid_presentation',
        'Product template presentation groups must be an array.',
      );
    }
    if (value.groups.length > PRODUCT_TEMPLATE_MAX_GROUPS) {
      throw new ProductTemplateError(
        'invalid_presentation',
        `Product template presentation exceeds ${PRODUCT_TEMPLATE_MAX_GROUPS} groups.`,
      );
    }

    const groupIds = new Set<string>();
    const groupedParameterIds = new Set<string>();
    groups = value.groups.map((group, index) => {
      if (!isRecord(group)) {
        throw new ProductTemplateError(
          'invalid_presentation',
          `Product template presentation group ${index} must be an object.`,
        );
      }
      const id = normalizeText(
        group.id,
        `Product template presentation group ${index} id`,
        BREP_PROJECT_MAX_NAME_CHARS,
      )!;
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
        throw new ProductTemplateError(
          'invalid_presentation',
          `Product template presentation group id ${id} is invalid.`,
        );
      }
      if (groupIds.has(id)) {
        throw new ProductTemplateError(
          'invalid_presentation',
          `Duplicate product template presentation group id: ${id}.`,
        );
      }
      groupIds.add(id);

      const label = normalizeText(
        group.label,
        `Product template presentation group ${id} label`,
        BREP_PROJECT_MAX_NAME_CHARS,
      )!;
      const description = normalizeText(
        group.description,
        `Product template presentation group ${id} description`,
        BREP_PROJECT_MAX_DESCRIPTION_CHARS,
        false,
      );
      const tier = normalizeTier(
        group.tier,
        `Product template presentation group ${id} tier`,
      );
      const parameterIdsForGroup = normalizeParameterReferences(
        group.parameterIds,
        `Product template presentation group ${id} parameterIds`,
        parameterIds,
      );
      for (const parameterId of parameterIdsForGroup) {
        if (groupedParameterIds.has(parameterId)) {
          throw new ProductTemplateError(
            'invalid_presentation',
            `Published parameter ${parameterId} cannot belong to more than one presentation group.`,
          );
        }
        groupedParameterIds.add(parameterId);
      }

      return {
        id,
        label,
        ...(description ? { description } : {}),
        ...(tier ? { tier } : {}),
        parameterIds: parameterIdsForGroup,
      };
    });
  }

  let preview: ProductTemplatePresentation['preview'];
  if (value.preview != null) {
    if (!isRecord(value.preview) || value.preview.kind !== 'bundled') {
      throw new ProductTemplateError(
        'invalid_presentation',
        'Product template preview must be a bundled preview reference.',
      );
    }
    const assetId = normalizeText(
      value.preview.assetId,
      'Product template preview assetId',
      PRODUCT_TEMPLATE_MAX_PREVIEW_ASSET_ID_CHARS,
    )!;
    if (!BUNDLED_PRODUCT_TEMPLATE_PREVIEW_ASSET_ID_PATTERN.test(assetId)) {
      throw new ProductTemplateError(
        'invalid_presentation',
        'Product template preview assetId must be a bundled templates/... image path.',
      );
    }
    preview = { kind: 'bundled', assetId };
  }

  const normalized: ProductTemplatePresentation = {
    ...(parameterOrder ? { parameterOrder } : {}),
    ...(parameters ? { parameters } : {}),
    ...(groups ? { groups } : {}),
    ...(preview ? { preview } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return value;
}

export function normalizeBuiltinProductTemplate(
  value: unknown,
): BuiltinProductTemplate {
  if (!isRecord(value)) {
    throw new ProductTemplateError(
      'invalid_template',
      'Built-in product template must be an object.',
    );
  }

  if (
    typeof value.id !== 'string' ||
    !BUILTIN_PRODUCT_TEMPLATE_ID_PATTERN.test(value.id)
  ) {
    throw new ProductTemplateError(
      'invalid_id',
      `Built-in product template id must match ${BUILTIN_PRODUCT_TEMPLATE_ID_PATTERN}.`,
    );
  }
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) {
    throw new ProductTemplateError(
      'invalid_version',
      'Built-in product template version must be a positive safe integer.',
    );
  }

  const name = normalizeText(
    value.name,
    'Product template name',
    BREP_PROJECT_MAX_NAME_CHARS,
  )!;
  const category = normalizeText(
    value.category,
    'Product template category',
    PRODUCT_TEMPLATE_MAX_CATEGORY_CHARS,
  )!;
  const description = normalizeText(
    value.description,
    'Product template description',
    BREP_PROJECT_MAX_DESCRIPTION_CHARS,
    false,
  );
  const supportedUse = normalizeText(
    value.supportedUse,
    'Product template supported use',
    PRODUCT_TEMPLATE_MAX_SUPPORTED_USE_CHARS,
    false,
  );

  let source: ParametricProjectSource;
  try {
    source = normalizeParametricProjectSource(value.source);
  } catch (error) {
    throw new ProductTemplateError(
      'invalid_source',
      'Product template canonical source is invalid or unsupported.',
      error,
    );
  }
  if (source.kind !== 'brep') {
    throw new ProductTemplateError(
      'invalid_source',
      'Product template canonical source must have kind brep.',
    );
  }

  const parameterIds = new Set(
    source.source.parameters.map((parameter) => parameter.id),
  );
  const presentation = normalizePresentation(value.presentation, parameterIds);

  return deepFreeze({
    id: value.id,
    version: value.version as number,
    name,
    category,
    ...(description ? { description } : {}),
    ...(supportedUse ? { supportedUse } : {}),
    source,
    ...(presentation ? { presentation } : {}),
  });
}

export function resolveBuiltinProductTemplateParameterPresentation(
  value: BuiltinProductTemplate,
): readonly ResolvedProductTemplateParameterPresentation[] {
  const template = normalizeBuiltinProductTemplate(value);
  const presentation = template.presentation;
  const byId = new Map(
    template.source.source.parameters.map((parameter) => [parameter.id, parameter]),
  );
  const explicitOrder = presentation?.parameterOrder ?? [];
  const explicitIds = new Set(explicitOrder);
  const orderedIds = [
    ...explicitOrder,
    ...template.source.source.parameters
      .map((parameter) => parameter.id)
      .filter((parameterId) => !explicitIds.has(parameterId)),
  ];

  const groupByParameterId = new Map<
    string,
    ProductTemplatePresentationGroup
  >();
  for (const group of presentation?.groups ?? []) {
    for (const parameterId of group.parameterIds) {
      groupByParameterId.set(parameterId, group);
    }
  }

  return deepFreeze(
    orderedIds.map((parameterId) => {
      const parameter = byId.get(parameterId)!;
      const parameterPresentation = presentation?.parameters?.[parameterId];
      const group = groupByParameterId.get(parameterId);
      const groupTier = group?.tier ?? 'basic';

      return {
        id: parameter.id,
        label: parameterPresentation?.label ?? parameter.label,
        ...(parameterPresentation?.description ?? parameter.description
          ? {
              description:
                parameterPresentation?.description ?? parameter.description,
            }
          : {}),
        unit: parameter.unit,
        ...(parameterPresentation?.unitLabel
          ? { unitLabel: parameterPresentation.unitLabel }
          : {}),
        default: parameter.default,
        ...(parameter.min != null ? { min: parameter.min } : {}),
        ...(parameter.max != null ? { max: parameter.max } : {}),
        ...(parameter.step != null ? { step: parameter.step } : {}),
        visibility: parameterPresentation?.visibility ?? 'visible',
        tier: parameterPresentation?.tier ?? groupTier,
        ...(group
          ? {
              group: {
                id: group.id,
                label: group.label,
                ...(group.description
                  ? { description: group.description }
                  : {}),
                tier: groupTier,
              },
            }
          : {}),
      };
    }),
  );
}

export function normalizeBuiltinProductTemplateCatalog(
  values: readonly unknown[],
): readonly BuiltinProductTemplate[] {
  const seen = new Set<string>();
  const normalized = values.map((value) => {
    const template = normalizeBuiltinProductTemplate(value);
    const key = `${template.id}@${template.version}`;
    if (seen.has(key)) {
      throw new ProductTemplateError(
        'duplicate_template_version',
        `Duplicate built-in product template version: ${key}.`,
      );
    }
    seen.add(key);
    return template;
  });

  normalized.sort(
    (left, right) =>
      left.id.localeCompare(right.id, 'en-US') ||
      left.version - right.version,
  );
  return deepFreeze(normalized);
}
