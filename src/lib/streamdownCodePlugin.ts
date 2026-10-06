import {
  createBundledHighlighter,
  type HighlighterGeneric,
  type SpecialLanguage,
  type ThemeRegistrationAny,
  type TokensResult,
} from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import {
  bundledLanguageNames,
  bundledLanguages,
  bundledThemes,
} from '@/generated/shikiBundles';

type ThemeInput = string | ThemeRegistrationAny;
type HighlightResult = TokensResult;

type HighlightOptions = {
  code: string;
  language: string;
  themes: [ThemeInput, ThemeInput];
};

export type StreamdownCodeHighlighterPlugin = {
  getSupportedLanguages: () => string[];
  getThemes: () => [ThemeInput, ThemeInput];
  highlight: (
    options: HighlightOptions,
    callback?: (result: HighlightResult) => void,
  ) => HighlightResult | null;
  name: 'shiki';
  supportsLanguage: (language: string) => boolean;
  type: 'code-highlighter';
};

type CodePluginOptions = {
  themes?: [ThemeInput, ThemeInput];
};

const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine({ forgiving: true }),
});

const languageNames = new Set(bundledLanguageNames);
const highlighterCache = new Map<
  string,
  Promise<HighlighterGeneric<string, string>>
>();
const tokensCache = new Map<string, TokensResult>();
const subscribers = new Map<string, Set<(result: TokensResult) => void>>();

const normalizeLanguage = (language: string): string =>
  language.trim().toLowerCase();

const getThemeName = (theme: ThemeInput): string =>
  typeof theme === 'string' ? theme : (theme.name ?? 'custom');

const getHighlighterCacheKey = (
  language: string | SpecialLanguage,
  themes: [ThemeInput, ThemeInput],
) => `${language}-${getThemeName(themes[0])}-${getThemeName(themes[1])}`;

const getTokensCacheKey = (
  code: string,
  language: string,
  themeNames: [string, string],
) => {
  const start = code.slice(0, 100);
  const end = code.length > 100 ? code.slice(-100) : '';
  return `${language}:${themeNames[0]}:${themeNames[1]}:${code.length}:${start}:${end}`;
};

const getHighlighter = (
  language: string | SpecialLanguage,
  themes: [ThemeInput, ThemeInput],
): Promise<HighlighterGeneric<string, string>> => {
  const cacheKey = getHighlighterCacheKey(language, themes);
  const cached = highlighterCache.get(cacheKey);
  if (cached) return cached;

  const highlighterPromise = createHighlighter({
    themes,
    langs: language === 'text' ? [] : [language],
  });
  highlighterCache.set(cacheKey, highlighterPromise);
  return highlighterPromise;
};

export function createStreamdownCodePlugin(
  options: CodePluginOptions = {},
): StreamdownCodeHighlighterPlugin {
  const defaultThemes: [ThemeInput, ThemeInput] = options.themes ?? [
    'github-light',
    'github-dark',
  ];

  return {
    name: 'shiki',
    type: 'code-highlighter',

    supportsLanguage(language) {
      return languageNames.has(normalizeLanguage(language));
    },

    getSupportedLanguages() {
      return [...bundledLanguageNames];
    },

    getThemes() {
      return defaultThemes;
    },

    highlight({ code, language, themes }, callback) {
      const resolvedLanguage = normalizeLanguage(language);
      const themeNames: [string, string] = [
        getThemeName(themes[0]),
        getThemeName(themes[1]),
      ];
      const tokensCacheKey = getTokensCacheKey(
        code,
        resolvedLanguage,
        themeNames,
      );

      const cached = tokensCache.get(tokensCacheKey);
      if (cached) return cached;

      if (callback) {
        const callbacks = subscribers.get(tokensCacheKey) ?? new Set();
        callbacks.add(callback);
        subscribers.set(tokensCacheKey, callbacks);
      }

      const safeLanguage: string | SpecialLanguage = languageNames.has(
        resolvedLanguage,
      )
        ? resolvedLanguage
        : 'text';

      getHighlighter(safeLanguage, themes)
        .then((highlighter) => {
          const availableLanguages = highlighter.getLoadedLanguages();
          const languageToUse = availableLanguages.includes(resolvedLanguage)
            ? resolvedLanguage
            : 'text';

          const result = highlighter.codeToTokens(code, {
            lang: languageToUse,
            themes: {
              light: themeNames[0],
              dark: themeNames[1],
            },
          });

          tokensCache.set(tokensCacheKey, result);
          const callbacks = subscribers.get(tokensCacheKey);
          if (callbacks) {
            for (const subscriber of callbacks) subscriber(result);
            subscribers.delete(tokensCacheKey);
          }
        })
        .catch((error) => {
          console.error('[Streamdown Code] Failed to highlight code:', error);
          subscribers.delete(tokensCacheKey);
        });

      return null;
    },
  };
}

export const code = createStreamdownCodePlugin();
