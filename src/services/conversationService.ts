import { useAuth } from '@/contexts/AuthContext';
import { Conversation } from '@shared/types';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useConversationMutations } from './conversationMutations';

const defaultConversation: Conversation = {
  id: '',
  title: '',
  current_message_leaf_id: null,
  user_id: '',
  created_at: '',
  updated_at: '',
  privacy: 'private',
  type: 'parametric',
  settings: null,
};

export function useConversation() {
  const { id: conversationId } = useParams({
    from: '/_layout/_auth/editor/$id',
  });
  const { user } = useAuth();

  const { data: conversation, isLoading: isConversationLoading } =
    useQuery<Conversation>({
      queryKey: ['conversation', conversationId],
      enabled: !!conversationId,
      refetchOnMount: false,
      queryFn: async () => {
        if (!conversationId) {
          throw new Error('Conversation ID is required');
        }
        if (!user?.id) {
          throw new Error('User must be authenticated');
        }

        const { data, error } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', conversationId)
          .eq('user_id', user.id)
          .limit(1)
          .single()
          .overrideTypes<Conversation>();

        if (error) {
          throw error;
        }
        return data as Conversation;
      },
    });

  const {
    updateConversation,
    updateConversationAsync,
    setConversationLeafAsync,
  } = useConversationMutations();

  return {
    conversation: conversation ?? defaultConversation,
    isConversationLoading,
    updateConversation,
    updateConversationAsync,
    setConversationLeafAsync,
  };
}
