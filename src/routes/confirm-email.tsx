import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/confirm-email')({
  component: () => <Navigate to="/" replace />,
});
