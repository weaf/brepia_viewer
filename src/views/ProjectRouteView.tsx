import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ActivityIndicator } from '@/components/brand';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { getBrepProjectArtifact } from '@shared/brepProjectArtifact';
import type { Conversation } from '@shared/types';

/** Routes a persisted project by its explicit source kind or source artifact. */
export default function ProjectRouteView() {
  const { id } = useParams({ from: '/_layout/_auth/project/$id' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: isBrep, error } = useQuery({
    queryKey: ['project-route', id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .select('current_message_leaf_id, settings')
        .eq('id', id)
        .eq('user_id', user?.id ?? '')
        .single()
        .overrideTypes<Pick<Conversation, 'current_message_leaf_id' | 'settings'>>();
      if (conversationError) throw conversationError;

      // A freshly created native BRep has a persisted user leaf before the
      // first canonical assistant artifact exists. Route by the explicit
      // product source kind so pending creations open their BRep progress view
      // instead of falling through to the OpenSCAD editor.
      if (conversation.settings?.parametricSourceKind === 'brep') return true;

      if (!conversation.current_message_leaf_id) return false;
      const { data: message, error: messageError } = await supabase
        .from('messages')
        .select('parts')
        .eq('id', conversation.current_message_leaf_id)
        .eq('conversation_id', id)
        .eq('role', 'assistant')
        .maybeSingle();
      if (messageError) throw messageError;
      return !!message && !!getBrepProjectArtifact(message.parts);
    },
  });

  useEffect(() => {
    if (isBrep === undefined) return;
    void navigate({
      to: isBrep ? '/brep/$id' : '/editor/$id',
      params: { id },
      replace: true,
    });
  }, [id, isBrep, navigate]);

  if (error) {
    return (
      <main className="p-6 text-destructive">
        {error instanceof Error ? error.message : 'Project not found.'}
      </main>
    );
  }
  return (
    <div className="flex h-full items-center justify-center">
      <ActivityIndicator label="Opening project" showLabel />
    </div>
  );
}
