import type { AgentParametricSourceKind } from './opencodeAgentResult';

export const BREPIA_OPENCODE_AGENT = 'brepia-builder' as const;
export const BREP_OPENCODE_AGENT = 'brep-builder' as const;

export type OpenCodeAgentName =
  typeof BREPIA_OPENCODE_AGENT | typeof BREP_OPENCODE_AGENT;

export function openCodeAgentForSourceKind(
  sourceKind: AgentParametricSourceKind = 'openscad',
): OpenCodeAgentName {
  return sourceKind === 'brep' ? BREP_OPENCODE_AGENT : BREPIA_OPENCODE_AGENT;
}
