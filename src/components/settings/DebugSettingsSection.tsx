import { useEffect, useMemo, useState } from 'react';
import { Bug, Clipboard, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  clearLifecycleDiagnostics,
  getLifecycleDiagnostics,
  type LifecycleEntry,
} from '@/lib/lifecycleDiagnostics';

const lifecycleDiagnosticsEnabled =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_LIFECYCLE_DEBUG === '1';

function formatTime(value: string) {
  try {
    return new Date(value).toLocaleTimeString();
  } catch {
    return value;
  }
}

function valueLabel(value: unknown) {
  if (value === undefined) return 'unknown';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

export function DebugSettingsSection() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LifecycleEntry[]>([]);
  const [copied, setCopied] = useState(false);

  const refresh = () => setEntries(getLifecycleDiagnostics());

  useEffect(() => {
    if (!open) return;
    refresh();
    const interval = window.setInterval(refresh, 1000);
    return () => window.clearInterval(interval);
  }, [open]);

  const latestBoot = useMemo(
    () => [...entries].reverse().find((entry) => entry.event === 'boot'),
    [entries],
  );
  const latest = entries.at(-1);

  const copyLog = async () => {
    const payload = JSON.stringify(entries, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const clearLog = () => {
    clearLifecycleDiagnostics();
    setEntries([]);
  };

  if (!lifecycleDiagnosticsEnabled) return null;

  return (
    <section className="rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-6">
      <h2 className="mb-5 text-sm font-medium text-adam-neutral-50">Debug</h2>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-adam-neutral-50">Page lifecycle</div>
          <div className="mt-0.5 text-xs leading-relaxed text-adam-neutral-200">
            Inspect browser reload, freeze, resume, and discard behavior while
            testing Brepia on desktop and mobile browsers.
          </div>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="dark"
              className="flex-shrink-0 gap-2 rounded-full font-light"
            >
              <Bug className="h-4 w-4" />
              Open
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[88dvh] w-[calc(100vw-2rem)] max-w-2xl overflow-hidden rounded-2xl bg-adam-background-2 p-0 sm:w-full">
            <div className="flex max-h-[88dvh] min-h-0 flex-col">
              <DialogHeader className="border-b border-adam-neutral-800 px-5 py-4 text-left">
                <DialogTitle className="text-adam-neutral-50">
                  Page lifecycle diagnostics
                </DialogTitle>
                <DialogDescription className="text-adam-neutral-200">
                  Stored locally so the history survives an actual browser
                  reload or discarded tab.
                </DialogDescription>
              </DialogHeader>

              <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 py-4">
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <DiagnosticValue
                    label="Navigation"
                    value={valueLabel(latestBoot?.navigationType)}
                  />
                  <DiagnosticValue
                    label="Discarded"
                    value={valueLabel(latestBoot?.wasDiscarded)}
                    emphasize={latestBoot?.wasDiscarded === true}
                  />
                  <DiagnosticValue
                    label="Visibility"
                    value={latest?.visibilityState ?? 'unknown'}
                  />
                  <DiagnosticValue
                    label="Online"
                    value={valueLabel(latest?.online)}
                  />
                  <DiagnosticValue
                    label="Document"
                    value={latestBoot?.documentId.slice(0, 8) ?? 'unknown'}
                  />
                  <DiagnosticValue
                    label="Entries"
                    value={String(entries.length)}
                  />
                </div>

                <div className="mt-4 overflow-hidden rounded-xl border border-adam-neutral-800 bg-adam-background-1">
                  <div className="border-b border-adam-neutral-800 px-3 py-2 text-xs font-medium text-adam-neutral-100">
                    Recent lifecycle events
                  </div>
                  {entries.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-adam-neutral-300">
                      No lifecycle events recorded yet.
                    </div>
                  ) : (
                    <div className="font-mono text-[11px] leading-5">
                      {entries
                        .slice()
                        .reverse()
                        .map((entry, index) => (
                          <div
                            key={`${entry.documentId}-${entry.at}-${index}`}
                            className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 border-b border-adam-neutral-800/70 px-3 py-1.5 last:border-b-0"
                          >
                            <span className="text-adam-neutral-300">
                              {formatTime(entry.at)}
                            </span>
                            <span className="min-w-0 break-words text-adam-neutral-100">
                              {entry.event}
                              {entry.persisted !== undefined
                                ? ` persisted=${valueLabel(entry.persisted)}`
                                : ''}
                              {entry.event === 'boot'
                                ? ` nav=${valueLabel(entry.navigationType)} discarded=${valueLabel(entry.wasDiscarded)} doc=${entry.documentId.slice(0, 8)}`
                                : ''}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-adam-neutral-800 px-5 py-4">
                <Button
                  type="button"
                  variant="dark"
                  className="gap-2 rounded-full font-light"
                  onClick={refresh}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
                <Button
                  type="button"
                  variant="dark"
                  className="gap-2 rounded-full font-light"
                  onClick={clearLog}
                >
                  <Trash2 className="h-4 w-4" />
                  Clear
                </Button>
                <Button
                  type="button"
                  variant="light"
                  className="gap-2 rounded-full font-light"
                  disabled={entries.length === 0}
                  onClick={() => void copyLog()}
                >
                  <Clipboard className="h-4 w-4" />
                  {copied ? 'Copied' : 'Copy log'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}

function DiagnosticValue({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-lg border border-adam-neutral-800 bg-adam-background-1 px-3 py-2">
      <div className="text-adam-neutral-300">{label}</div>
      <div
        className={
          emphasize
            ? 'mt-0.5 truncate font-medium text-red-400'
            : 'mt-0.5 truncate font-medium text-adam-neutral-50'
        }
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
