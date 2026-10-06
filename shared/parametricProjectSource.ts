import {
  BrepProjectError,
  normalizeBrepProject,
  type BrepProject,
} from './brepProject.ts';
import {
  normalizeOpenScadProject,
  type OpenScadProject,
} from './openScadProject.ts';

/**
 * The canonical source carried by a parametric artifact. Runtime geometry,
 * tessellation and exports deliberately do not belong here.
 */
export type ParametricProjectSource =
  | { kind: 'openscad'; source: OpenScadProject }
  | { kind: 'brep'; source: BrepProject };

/** Existing artifacts stored the normalized OpenSCAD project directly. */
export type ParametricProjectSourceInput =
  OpenScadProject | ParametricProjectSource;

export class ParametricProjectSourceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ParametricProjectSourceError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize the persisted source boundary. A missing discriminator is the
 * intentional legacy OpenSCAD representation, never an inference from files.
 */
export function normalizeParametricProjectSource(
  value: unknown,
): ParametricProjectSource {
  if (!isRecord(value)) {
    throw new ParametricProjectSourceError(
      'Parametric project source must be an object.',
    );
  }

  if (!Object.prototype.hasOwnProperty.call(value, 'kind')) {
    try {
      return {
        kind: 'openscad',
        source: normalizeOpenScadProject(value as OpenScadProject),
      };
    } catch (error) {
      throw new ParametricProjectSourceError(
        'Legacy parametric project source is not a valid OpenSCAD project.',
        error,
      );
    }
  }

  if (value.kind === 'openscad') {
    try {
      return {
        kind: 'openscad',
        source: normalizeOpenScadProject(value.source as OpenScadProject),
      };
    } catch (error) {
      throw new ParametricProjectSourceError(
        'OpenSCAD parametric project source is invalid.',
        error,
      );
    }
  }

  if (value.kind === 'brep') {
    try {
      return { kind: 'brep', source: normalizeBrepProject(value.source) };
    } catch (error) {
      const detail =
        error instanceof BrepProjectError ? ` (${error.code})` : '';
      throw new ParametricProjectSourceError(
        `BRep parametric project source is invalid or unsupported${detail}.`,
        error,
      );
    }
  }

  throw new ParametricProjectSourceError(
    'Parametric project source kind must be openscad or brep.',
  );
}

export function normalizeOpenScadParametricProjectSource(
  value: unknown,
): OpenScadProject {
  const source = normalizeParametricProjectSource(value);
  if (source.kind !== 'openscad') {
    throw new ParametricProjectSourceError(
      'Expected an OpenSCAD parametric project source.',
    );
  }
  return source.source;
}
