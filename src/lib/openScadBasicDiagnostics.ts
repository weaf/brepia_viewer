/**
 * Conservative, browser-local draft checks. This is not a full OpenSCAD
 * grammar validator: authoritative compiler errors still come from OpenSCAD.
 */
export interface OpenScadBasicDiagnostic {
  from: number;
  to: number;
  severity: 'error';
  message: string;
}

const closeFor: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
};
const closing = new Set(Object.values(closeFor));
const MAX_SOURCE = 250_000;
const MAX_ISSUES = 64;

export function getOpenScadBasicDiagnostics(source: string): OpenScadBasicDiagnostic[] {
  // Skip large files rather than slowing mobile keystrokes with a full scan.
  if (source.length > MAX_SOURCE) return [];

  const diagnostics: OpenScadBasicDiagnostic[] = [];
  const openings: Array<{ character: string; offset: number }> = [];
  const add = (offset: number, length: number, message: string) => {
    if (diagnostics.length >= MAX_ISSUES) return;
    diagnostics.push({
      from: offset,
      to: Math.min(source.length, offset + length),
      severity: 'error',
      message,
    });
  };

  let unterminated = false;
  for (let cursor = 0; cursor < source.length;) {
    const character = source[cursor];
    const next = source[cursor + 1];

    if (character === '/' && next === '/') {
      const newline = source.indexOf('\n', cursor + 2);
      cursor = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', cursor + 2);
      if (end === -1) {
        add(cursor, 2, 'Unclosed block comment (/*).');
        unterminated = true;
        break;
      }
      cursor = end + 2;
      continue;
    }
    if (character === '"') {
      const beginning = cursor;
      cursor++;
      let terminated = false;
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2;
        } else if (source[cursor] === '"') {
          cursor++;
          terminated = true;
          break;
        } else {
          cursor++;
        }
      }
      if (!terminated) {
        add(beginning, 1, 'Unclosed double-quoted string.');
        unterminated = true;
        break;
      }
      continue;
    }

    if (closeFor[character]) {
      openings.push({ character, offset: cursor });
    } else if (closing.has(character)) {
      const previous = openings[openings.length - 1];
      if (!previous) {
        add(cursor, 1, "Unexpected closing '" + character + "'.");
      } else if (closeFor[previous.character] !== character) {
        add(cursor, 1, "Unexpected '" + character + "'; expected '" + closeFor[previous.character] + "' to close '" + previous.character + "'.");
        const matchingIndex = openings.map(entry => closeFor[entry.character]).lastIndexOf(character);
        openings.splice(matchingIndex < 0 ? openings.length - 1 : matchingIndex);
      } else {
        openings.pop();
      }
    }
    cursor++;
  }

  for (const entry of unterminated ? [] : openings) {
    add(entry.offset, 1, "Missing closing '" + closeFor[entry.character] + "' for '" + entry.character + "'.");
    if (diagnostics.length >= MAX_ISSUES) break;
  }
  return diagnostics.sort((a, b) => a.from - b.from || a.to - b.to);
}
