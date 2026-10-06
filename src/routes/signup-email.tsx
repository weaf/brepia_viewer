import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/signup-email')({
  component: () => <Navigate to="/" replace />,
});
