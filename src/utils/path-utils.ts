/**
 * Path normalization utilities.
 *
 * Provides a single `normalizePath` function that converts any of the
 * following input forms into a clean, absolute POSIX path:
 *
 *   - Absolute paths         → returned as-is (canonicalized)
 *   - Relative paths         → resolved against `process.cwd()`
 *   - Tilde-paths (`~/foo`)  → expanded using `os.homedir()` then resolved
 *
 * All returned paths are:
 *   - POSIX-formatted (`/` separators, even on Windows)
 *   - Canonical (no `.` / `..` segments, no double slashes)
 *   - Absolute
 */

import os from 'node:os';
import path from 'node:path';

export interface NormalizeOptions {
  /**
   * Base directory to resolve relative paths against.
   * Defaults to `process.cwd()`.
   */
  cwd?: string;
}

/**
 * Normalize a file path to an absolute POSIX path.
 *
 * @param filePath  The path to normalize.
 * @param options   Optional configuration.
 * @returns         An absolute, canonical POSIX path string.
 */
export function normalizePath(
  filePath: string,
  options: NormalizeOptions = {},
): string {
  const { cwd = process.cwd() } = options;

  // --- 1. Expand `~` / `~user` — only handle the simple `~` case ---
  let expanded: string;
  if (filePath.startsWith('~/')) {
    expanded = path.join(os.homedir(), filePath.slice(2));
  } else if (filePath === '~') {
    expanded = os.homedir();
  } else {
    expanded = filePath;
  }

  // --- 2. Resolve to absolute ---
  let absolute: string;
  if (path.isAbsolute(expanded)) {
    absolute = expanded;
  } else {
    absolute = path.resolve(cwd, expanded);
  }

  // --- 3. Canonicalize — collapse `.`, `..`, duplicate separators ---
  const canonical = path.normalize(absolute);

  // --- 4. POSIX-ify — ensure forward slashes on all platforms ---
  return canonical.replace(/\\/g, '/');
}
