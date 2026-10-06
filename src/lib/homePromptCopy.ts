export const HOME_PROMPT_MESSAGES = [
  'Bring your idea to life with Brepia...',
  'Shape your idea with Brepia...',
  'Turn an idea into geometry with Brepia...',
  'Create something new with Brepia...',
  'What will you create with Brepia?',
] as const;

export type HomePromptMessage = (typeof HOME_PROMPT_MESSAGES)[number];

const LAST_HOME_PROMPT_KEY = 'brepia-home-prompt:last';

function readLastHomePrompt(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(LAST_HOME_PROMPT_KEY);
  } catch {
    return null;
  }
}

function rememberHomePrompt(message: HomePromptMessage) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(LAST_HOME_PROMPT_KEY, message);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

/**
 * Pick one piece of start-page prompt copy for the current visit.
 *
 * In a browser session the previous line is excluded so a reload or return to
 * the home page does not immediately repeat the same copy. The selection stays
 * presentation-only and never affects the real prompt or conversation state.
 */
export function pickHomePromptMessage(
  random: () => number = Math.random,
): HomePromptMessage {
  const previous = readLastHomePrompt();
  const candidates = HOME_PROMPT_MESSAGES.filter(
    (message) => message !== previous,
  );
  const pool = candidates.length > 0 ? candidates : HOME_PROMPT_MESSAGES;
  const sample = random();
  const boundedSample = Number.isFinite(sample)
    ? Math.max(0, Math.min(0.999999999, sample))
    : 0;
  const index = Math.floor(boundedSample * pool.length);
  const message = pool[index] ?? HOME_PROMPT_MESSAGES[0];

  rememberHomePrompt(message);
  return message;
}
