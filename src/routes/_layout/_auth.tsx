import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/_layout/_auth')({
  component: () => <Navigate to="/" replace />,
});
