import { BUILTIN_PRODUCT_TEMPLATE_ID_PATTERN } from './productTemplate.ts';

export type ScratchProjectOrigin = Readonly<{
  kind: 'scratch';
}>;

export type BuiltinTemplateProjectOrigin = Readonly<{
  kind: 'template';
  catalog: 'builtin';
  templateId: string;
  templateVersion: number;
  sourceDigest: string;
}>;

export type ProjectOrigin = ScratchProjectOrigin | BuiltinTemplateProjectOrigin;

export const SCRATCH_PROJECT_ORIGIN: ScratchProjectOrigin = Object.freeze({
  kind: 'scratch',
});

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Historical settings/message metadata are untrusted jsonb. Invalid or
 * unsupported provenance must degrade to "unknown origin" rather than making
 * an otherwise valid project unreadable.
 */
export function parseProjectOrigin(value: unknown): ProjectOrigin | undefined {
  if (!isRecord(value)) return undefined;

  if (value.kind === 'scratch') {
    return SCRATCH_PROJECT_ORIGIN;
  }

  if (
    value.kind !== 'template' ||
    value.catalog !== 'builtin' ||
    typeof value.templateId !== 'string' ||
    !BUILTIN_PRODUCT_TEMPLATE_ID_PATTERN.test(value.templateId) ||
    !Number.isSafeInteger(value.templateVersion) ||
    (value.templateVersion as number) < 1 ||
    typeof value.sourceDigest !== 'string' ||
    !SHA256_HEX_PATTERN.test(value.sourceDigest)
  ) {
    return undefined;
  }

  return Object.freeze({
    kind: 'template',
    catalog: 'builtin',
    templateId: value.templateId,
    templateVersion: value.templateVersion as number,
    sourceDigest: value.sourceDigest,
  });
}

export function getProjectOriginFromConversationSettings(
  settings: unknown,
): ProjectOrigin | undefined {
  if (!isRecord(settings)) return undefined;
  return parseProjectOrigin(settings.projectOrigin);
}

export function getProjectCreationFromMessageMetadata(
  metadata: unknown,
): ProjectOrigin | undefined {
  if (!isRecord(metadata)) return undefined;
  return parseProjectOrigin(metadata.projectCreation);
}
