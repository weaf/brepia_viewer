import {
  brepNodeValueKind,
  normalizeBrepProject,
  type BrepNodeValueKind,
} from './brepProject.ts';
import {
  analyzeBrepProjectIntegrity,
  type BrepProjectIntegrityAnalysis,
} from './brepProjectIntegrity.ts';
import {
  normalizeBuiltinProductTemplate,
  resolveBuiltinProductTemplateParameterPresentation,
  type BuiltinProductTemplate,
} from './productTemplate.ts';
import { digestCanonicalBrepProjectSource } from './productTemplateProjectCreation.ts';

export type BuiltinProductTemplateStaticValidation = Readonly<{
  template: BuiltinProductTemplate;
  sourceDigest: string;
  definitionDigest: string;
  expectedResultKind: BrepNodeValueKind;
  publishedControlIds: readonly string[];
  integrity: BrepProjectIntegrityAnalysis;
}>;

export class ProductTemplateValidationError extends Error {
  constructor(
    public readonly code: 'm0_integrity' | 'ineffective_published_control',
    message: string,
  ) {
    super(message);
    this.name = 'ProductTemplateValidationError';
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function digestBuiltinProductTemplateDefinition(
  value: unknown,
): Promise<string> {
  const template = normalizeBuiltinProductTemplate(value);
  const encoded = new TextEncoder().encode(JSON.stringify(template));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return bytesToHex(new Uint8Array(digest));
}

export async function validateBuiltinProductTemplateStatic(
  value: unknown,
): Promise<BuiltinProductTemplateStaticValidation> {
  const template = normalizeBuiltinProductTemplate(value);
  const project = normalizeBrepProject(template.source.source);
  const integrity = analyzeBrepProjectIntegrity(project);

  const defects: string[] = [];
  if (integrity.orphanNodeIds.length > 0) {
    defects.push(`orphan nodes: ${integrity.orphanNodeIds.join(', ')}`);
  }
  if (integrity.orphanOnlyParameterIds.length > 0) {
    defects.push(
      `orphan-only parameters: ${integrity.orphanOnlyParameterIds.join(', ')}`,
    );
  }
  if (integrity.unusedParameterIds.length > 0) {
    defects.push(`unused parameters: ${integrity.unusedParameterIds.join(', ')}`);
  }
  if (defects.length > 0) {
    throw new ProductTemplateValidationError(
      'm0_integrity',
      `Built-in product template ${template.id}@${template.version} violates M0 integrity: ${defects.join('; ')}.`,
    );
  }

  const effectiveIds = new Set(integrity.effectiveParameterIds);
  const publishedControlIds = resolveBuiltinProductTemplateParameterPresentation(
    template,
  )
    .filter((parameter) => parameter.visibility === 'visible')
    .map((parameter) => parameter.id);
  const ineffectivePublishedControlIds = publishedControlIds.filter(
    (parameterId) => !effectiveIds.has(parameterId),
  );
  if (ineffectivePublishedControlIds.length > 0) {
    throw new ProductTemplateValidationError(
      'ineffective_published_control',
      `Built-in product template ${template.id}@${template.version} exposes controls that do not affect authoritative geometry: ${ineffectivePublishedControlIds.join(', ')}.`,
    );
  }

  const resultNode = project.nodes.find((node) => node.id === project.resultNodeId);
  if (!resultNode) {
    throw new Error(
      `Normalized BRep project is missing result node ${project.resultNodeId}.`,
    );
  }

  return Object.freeze({
    template,
    sourceDigest: await digestCanonicalBrepProjectSource(project),
    definitionDigest: await digestBuiltinProductTemplateDefinition(template),
    expectedResultKind: brepNodeValueKind(resultNode),
    publishedControlIds: Object.freeze([...publishedControlIds]),
    integrity,
  });
}
