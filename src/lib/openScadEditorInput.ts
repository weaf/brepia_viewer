import {
  applyOpenScadAutoPair,
  type OpenScadAutoPairEdit,
} from './openScadEditor';

interface RecoverAutoPairRequest {
  source: string;
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
}

const AUTO_PAIR_KEYS = new Set(['(', ')', '<', '>']);

/**
 * Mobile virtual keyboards do not consistently emit useful keydown events.
 * Recover a simple one-character insertion from the resulting textarea value
 * and run it through the same OpenSCAD-aware auto-pair rules used by
 * beforeinput/hardware keyboards.
 */
export function recoverOpenScadAutoPairAfterInput({
  source,
  nextValue,
  selectionStart,
  selectionEnd,
}: RecoverAutoPairRequest): OpenScadAutoPairEdit | null {
  if (selectionStart !== selectionEnd) return null;
  if (nextValue.length !== source.length + 1) return null;

  const insertionEnd = Math.max(0, Math.min(selectionStart, nextValue.length));
  const insertionStart = insertionEnd - 1;
  if (insertionStart < 0) return null;

  const key = nextValue.slice(insertionStart, insertionEnd);
  if (!AUTO_PAIR_KEYS.has(key)) return null;

  const expectedValue =
    source.slice(0, insertionStart) + key + source.slice(insertionStart);
  if (nextValue !== expectedValue) return null;

  return applyOpenScadAutoPair({
    source,
    selectionStart: insertionStart,
    selectionEnd: insertionStart,
    key,
  });
}
