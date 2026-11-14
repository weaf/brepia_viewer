import parseParameters from "@shared/parseParameters";
import type { Parameter } from "@shared/types";
import {
  replaceOpenScadProjectFileContent,
  type OpenScadProject,
} from "@shared/openScadProject";

export type OpenScadParameterSet = Record<string, string>;
export type OpenScadParameterSets = Record<string, OpenScadParameterSet>;

export type SavedVariants = {
  originalParameters: OpenScadParameterSet;
  parameterSets: OpenScadParameterSets;
  activeName: string | null;
};

const PARAMETER_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const NUMERIC_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const MAX_PRESET_BYTES = 2 * 1024 * 1024;
const MAX_SETS = 150;
const MAX_PARAMETERS = 1000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeValue(value: unknown): string {
  if (typeof value === "string") {
    if (value.length > 8192) throw new Error("Preset parameter value is too long.");
    return value;
  }
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.length <= 256 &&
      value.every((part) =>
        (typeof part === "number" && Number.isFinite(part)) ||
        typeof part === "boolean" ||
        (typeof part === "string" && part.length <= 8192))) {
    return JSON.stringify(value);
  }
  throw new Error("Preset contains an unsupported parameter value.");
}

export function parseOpenScadPresetJson(input: string): OpenScadParameterSets {
  if (new TextEncoder().encode(input).byteLength > MAX_PRESET_BYTES) {
    throw new Error("OpenSCAD JSON file is too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("Invalid OpenSCAD JSON.");
  }
  if (!record(parsed) || String(parsed.fileFormatVersion) !== "1" ||
      !record(parsed.parameterSets)) {
    throw new Error("Expected OpenSCAD fileFormatVersion 1 and parameterSets.");
  }
  const setEntries = Object.entries(parsed.parameterSets);
  if (setEntries.length > MAX_SETS) throw new Error("Too many saved variants.");
  const result: OpenScadParameterSets = Object.create(null);
  for (const [name, rawSet] of setEntries) {
    validateVariantName(name);
    if (!record(rawSet)) throw new Error('Variant "' + name + '" must be an object.');
    const values: OpenScadParameterSet = Object.create(null);
    const entries = Object.entries(rawSet);
    if (entries.length > MAX_PARAMETERS) throw new Error("Too many parameters in variant.");
    for (const [key, value] of entries) {
      if (!PARAMETER_NAME.test(key) || key.length > 120 ||
          key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new Error("Invalid OpenSCAD parameter name: " + key);
      }
      values[key] = normalizeValue(value);
    }
    result[name] = values;
  }
  return result;
}

export function serializeOpenScadPresetJson(sets: OpenScadParameterSets): string {
  const serializable = Object.fromEntries(
    Object.entries(sets).map(([name, values]) => [
      name,
      Object.fromEntries(Object.entries(values).map(([key, value]) => [key, normalizeValue(value)])),
    ]),
  );
  return JSON.stringify({ fileFormatVersion: "1", parameterSets: serializable }, null, 2) + "\n";
}

export function validateVariantName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 80 || [...normalized].some(character => character.charCodeAt(0) < 32) ||
      normalized === "__proto__" || normalized === "constructor" ||
      normalized === "prototype") {
    throw new Error("Variant name must have 1–80 printable characters.");
  }
  return normalized;
}

function literal(parameter: Parameter): string {
  const value = parameter.value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return JSON.stringify(value);
  throw new Error("Unsupported Customizer parameter type.");
}

/** Capture source values as OpenSCAD's JSON literal strings, combining vector sliders. */
export function captureCustomizerValues(source: string): OpenScadParameterSet {
  const result: OpenScadParameterSet = Object.create(null);
  const vectors: Record<string, number[]> = Object.create(null);
  for (const parameter of parseParameters(source)) {
    const part = /^(.+)\[(\d+)\]$/.exec(parameter.name);
    if (part && typeof parameter.value === "number") {
      (vectors[part[1]] ??= [])[Number(part[2])] = parameter.value;
    } else {
      result[parameter.name] = literal(parameter);
    }
  }
  for (const [name, values] of Object.entries(vectors)) {
    if (!values.every((value) => Number.isFinite(value))) continue;
    result[name] = JSON.stringify(values);
  }
  return result;
}

export function createSavedVariants(source: string): SavedVariants {
  return {
    originalParameters: captureCustomizerValues(source),
    parameterSets: Object.create(null),
    activeName: null,
  };
}

function isValidLiteral(text: string, expectedType: string): boolean {
  const value = text.trim();
  if (expectedType === "number") {
    return NUMERIC_LITERAL.test(value) && Number.isFinite(Number(value));
  }
  if (expectedType === "boolean") return value === "true" || value === "false";
  if (expectedType === "string") return text.length <= 8192;
  if (expectedType === "number[]" || expectedType === "boolean[]" ||
      expectedType === "string[]") {
    try {
      const parts: unknown = JSON.parse(value);
      if (!Array.isArray(parts) || parts.length > 256) return false;
      const type = expectedType.slice(0, -2);
      return parts.every((part) => typeof part === type &&
        (type !== "number" || Number.isFinite(part)) &&
        (type !== "string" || (part as string).length <= 8192));
    } catch {
      return false;
    }
  }
  return false;
}

function toSourceLiteral(value: string, expectedType: string): string {
  if (expectedType === "string") return JSON.stringify(value);
  if (expectedType.endsWith("[]")) return JSON.stringify(JSON.parse(value));
  return value.trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type ApplyVariantResult = {
  project: OpenScadProject;
  applied: string[];
  skipped: string[];
};

/** Only changes known, compatible Customizer declarations in the entrypoint. */
export function applyParameterSet(
  project: OpenScadProject,
  values: OpenScadParameterSet,
): ApplyVariantResult {
  const entrypoint = project.files.find((file) => file.path === project.entrypointPath);
  if (!entrypoint) throw new Error("OpenSCAD entrypoint is missing.");
  let source = entrypoint.content;
  const known = new Map<string, string>();
  for (const parameter of parseParameters(source)) {
    const vector = /^(.+)\[\d+\]$/.exec(parameter.name);
    if (vector) known.set(vector[1], "number[]");
    else known.set(parameter.name, parameter.type ?? "number");
  }
  const applied: string[] = [], skipped: string[] = [];
  for (const [name, rawValue] of Object.entries(values)) {
    const expected = known.get(name);
    if (!expected || typeof rawValue !== "string" ||
        !isValidLiteral(rawValue, expected)) {
      skipped.push(name);
      continue;
    }
    const regex = new RegExp(
      "^([ \\t]*" + escapeRegExp(name) + "[ \\t]*=[ \\t]*)([^;\\r\\n]+)(;)",
      "m",
    );
    if (!regex.test(source)) {
      skipped.push(name);
      continue;
    }
    const replacement = toSourceLiteral(rawValue, expected);
    source = source.replace(regex, (_all, prefix: string, _old: string, semicolon: string) =>
      prefix + replacement + semicolon);
    applied.push(name);
  }
  return {
    project: source === entrypoint.content ? project
      : replaceOpenScadProjectFileContent(project, project.entrypointPath, source),
    applied,
    skipped,
  };
}

export function mergeImportedVariants(
  existing: OpenScadParameterSets,
  imported: OpenScadParameterSets,
): OpenScadParameterSets {
  const merged = Object.assign(Object.create(null), existing) as OpenScadParameterSets;
  for (const [name, set] of Object.entries(imported)) {
    let candidate = name;
    let index = 2;
    while (Object.hasOwn(merged, candidate)) {
      candidate = name + " (imported " + index++ + ")";
      validateVariantName(candidate);
    }
    merged[candidate] = set;
  }
  return merged;
}
