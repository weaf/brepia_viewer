import OpenSCADError from '@/lib/OpenSCADError';
import { OpenScadTimeoutError } from '@/lib/openScadTimeoutError';

export type OpenScadFailureKind =
  | 'timeout'
  | 'source-limit'
  | 'output-limit'
  | 'syntax'
  | 'compile'
  | 'runtime';

export type OpenScadFailureFeedback = {
  kind: OpenScadFailureKind;
  title: string;
  message: string;
  canRetry: boolean;
  diagnostics: string | null;
};

function firstDiagnostic(text: string): string {
  const line = text.split(/\r?\n/).map((value) => value.trim())
    .find((value) => /(?:error|warning|failed|invalid)/i.test(value));
  return (line || text.split(/\r?\n/).find((value) => value.trim()) || '').slice(0, 280);
}

/** User-facing, bounded preview diagnostics without discarding compiler details. */
export function describeOpenScadFailure(error: unknown): OpenScadFailureFeedback {
  const raw = error instanceof Error ? error.message : 'Unknown OpenSCAD error';
  const diagnostics = error instanceof OpenSCADError
    ? error.stdErr.join('\n').slice(0, 12000)
    : null;
  const detail = firstDiagnostic(diagnostics || raw);
  const text = [raw, diagnostics || ''].join('\n');

  if (error instanceof OpenScadTimeoutError ||
      /OpenSCAD worker timed out|OpenSCAD operation timed out/i.test(text)) {
    return {
      kind: 'timeout',
      title: 'Preview timed out',
      message: 'This model took too long to compile. The OpenSCAD worker was restarted; you can retry the preview or simplify the model.',
      canRetry: true,
      diagnostics,
    };
  }
  if (/OpenSCAD source exceeds|source.*byte.*limit/i.test(text)) {
    return {
      kind: 'source-limit',
      title: 'Source file too large',
      message: 'The source exceeds the browser size limit. Reduce the code or split it into project files.',
      canRetry: false,
      diagnostics,
    };
  }
  if (/OpenSCAD output exceeds|output.*byte.*limit/i.test(text)) {
    return {
      kind: 'output-limit',
      title: 'Mesh too large',
      message: 'The compiled geometry exceeds the browser output limit. Try fewer facets ($fn) or simplify the model.',
      canRetry: false,
      diagnostics,
    };
  }
  if (/parser error|syntax error|unexpected token/i.test(text)) {
    return {
      kind: 'syntax',
      title: 'OpenSCAD syntax error',
      message: detail || 'Check your OpenSCAD code for a syntax error.',
      canRetry: false,
      diagnostics,
    };
  }
  if (error instanceof OpenSCADError) {
    return {
      kind: 'compile',
      title: 'OpenSCAD could not compile',
      message: detail || 'Check the module names, libraries and parameter values.',
      canRetry: false,
      diagnostics,
    };
  }
  return {
    kind: 'runtime',
    title: 'Preview unavailable',
    message: detail || 'The preview failed. Please retry.',
    canRetry: true,
    diagnostics,
  };
}
