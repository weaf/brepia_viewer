import { BREP_PROJECT_MAX_NAME_CHARS } from './brepProject.ts';
import {
  normalizeParametricProjectSource,
  type ParametricProjectSource,
} from './parametricProjectSource.ts';

export const BREP_PROJECT_PACKAGE_KIND = 'brepia-brep-project' as const;
export const BREP_PROJECT_PACKAGE_SCHEMA_VERSION = 1 as const;
export const BREP_PROJECT_PACKAGE_MAX_BYTES = 1_048_576;

export type BrepProjectPackage = {
  kind: typeof BREP_PROJECT_PACKAGE_KIND;
  schemaVersion: typeof BREP_PROJECT_PACKAGE_SCHEMA_VERSION;
  title: string;
  source: Extract<ParametricProjectSource, { kind: 'brep' }>;
};

export type BrepProjectPackageErrorCode =
  | 'invalid_package'
  | 'invalid_json'
  | 'unsupported_version'
  | 'too_large';

export class BrepProjectPackageError extends Error {
  constructor(
    public readonly code: BrepProjectPackageErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BrepProjectPackageError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize the portable Phase 2 BRep project representation. Unknown fields
 * are deliberately not carried forward, so derived viewer/STEP/runtime data
 * can never become project authority through import.
 */
export function normalizeBrepProjectPackage(
  value: unknown,
): BrepProjectPackage {
  if (!isRecord(value)) {
    throw new BrepProjectPackageError(
      'invalid_package',
      'BRep project package must be an object.',
    );
  }
  if (value.kind !== BREP_PROJECT_PACKAGE_KIND) {
    throw new BrepProjectPackageError(
      'invalid_package',
      `BRep project package kind must be ${BREP_PROJECT_PACKAGE_KIND}.`,
    );
  }
  if (value.schemaVersion !== BREP_PROJECT_PACKAGE_SCHEMA_VERSION) {
    if (typeof value.schemaVersion === 'number') {
      throw new BrepProjectPackageError(
        'unsupported_version',
        `Unsupported BRep project package schema version: ${value.schemaVersion}.`,
      );
    }
    throw new BrepProjectPackageError(
      'invalid_package',
      'BRep project package schemaVersion is required.',
    );
  }
  if (typeof value.title !== 'string') {
    throw new BrepProjectPackageError(
      'invalid_package',
      'BRep project package title must be text.',
    );
  }
  const title = value.title.trim();
  if (!title || title.length > BREP_PROJECT_MAX_NAME_CHARS) {
    throw new BrepProjectPackageError(
      'invalid_package',
      `BRep project package title must be non-empty and at most ${BREP_PROJECT_MAX_NAME_CHARS} characters.`,
    );
  }

  let source: ParametricProjectSource;
  try {
    source = normalizeParametricProjectSource(value.source);
  } catch (error) {
    throw new BrepProjectPackageError(
      'invalid_package',
      'BRep project package source is invalid.',
      error,
    );
  }
  if (source.kind !== 'brep') {
    throw new BrepProjectPackageError(
      'invalid_package',
      'BRep project package source must have kind brep.',
    );
  }

  return {
    kind: BREP_PROJECT_PACKAGE_KIND,
    schemaVersion: BREP_PROJECT_PACKAGE_SCHEMA_VERSION,
    title,
    source,
  };
}

export function createBrepProjectPackage({
  title,
  source,
}: Pick<BrepProjectPackage, 'title' | 'source'>): BrepProjectPackage {
  return normalizeBrepProjectPackage({
    kind: BREP_PROJECT_PACKAGE_KIND,
    schemaVersion: BREP_PROJECT_PACKAGE_SCHEMA_VERSION,
    title,
    source,
  });
}

/** Stable textual form for source export and semantic round-trip checks. */
export function serializeBrepProjectPackage(value: unknown): string {
  return `${JSON.stringify(normalizeBrepProjectPackage(value), null, 2)}\n`;
}

/**
 * Parse only after the UTF-8 byte bound is checked. This is intentionally a
 * source-project parser; STEP and arbitrary external references are not part of
 * this format.
 */
export function parseBrepProjectPackageJson(text: string): BrepProjectPackage {
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > BREP_PROJECT_PACKAGE_MAX_BYTES) {
    throw new BrepProjectPackageError(
      'too_large',
      `BRep project package exceeds ${BREP_PROJECT_PACKAGE_MAX_BYTES} bytes.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new BrepProjectPackageError(
      'invalid_json',
      'BRep project package is not valid JSON.',
      error,
    );
  }
  return normalizeBrepProjectPackage(value);
}
