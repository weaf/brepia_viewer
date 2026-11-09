export class OpenScadTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super('OpenSCAD operation timed out after ' + Math.round(timeoutMs / 1000) + ' seconds.');
    this.name = 'OpenScadTimeoutError';
  }
}
