export const EXPERIMENTAL_MODE_STORAGE_KEY = "brepia.viewer.experimental.v1";

// Fail closed when a stored value is unknown or from an older experiment.
export function readExperimentalMode(value: string | null): boolean {
  return value === "true";
}
