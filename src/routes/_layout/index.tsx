import { createFileRoute } from '@tanstack/react-router';
import { ModelGalleryView } from '@/views/ModelGalleryView';

export const Route = createFileRoute('/_layout/')({
  component: ModelGalleryView,
});
