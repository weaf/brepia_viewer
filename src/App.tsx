import { AppearanceProvider } from '@/contexts/AppearanceContext';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster } from './components/ui/toaster';
import { Outlet } from '@tanstack/react-router';
import { ErrorView } from '@/views/ErrorView';
import { startLifecycleDiagnostics } from '@/lib/lifecycleDiagnostics';
import { useEffect } from 'react';

const lifecycleDiagnosticsEnabled =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_LIFECYCLE_DEBUG === '1';

function App({ error }: { error?: unknown }) {
  useEffect(() => {
    if (!lifecycleDiagnosticsEnabled) return;
    return startLifecycleDiagnostics();
  }, []);

  return (
    <AppearanceProvider>
      <TooltipProvider delayDuration={0}>
        <Toaster />
        {error !== undefined ? <ErrorView error={error} /> : <Outlet />}
      </TooltipProvider>
    </AppearanceProvider>
  );
}

export default App;
