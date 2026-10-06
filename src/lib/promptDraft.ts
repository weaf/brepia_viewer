export const HOME_PROMPT_DRAFT_KEY = 'brepia:home-prompt-draft:v1';

export type PromptDraftStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

export function getPromptDraftStorage(): PromptDraftStorage | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    return window.sessionStorage;
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
    return undefined;
  }
}

export function readPromptDraft(
  storage: PromptDraftStorage | undefined,
  key: string,
): string {
  if (!storage) return '';

  try {
    return storage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function writePromptDraft(
  storage: PromptDraftStorage | undefined,
  key: string,
  value: string,
): void {
  if (!storage) return;

  try {
    if (value) {
      storage.setItem(key, value);
    } else {
      storage.removeItem(key);
    }
  } catch {
    // A draft must never prevent the composer from working if storage fails.
  }
}
