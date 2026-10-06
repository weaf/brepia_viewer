import { createBundledHighlighter } from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import {
  bundledLanguages,
  bundledThemes,
} from '@/generated/shikiBundles';

const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine({ forgiving: true }),
});

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;

function getOpenScadHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      langs: ['openscad'],
      themes: ['github-dark'],
    });
  }
  return highlighterPromise;
}

export async function highlightOpenScadSource(source: string): Promise<string> {
  const highlighter = await getOpenScadHighlighter();
  return highlighter.codeToHtml(source || ' ', {
    lang: 'openscad',
    theme: 'github-dark',
  });
}
