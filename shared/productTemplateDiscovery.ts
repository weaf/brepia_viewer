import {
  resolveBuiltinProductTemplateParameterPresentation,
  type ResolvedProductTemplateParameterPresentation,
} from './productTemplate.ts';
import type { BuiltinProductTemplateCatalog } from './productTemplateCatalog.ts';

export type ProductTemplateDiscoveryParameter = Readonly<{
  id: string;
  label: string;
  unit: ResolvedProductTemplateParameterPresentation['unit'];
  unitLabel?: string;
}>;

export type ProductTemplateDiscoveryItem = Readonly<{
  templateId: string;
  templateVersion: number;
  name: string;
  category: string;
  description?: string;
  supportedUse?: string;
  previewAssetId?: string;
  previewUrl?: string;
  importantParameters: readonly ProductTemplateDiscoveryParameter[];
}>;

const MAX_DISCOVERY_PARAMETERS = 4;

function importantParameters(
  parameters: readonly ResolvedProductTemplateParameterPresentation[],
): readonly ProductTemplateDiscoveryParameter[] {
  const visible = parameters.filter(
    (parameter) => parameter.visibility === 'visible',
  );
  const ordered = [
    ...visible.filter((parameter) => parameter.tier === 'basic'),
    ...visible.filter((parameter) => parameter.tier === 'advanced'),
  ];

  return Object.freeze(
    ordered.slice(0, MAX_DISCOVERY_PARAMETERS).map((parameter) =>
      Object.freeze({
        id: parameter.id,
        label: parameter.label,
        unit: parameter.unit,
        ...(parameter.unitLabel ? { unitLabel: parameter.unitLabel } : {}),
      }),
    ),
  );
}

export function listBuiltinProductTemplateDiscovery(
  catalog: BuiltinProductTemplateCatalog,
): readonly ProductTemplateDiscoveryItem[] {
  const familyIds = Array.from(
    new Set(catalog.templates.map((template) => template.id)),
  );

  const items = familyIds.map((templateId) => {
    const template = catalog.getLatest(templateId);
    if (!template) {
      throw new Error(
        `Built-in product template family has no latest version: ${templateId}.`,
      );
    }

    const parameters =
      resolveBuiltinProductTemplateParameterPresentation(template);

    return Object.freeze({
      templateId: template.id,
      templateVersion: template.version,
      name: template.name,
      category: template.category,
      ...(template.description ? { description: template.description } : {}),
      ...(template.supportedUse ? { supportedUse: template.supportedUse } : {}),
      ...(template.presentation?.preview?.assetId
        ? {
            previewAssetId: template.presentation.preview.assetId,
            previewUrl: `/${template.presentation.preview.assetId}`,
          }
        : {}),
      importantParameters: importantParameters(parameters),
    });
  });

  items.sort(
    (left, right) =>
      left.category.localeCompare(right.category, 'en-US') ||
      left.name.localeCompare(right.name, 'en-US') ||
      left.templateId.localeCompare(right.templateId, 'en-US'),
  );

  return Object.freeze(items);
}
