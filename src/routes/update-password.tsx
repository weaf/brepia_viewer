import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/update-password')({
  component: () => <Navigate to="/" replace />,
});
