import { AppearanceProvider } from "@/contexts/AppearanceContext";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/toaster";
import { Outlet } from "@tanstack/react-router";
import { ErrorView } from "@/views/ErrorView";
function App({ error }: { error?: unknown }) {
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
