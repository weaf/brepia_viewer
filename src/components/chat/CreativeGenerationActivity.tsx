import { ActivityIndicator } from '@/components/brand';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

export function CreativeGenerationActivity({
  conversationId,
}: {
  conversationId: string;
}) {
  const { data: pendingMeshCount = 0 } = useQuery({
    queryKey: ['creative-generation-activity', conversationId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('meshes')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('status', 'pending');

      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 2500,
    refetchOnWindowFocus: true,
  });

  if (pendingMeshCount === 0) return null;

  return (
    <div className="flex w-full justify-start pl-11">
      <div className="w-fit rounded-full border border-adam-neutral-700 bg-adam-neutral-900/70 px-2.5 py-1 text-xs text-adam-text-secondary">
        <ActivityIndicator
          label={
            pendingMeshCount === 1
              ? 'Generating 3D model'
              : `Generating ${pendingMeshCount} 3D models`
          }
          showLabel
          size="sm"
        />
      </div>
    </div>
  );
}
