export const DEFAULT_CONVERSATION_TITLE = 'New Conversation';
export const MAX_CONVERSATION_TITLE_LENGTH = 79;

type ConversationTitleContext = {
  imageCount?: number;
  meshCount?: number;
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripPromptBoilerplate(value: string): string {
  let result = value;
  const prefixes = [
    /^please\s+/i,
    /^(?:can|could|would) you\s+/i,
    /^(?:kan|skulle) du\s+/i,
    /^(?:jag vill att du|jag skulle vilja att du)\s+/i,
    /^use the (?:attached|provided) image(?:s)? as (?:a )?visual reference and\s+/i,
    /^använd (?:den|de) bifogade bild(?:en|erna) som visuell referens och\s+/i,
    /^(?:create|make|build|design|generate)\s+/i,
    /^(?:skapa|bygg|gör|designa|generera)\s+/i,
  ];

  for (const prefix of prefixes) {
    result = result.replace(prefix, '');
  }
  return result.trim();
}

function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const shortened = value.slice(0, maxLength + 1);
  const boundary = shortened.lastIndexOf(' ');
  const candidate =
    boundary >= Math.floor(maxLength * 0.6)
      ? shortened.slice(0, boundary)
      : shortened.slice(0, maxLength);
  return candidate.trimEnd();
}

function cleanTitleCandidate(value: string): string {
  return collapseWhitespace(value)
    .replace(/^[-–—:;,.\s]+/, '')
    .replace(/[-–—:;,.\s]+$/, '')
    .trim();
}

function fallbackFromContext(context: ConversationTitleContext): string {
  const imageCount = context.imageCount ?? 0;
  const meshCount = context.meshCount ?? 0;
  if (imageCount > 0 && meshCount > 0)
    return 'CAD from image and mesh references';
  if (imageCount > 0) return 'CAD from image reference';
  if (meshCount > 0) return 'CAD model edit';
  return DEFAULT_CONVERSATION_TITLE;
}

/**
 * Produce a useful local title without requiring any external model/provider.
 * The conversation UUID remains the stable technical identity; this title is
 * human-readable metadata only.
 */
export function conversationTitleFromText(
  text: string,
  context: ConversationTitleContext = {},
): string {
  const collapsed = collapseWhitespace(text);
  if (!collapsed) return fallbackFromContext(context);

  const firstSentence = collapsed.split(/(?<=[.!?])\s+/u, 1)[0] ?? collapsed;
  const withoutBoilerplate = stripPromptBoilerplate(firstSentence);
  const candidate = cleanTitleCandidate(withoutBoilerplate || firstSentence);
  if (!candidate) return fallbackFromContext(context);

  return truncateAtWordBoundary(candidate, MAX_CONVERSATION_TITLE_LENGTH);
}

/** Normalize an optional model-generated title and fall back deterministically. */
export function normalizeConversationTitle(
  generated: string | null | undefined,
  fallbackText: string,
  context: ConversationTitleContext = {},
): string {
  const fallback = conversationTitleFromText(fallbackText, context);
  if (!generated) return fallback;

  const firstLine = generated.split(/\r?\n/, 1)[0] ?? '';
  const normalized = cleanTitleCandidate(
    firstLine
      .replace(/^(?:title|titel)\s*:\s*/i, '')
      .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, ''),
  );
  if (!normalized || normalized === DEFAULT_CONVERSATION_TITLE) return fallback;
  return truncateAtWordBoundary(normalized, MAX_CONVERSATION_TITLE_LENGTH);
}
