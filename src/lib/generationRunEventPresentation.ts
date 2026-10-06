import type { GenerationRunEventSnapshot } from '@shared/generationRunEvent';

function humanizeDiagnosticCode(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .join(' ');
}

function eventDiagnostic(event: GenerationRunEventSnapshot): string | undefined {
  if (event.errorCode) return humanizeDiagnosticCode(event.errorCode);
  return event.errorMessage?.trim() || undefined;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function generationRunEventLabel(
  event: GenerationRunEventSnapshot,
): string {
  switch (event.kind) {
    case 'external_agent_invoked':
      return `Starting agent invocation ${event.invocationNumber}`;
    case 'canonical_candidate_received':
      return `Candidate ${event.candidateNumber} received`;
    case 'canonical_candidate_rejected': {
      const diagnostic = eventDiagnostic(event);
      return `Candidate ${event.candidateNumber} rejected${diagnostic ? ` — ${diagnostic}` : ''}`;
    }
    case 'canonical_candidate_accepted':
      return `Candidate ${event.candidateNumber} accepted`;
    case 'build_attempt_started':
      return event.buildAttemptNumber === 1
        ? 'Validating build'
        : `Validating build · attempt ${event.buildAttemptNumber}`;
    case 'build_rejected': {
      const diagnostic = eventDiagnostic(event);
      return `Build rejected${diagnostic ? ` — ${diagnostic}` : ''}`;
    }
    case 'build_accepted':
      return 'Build accepted';
    case 'model_step':
      return `Model step ${event.modelStepNumber}`;
    case 'transport_repair':
      return `Repairing candidate · repair ${event.repairCount}`;
    case 'context_usage': {
      const used = formatTokens(event.contextUsedTokens ?? 0);
      return event.contextLimitTokens
        ? `Context usage ${used} / ${formatTokens(event.contextLimitTokens)} tokens`
        : `Context usage ${used} tokens`;
    }
  }
}
