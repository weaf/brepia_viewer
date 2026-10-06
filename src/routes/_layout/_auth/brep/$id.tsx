import { createFileRoute } from '@tanstack/react-router';
import BrepProjectView from '@/views/BrepProjectView';

export const Route = createFileRoute('/_layout/_auth/brep/$id')({
  component: BrepProjectView,
});
