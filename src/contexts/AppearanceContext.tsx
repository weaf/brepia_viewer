import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export const APPEARANCE_STORAGE_KEY = 'brepia-appearance';

export type AppearancePreference = 'system' | 'light' | 'dark';
export type ResolvedAppearance = 'light' | 'dark';

type AppearanceContextValue = {
  appearance: AppearancePreference;
  resolvedAppearance: ResolvedAppearance;
  setAppearance: (appearance: AppearancePreference) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function isAppearancePreference(
  value: string | null,
): value is AppearancePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readStoredAppearance(): AppearancePreference {
  if (typeof window === 'undefined') return 'dark';

  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearancePreference(stored) ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): ResolvedAppearance {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }

  return preference;
}

function applyResolvedAppearance(
  preference: AppearancePreference,
  resolved: ResolvedAppearance,
) {
  const root = document.documentElement;
  root.dataset.appearance = preference;
  root.dataset.theme = resolved;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;

  const themeColor = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (themeColor) {
    themeColor.content = resolved === 'dark' ? '#191A1A' : '#F6F6F6';
  }
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  // Keep the server render and the first client render identical. The inline
  // bootstrap in __root.tsx already paints the stored theme before CSS loads;
  // the provider reconciles its React state after hydration.
  const [appearance, setAppearanceState] =
    useState<AppearancePreference>('dark');
  const [resolvedAppearance, setResolvedAppearance] =
    useState<ResolvedAppearance>('dark');
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setAppearanceState(readStoredAppearance());
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const syncAppearance = () => {
      const resolved = resolveAppearance(appearance, mediaQuery.matches);
      setResolvedAppearance(resolved);
      applyResolvedAppearance(appearance, resolved);
    };

    syncAppearance();

    if (appearance !== 'system') return;

    mediaQuery.addEventListener('change', syncAppearance);
    return () => mediaQuery.removeEventListener('change', syncAppearance);
  }, [appearance, initialized]);

  const setAppearance = useCallback((nextAppearance: AppearancePreference) => {
    setInitialized(true);
    setAppearanceState(nextAppearance);

    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, nextAppearance);
    } catch {
      // Appearance still applies for the current session when storage is blocked.
    }
  }, []);

  const value = useMemo(
    () => ({ appearance, resolvedAppearance, setAppearance }),
    [appearance, resolvedAppearance, setAppearance],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const context = useContext(AppearanceContext);

  if (!context) {
    throw new Error('useAppearance must be used within an AppearanceProvider');
  }

  return context;
}
