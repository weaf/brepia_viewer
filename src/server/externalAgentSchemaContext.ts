import { brepAiBuildProviderInputSchema } from '@shared/brepAiTool';

export const BREP_AGENT_SCHEMA_CONTEXT_TAG = 'brepia_brep_schema';

type JsonSchemaObject = {
  properties?: Record<string, unknown>;
};

function externalBrepProjectJsonSchema(): unknown {
  const buildInputSchema =
    brepAiBuildProviderInputSchema.jsonSchema as JsonSchemaObject;
  const projectSchema = buildInputSchema.properties?.['project'];
  if (!projectSchema) {
    throw new Error(
      'Native BRep provider schema is missing its canonical project property.',
    );
  }
  return projectSchema;
}

export function buildExternalAgentSchemaContext(
  sourceKind: 'openscad' | 'brep',
): string {
  if (sourceKind !== 'brep') return '';

  return [
    `<${BREP_AGENT_SCHEMA_CONTEXT_TAG}>`,
    'This is the authoritative canonical Native BRep project JSON Schema supplied by Brepia.',
    'The JSON below is the exact grammar for the `project` value in the final-result envelope; it is not a tool-call schema.',
    'Do not search the repository, filesystem, documentation, network, or other tools to discover or infer the BRep schema.',
    JSON.stringify(externalBrepProjectJsonSchema()),
    `</${BREP_AGENT_SCHEMA_CONTEXT_TAG}>`,
  ].join('\n');
}
