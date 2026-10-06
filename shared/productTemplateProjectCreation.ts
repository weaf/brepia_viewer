import { normalizeBrepProject, type BrepProject } from './brepProject.ts';
import {
  normalizeBuiltinProductTemplate,
  type BuiltinProductTemplate,
} from './productTemplate.ts';
import type { BuiltinTemplateProjectOrigin } from './projectOrigin.ts';

export type MaterializedBuiltinProductTemplate = Readonly<{
  title: string;
  project: BrepProject;
  projectOrigin: BuiltinTemplateProjectOrigin;
}>;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function digestCanonicalBrepProjectSource(
  project: BrepProject,
): Promise<string> {
  const normalized = normalizeBrepProject(project);
  const encoded = new TextEncoder().encode(JSON.stringify(normalized));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return bytesToHex(new Uint8Array(digest));
}

export async function materializeBuiltinProductTemplate(
  value: unknown,
): Promise<MaterializedBuiltinProductTemplate> {
  const template: BuiltinProductTemplate =
    normalizeBuiltinProductTemplate(value);

  // Re-normalize into a fresh source object. The resulting project therefore
  // starts from the template snapshot without retaining object identity or a
  // runtime dependency on the catalog entry.
  const project = normalizeBrepProject(template.source.source);
  const sourceDigest = await digestCanonicalBrepProjectSource(project);

  return {
    title: template.name,
    project,
    projectOrigin: Object.freeze({
      kind: 'template',
      catalog: 'builtin',
      templateId: template.id,
      templateVersion: template.version,
      sourceDigest,
    }),
  };
}
