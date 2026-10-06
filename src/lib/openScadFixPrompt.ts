import type OpenSCADError from '@/lib/OpenSCADError';

const MAX_FIX_DIAGNOSTIC_CHARS = 8_000;

function boundedDiagnostic(error: OpenSCADError): string {
  const stderr = Array.isArray(error.stdErr)
    ? error.stdErr.filter((line) => typeof line === 'string').join('\n')
    : '';
  const diagnostic = [error.message, stderr].filter(Boolean).join('\n').trim();
  return diagnostic.slice(-MAX_FIX_DIAGNOSTIC_CHARS);
}

/**
 * Build the user-visible repair request sent through the existing chat path
 * when the OpenSCAD preview reports a compiler error.
 *
 * The current complete artifact is already present on the active message-tree
 * branch, so the repair request deliberately contains diagnostics only. It
 * must not duplicate/inject the full SCAD source through a second mechanism.
 */
export function openScadFixPrompt(error: OpenSCADError): string {
  const diagnostic = boundedDiagnostic(error);
  const code = typeof error.code === 'string' ? error.code.trim() : '';

  return [
    'Fix the current OpenSCAD model so it compiles successfully.',
    'Keep the existing design intent and parameters unless a change is required to fix the error.',
    'Use the current complete Brepia artifact as the source of truth and return the corrected complete model through build_parametric_model.',
    code ? `Compiler code: ${code}` : '',
    diagnostic ? `Compiler diagnostics:\n${diagnostic}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const __openScadFixPromptTestUtils = {
  maxDiagnosticChars: MAX_FIX_DIAGNOSTIC_CHARS,
};
