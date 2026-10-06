import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/reset-password')({
  component: () => <Navigate to="/" replace />,
});
