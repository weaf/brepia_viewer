import { Outlet } from '@tanstack/react-router';

export function Layout() {
  return (
    <div className="h-dvh overflow-hidden bg-adam-bg-dark">
      <Outlet />
    </div>
  );
}
