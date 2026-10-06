import OpenSCADError from '@/lib/OpenSCADError';

// Rebuild a useful Error from the `err` field of a worker response message.
//
// OpenSCAD compile failures cross the worker boundary as a serialized
// OpenSCADError carrying `stdErr` — the compiler's actual diagnostics
// ("Ignoring unknown module 'cuboid'", syntax errors with line numbers).
// Preserve that identity on the main thread so the preview can offer
// `Fix with AI`, while keeping stderr folded into `message` for existing
// promise-based callers that only inspect `error.message`.

// Enough to include full BOSL2 assertion backtraces without letting a
// runaway ECHO loop flood the model context.
const MAX_STDERR_LINES = 100;

type SerializedWorkerError = {
  name?: string;
  message?: string;
  code?: string;
  stdErr?: string[];
};

function boundedStdErr(stdErr: string[] | undefined): string[] {
  const filtered = Array.isArray(stdErr)
    ? stdErr.filter((line) => line.trim().length > 0)
    : [];

  if (filtered.length <= MAX_STDERR_LINES) return filtered;

  // Diagnostics cluster at both ends: the first bad include/module up top,
  // the fatal assertion or "Can't parse" at the bottom. Keep both halves.
  const half = MAX_STDERR_LINES / 2;
  return [
    ...filtered.slice(0, half),
    `... ${filtered.length - MAX_STDERR_LINES} more lines ...`,
    ...filtered.slice(-half),
  ];
}

export function errorFromWorker(err: SerializedWorkerError): Error {
  const message = err.message || 'Worker operation failed';
  const stdErr = boundedStdErr(err.stdErr);
  const diagnosticMessage =
    stdErr.length > 0 ? `${message}\n${stdErr.join('\n')}` : message;

  if (err.name === 'OpenSCADError') {
    return new OpenSCADError(
      diagnosticMessage,
      typeof err.code === 'string' ? err.code : '',
      stdErr,
    );
  }

  return new Error(diagnosticMessage);
}
