import type { Conversation } from '@shared/types';
import type {
  ConversationLeafRequest,
  ConversationPatchRequest,
} from '@/services/conversationMutations';
import {
  UseMutateAsyncFunction,
  UseMutateFunction,
} from '@tanstack/react-query';
import { createContext, useContext } from 'react';

type ConversationContextType = {
  conversation: Conversation;
  updateConversation?: UseMutateFunction<
    unknown,
    Error,
    ConversationPatchRequest
  >;
  updateConversationAsync?: UseMutateAsyncFunction<
    unknown,
    Error,
    ConversationPatchRequest
  >;
  setConversationLeafAsync?: UseMutateAsyncFunction<
    unknown,
    Error,
    ConversationLeafRequest
  >;
};

export const ConversationContext = createContext<ConversationContextType>({
  conversation: {
    id: '',
    title: '',
    type: 'parametric',
    privacy: 'private',
    current_message_leaf_id: null,
    user_id: '',
    created_at: '',
    updated_at: '',
    settings: null,
  },
  updateConversation: undefined,
  updateConversationAsync: undefined,
  setConversationLeafAsync: undefined,
});

export const useConversation = () => {
  const context = useContext(ConversationContext);
  if (!context) {
    throw new Error(
      'useConversation must be used within a ConversationProvider',
    );
  }
  return context;
};
