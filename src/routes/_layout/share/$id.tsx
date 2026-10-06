import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/_layout/share/$id')({
  component: () => <Navigate to="/" replace />,
});
