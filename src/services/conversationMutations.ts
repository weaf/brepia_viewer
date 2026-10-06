import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Conversation, ConversationSettings } from '@shared/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';

type NonNullConversationSettings = Exclude<ConversationSettings, null>;

export type ConversationPatch = {
  title?: Conversation['title'];
  privacy?: Conversation['privacy'];
  settings?: Partial<NonNullConversationSettings>;
};

export type ConversationPatchRequest = {
  id: string;
  patch: ConversationPatch;
};

export type ConversationLeafRequest = {
  id: string;
  leafId: string | null;
};

type ConversationMetadataResult = Pick<
  Conversation,
  'id' | 'title' | 'privacy' | 'settings'
>;

type ConversationMetadataRpcBuilder = {
  select(columns: string): {
    single(): PromiseLike<{
      data: ConversationMetadataResult | null;
      error: { message: string } | null;
    }>;
  };
};

/**
 * shared/database.ts is generated and must not be hand-edited. B1.1 adds the
 * schema-first RPC below, so keep this one narrow local signature until the
 * normal generated-type refresh includes the new function.
 */
const conversationMetadataRpc = supabase as unknown as {
  rpc(
    fn: 'patch_conversation_metadata',
    args: {
      p_conversation_id: string;
      p_title: Conversation['title'] | null;
      p_privacy: Conversation['privacy'] | null;
      p_settings_patch: Partial<NonNullConversationSettings>;
    },
  ): ConversationMetadataRpcBuilder;
};

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function applyConversationPatch(
  conversation: Conversation,
  patch: ConversationPatch,
): Conversation {
  const next: Conversation = { ...conversation };

  if (hasOwn(patch, 'title') && patch.title !== undefined) {
    next.title = patch.title;
  }
  if (hasOwn(patch, 'privacy') && patch.privacy !== undefined) {
    next.privacy = patch.privacy;
  }
  if (patch.settings) {
    next.settings = {
      ...(conversation.settings ?? {}),
      ...patch.settings,
    };
  }

  return next;
}

export function restoreConversationPatch(
  current: Conversation,
  previous: Conversation,
  patch: ConversationPatch,
): Conversation {
  const next: Conversation = { ...current };

  if (hasOwn(patch, 'title')) {
    next.title = previous.title;
  }
  if (hasOwn(patch, 'privacy')) {
    next.privacy = previous.privacy;
  }
  if (patch.settings) {
    const restoredSettings: NonNullConversationSettings = {
      ...(current.settings ?? {}),
    };
    for (const key of Object.keys(
      patch.settings,
    ) as (keyof NonNullConversationSettings)[]) {
      if (previous.settings && hasOwn(previous.settings, key)) {
        Object.assign(restoredSettings, { [key]: previous.settings[key] });
      } else {
        delete restoredSettings[key];
      }
    }
    next.settings = restoredSettings;
  }

  return next;
}

function settingsPatchFromPersisted(
  settings: ConversationSettings,
  requested: Partial<NonNullConversationSettings>,
): Partial<NonNullConversationSettings> {
  const selected: Partial<NonNullConversationSettings> = {};
  for (const key of Object.keys(
    requested,
  ) as (keyof NonNullConversationSettings)[]) {
    if (settings && hasOwn(settings, key)) {
      Object.assign(selected, { [key]: settings[key] });
    }
  }
  return selected;
}

export function useConversationMutations() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const patchMutation = useMutation({
    mutationFn: async ({ id, patch }: ConversationPatchRequest) => {
      if (!user?.id) {
        throw new Error('User must be authenticated');
      }

      const { data, error } = await conversationMetadataRpc
        .rpc('patch_conversation_metadata', {
          p_conversation_id: id,
          p_title:
            hasOwn(patch, 'title') && patch.title !== undefined
              ? patch.title
              : null,
          p_privacy:
            hasOwn(patch, 'privacy') && patch.privacy !== undefined
              ? patch.privacy
              : null,
          p_settings_patch: patch.settings ?? {},
        })
        .select('id, title, privacy, settings')
        .single();

      if (error) throw error;
      if (!data) {
        throw new Error('Conversation metadata patch matched no conversation.');
      }

      const persistedPatch: ConversationPatch = {};
      if (hasOwn(patch, 'title')) persistedPatch.title = data.title;
      if (hasOwn(patch, 'privacy')) persistedPatch.privacy = data.privacy;
      if (patch.settings) {
        persistedPatch.settings = settingsPatchFromPersisted(
          data.settings,
          patch.settings,
        );
      }

      return { id, patch: persistedPatch };
    },
    onMutate: ({ id, patch }) => {
      const previous = queryClient.getQueryData<Conversation>([
        'conversation',
        id,
      ]);
      queryClient.setQueryData<Conversation>(['conversation', id], (current) =>
        current ? applyConversationPatch(current, patch) : current,
      );
      return { previous };
    },
    onSuccess: ({ id, patch }) => {
      queryClient.setQueryData<Conversation>(['conversation', id], (current) =>
        current ? applyConversationPatch(current, patch) : current,
      );
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (_error, { id, patch }, context) => {
      if (!context?.previous) return;
      const previous = context.previous;
      queryClient.setQueryData<Conversation>(['conversation', id], (current) =>
        current ? restoreConversationPatch(current, previous, patch) : current,
      );
    },
  });

  const leafMutation = useMutation({
    mutationFn: async ({ id, leafId }: ConversationLeafRequest) => {
      if (!user?.id) {
        throw new Error('User must be authenticated');
      }

      const { data, error } = await supabase
        .from('conversations')
        .update({ current_message_leaf_id: leafId })
        .eq('id', id)
        .eq('user_id', user.id)
        .select('current_message_leaf_id')
        .single()
        .overrideTypes<Pick<Conversation, 'current_message_leaf_id'>>();

      if (error) throw error;
      return { id, leafId: data.current_message_leaf_id };
    },
    onMutate: ({ id, leafId }) => {
      const previousLeaf =
        queryClient.getQueryData<Conversation>(['conversation', id])
          ?.current_message_leaf_id ?? null;
      queryClient.setQueryData<Conversation>(['conversation', id], (current) =>
        current ? { ...current, current_message_leaf_id: leafId } : current,
      );
      return { previousLeaf };
    },
    onSuccess: ({ id, leafId }) => {
      queryClient.setQueryData<Conversation>(['conversation', id], (current) =>
        current ? { ...current, current_message_leaf_id: leafId } : current,
      );
    },
    onError: (_error, { id }, context) => {
      queryClient.setQueryData<Conversation>(['conversation', id], (current) =>
        current
          ? {
              ...current,
              current_message_leaf_id: context?.previousLeaf ?? null,
            }
          : current,
      );
    },
  });

  return {
    updateConversation: patchMutation.mutate,
    updateConversationAsync: patchMutation.mutateAsync,
    setConversationLeaf: leafMutation.mutate,
    setConversationLeafAsync: leafMutation.mutateAsync,
  };
}
