import { createFileRoute } from '@tanstack/react-router';
import { BrepModelLibrary } from '@/components/brep/BrepModelLibrary';

export const Route = createFileRoute('/_layout/_auth/brep/')({
  component: BrepModelLibrary,
});
