import { createFileRoute } from '@tanstack/react-router';
import ProjectRouteView from '@/views/ProjectRouteView';

export const Route = createFileRoute('/_layout/_auth/project/$id')({
  component: ProjectRouteView,
});
