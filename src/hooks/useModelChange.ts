import { useConversation } from '@/contexts/ConversationContext';
import { Model } from '@shared/types';

export function useModelChange() {
  const { conversation, updateConversation } = useConversation();

  const handleModelChange = (model: Model) => {
    if (!updateConversation) return;
    updateConversation({
      id: conversation.id,
      patch: { settings: { model } },
    });
  };

  return handleModelChange;
}
