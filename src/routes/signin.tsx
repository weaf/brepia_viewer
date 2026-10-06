import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/signin')({
  component: () => <Navigate to="/" replace />,
});
