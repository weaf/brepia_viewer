export type LifecycleEntry = {
  at: string;
  event: string;
  documentId: string;
  visibilityState: DocumentVisibilityState;
  online: boolean;
  path: string;
  navigationType?: PerformanceNavigationTiming['type'];
  persisted?: boolean;
  wasDiscarded?: boolean;
};

const STORAGE_KEY = 'brepia:lifecycle-log';
const MAX_ENTRIES = 80;

function readEntries(): LifecycleEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as LifecycleEntry[]) : [];
  } catch {
    return [];
  }
}

function writeEntry(entry: LifecycleEntry) {
  try {
    const entries = [...readEntries(), entry].slice(-MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Diagnostics must never affect application behavior.
  }

  console.info('[brepia-lifecycle]', entry);
}

export function startLifecycleDiagnostics(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const documentId = crypto.randomUUID();
  const navigation = performance.getEntriesByType('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  const wasDiscarded =
    (document as Document & { wasDiscarded?: boolean }).wasDiscarded ?? false;

  const log = (
    event: string,
    extras: Pick<LifecycleEntry, 'persisted'> = {},
  ) => {
    writeEntry({
      at: new Date().toISOString(),
      event,
      documentId,
      visibilityState: document.visibilityState,
      online: navigator.onLine,
      path: window.location.pathname,
      navigationType: navigation?.type,
      wasDiscarded,
      ...extras,
    });
  };

  log('boot');

  const onVisibilityChange = () =>
    log(`visibility:${document.visibilityState}`);
  const onFocus = () => log('focus');
  const onBlur = () => log('blur');
  const onOnline = () => log('online');
  const onOffline = () => log('offline');
  const onBeforeUnload = () => log('beforeunload');
  const onPageShow = (event: PageTransitionEvent) =>
    log('pageshow', { persisted: event.persisted });
  const onPageHide = (event: PageTransitionEvent) =>
    log('pagehide', { persisted: event.persisted });
  const onFreeze = () => log('freeze');
  const onResume = () => log('resume');

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('freeze', onFreeze);
  document.addEventListener('resume', onResume);

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('freeze', onFreeze);
    document.removeEventListener('resume', onResume);
  };
}

export function getLifecycleDiagnostics(): LifecycleEntry[] {
  return readEntries();
}

export function clearLifecycleDiagnostics(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Diagnostics must never affect application behavior.
  }
}
