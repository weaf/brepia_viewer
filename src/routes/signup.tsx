import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/signup')({
  component: () => <Navigate to="/" replace />,
});
