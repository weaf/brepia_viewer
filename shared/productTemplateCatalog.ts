import {
  normalizeBuiltinProductTemplateCatalog,
  type BuiltinProductTemplate,
} from './productTemplate.ts';
import { cableConduitV1 } from './productTemplates/cableConduitV1.ts';
import { cableTrayV1 } from './productTemplates/cableTrayV1.ts';
import { electricalCabinetV1 } from './productTemplates/electricalCabinetV1.ts';
import {
  doubleLiddedCableTroughV1,
  liddedCableTroughDeepV1,
  liddedCableTroughV1,
  tripleLiddedCableTroughV1,
} from './productTemplates/liddedCableTroughFamily.ts';

export type BuiltinProductTemplateLookup = Readonly<{
  id: string;
  version: number;
}>;

export type BuiltinProductTemplateCatalog = Readonly<{
  templates: readonly BuiltinProductTemplate[];
  getExact(
    lookup: BuiltinProductTemplateLookup,
  ): BuiltinProductTemplate | undefined;
  requireExact(lookup: BuiltinProductTemplateLookup): BuiltinProductTemplate;
  getLatest(id: string): BuiltinProductTemplate | undefined;
  getVersions(id: string): readonly BuiltinProductTemplate[];
}>;

function templateKey(id: string, version: number): string {
  return `${id}@${version}`;
}

export function createBuiltinProductTemplateCatalog(
  values: readonly unknown[],
): BuiltinProductTemplateCatalog {
  const templates = normalizeBuiltinProductTemplateCatalog(values);
  const byKey = new Map<string, BuiltinProductTemplate>();
  const byId = new Map<string, BuiltinProductTemplate[]>();

  for (const template of templates) {
    byKey.set(templateKey(template.id, template.version), template);
    const family = byId.get(template.id) ?? [];
    family.push(template);
    byId.set(template.id, family);
  }

  for (const family of byId.values()) {
    family.sort((left, right) => left.version - right.version);
    Object.freeze(family);
  }

  const getExact = ({
    id,
    version,
  }: BuiltinProductTemplateLookup): BuiltinProductTemplate | undefined =>
    byKey.get(templateKey(id, version));

  return Object.freeze({
    templates,
    getExact,
    requireExact(lookup: BuiltinProductTemplateLookup) {
      const template = getExact(lookup);
      if (!template) {
        throw new Error(
          `Built-in product template not found: ${lookup.id}@${lookup.version}.`,
        );
      }
      return template;
    },
    getLatest(id: string) {
      const family = byId.get(id);
      return family?.[family.length - 1];
    },
    getVersions(id: string) {
      return byId.get(id) ?? Object.freeze([]);
    },
  });
}

/** Repository-shipped built-in product catalog. */
export const BUILTIN_PRODUCT_TEMPLATES = normalizeBuiltinProductTemplateCatalog(
  [
    electricalCabinetV1,
    cableTrayV1,
    cableConduitV1,
    liddedCableTroughV1,
    liddedCableTroughDeepV1,
    doubleLiddedCableTroughV1,
    tripleLiddedCableTroughV1,
  ],
);

export const builtinProductTemplateCatalog =
  createBuiltinProductTemplateCatalog(BUILTIN_PRODUCT_TEMPLATES);
