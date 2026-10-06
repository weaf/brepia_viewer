import { MessageBubble } from '@/components/chat/MessageBubble';
import { BrepIterationModelCard } from '@/components/brep/BrepIterationModelCard';
import { useBrepFeatureWorkspace } from '@/components/brep/BrepFeatureWorkspace';
import { SuggestionPills } from '@/components/chat/SuggestionPills';
import TextAreaChat from '@/components/TextAreaChat';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CONNECTION_INTERRUPTED_MESSAGE,
  userFacingChatError,
} from '@/hooks/chatErrorPresentation';
import { useCachedAiChat } from '@/hooks/useCachedAiChat';
import { useToast } from '@/hooks/use-toast';
import { apiUrl } from '@/services/api';
import {
  messageRowToChatMessage,
  type ChatMessage,
} from '@/lib/aiMessages';
import {
  getLatestBrepGenerationRun,
  useLatestBrepGenerationRun,
} from '@/services/generationRunService';
import { shouldPollForPendingAssistant } from '@/services/messageService';
import { supabase } from '@/lib/supabase';
import { getBrepProjectArtifact } from '@shared/brepProjectArtifact';
import type {
  AppUIMessage,
  ConversationSuggestionsUpdate,
  ConversationTitleUpdate,
} from '@shared/chatAi';
import {
  isGenerationRunAiEditing,
  isGenerationRunTerminal,
} from '@shared/generationRun';
import Tree from '@shared/Tree';
import type { Conversation, Message, Model } from '@shared/types';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useQueryClient } from '@tanstack/react-query';
import posthog from 'posthog-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface BrepChatSessionProps {
  conversation: Conversation;
  dbMessages: Message[];
  initialBranch: AppUIMessage[];
  model: Model;
  setModel: (model: Model) => void;
  executionMode?: 'cli' | 'streaming';
  onExecutionModeChange?: (mode: 'cli' | 'streaming') => void;
  onSendParts: (
    parts: AppUIMessage['parts'],
  ) => Promise<{ userMessageId: string }>;
  onRetry: (assistant: ChatMessage) => Promise<void>;
  onEdit: (
    original: ChatMessage,
    parts: AppUIMessage['parts'],
  ) => Promise<{ newUserMessageId: string; parentPath: AppUIMessage[] }>;
  onRestore: (assistant: ChatMessage) => Promise<{ newBranch: AppUIMessage[] }>;
  onSelectLeaf: (messageId: string) => Promise<void>;
  branchForLeaf: (leafId: string) => AppUIMessage[];
  onChangeRating: (messageId: string, rating: number) => void;
  onViewRevision: (messageId: string) => void;
  displayedRevisionId: string;
  activeRevisionId: string;
  onLoadingChange?: (isLoading: boolean) => void;
}

type PersistedBrepAttempt = {
  requestMessageId: string;
  baselineRunId: string | null;
  model: Model;
  createdAt: number;
};

const BREP_ATTEMPT_MAX_AGE_MS = 10 * 60_000;

function attemptStorageKey(conversationId: string): string {
  return `brepia:brep-generation-attempt:${conversationId}`;
}

function readPersistedAttempt(
  conversationId: string,
): PersistedBrepAttempt | null {
  if (typeof window === 'undefined') return null;
  const key = attemptStorageKey(conversationId);
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedBrepAttempt>;
    if (
      typeof parsed.requestMessageId !== 'string' ||
      typeof parsed.model !== 'string' ||
      typeof parsed.createdAt !== 'number' ||
      Date.now() - parsed.createdAt >= BREP_ATTEMPT_MAX_AGE_MS
    ) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return {
      requestMessageId: parsed.requestMessageId,
      baselineRunId:
        typeof parsed.baselineRunId === 'string' ? parsed.baselineRunId : null,
      model: parsed.model,
      createdAt: parsed.createdAt,
    };
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

/**
 * BRep product chat reuses the ordinary AI-SDK conversation lifecycle while
 * deliberately omitting the OpenSCAD client-tool compiler path owned by
 * ChatSession. Native BRep tools execute and validate on the server, so the
 * browser never compiles geometry, supplies tool output, or auto-continues a
 * build tool call.
 */
export function BrepChatSession({
  conversation,
  dbMessages,
  initialBranch,
  model,
  setModel,
  executionMode = 'cli',
  onExecutionModeChange,
  onSendParts,
  onRetry,
  onEdit,
  onRestore,
  onSelectLeaf,
  branchForLeaf,
  onChangeRating,
  onViewRevision,
  displayedRevisionId,
  activeRevisionId,
  onLoadingChange,
}: BrepChatSessionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { setView } = useBrepFeatureWorkspace();
  // /editor and /brep can address the same persisted conversation, but their
  // chat runtimes have different client-tool semantics. Keep the cached Chat
  // instances separate so a previously mounted OpenSCAD editor cannot leak
  // auto-continuation/callback state into the native BRep workspace.
  const chatCacheId = `brep:${conversation.id}`;
  const submitInFlightRef = useRef(false);
  const [persistedAttempt, setPersistedAttempt] =
    useState<PersistedBrepAttempt | null>(() =>
      readPersistedAttempt(conversation.id),
    );

  const persistAttempt = useCallback(
    (attempt: Omit<PersistedBrepAttempt, 'createdAt'>) => {
      const next = { ...attempt, createdAt: Date.now() };
      setPersistedAttempt(next);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(
          attemptStorageKey(conversation.id),
          JSON.stringify(next),
        );
      }
    },
    [conversation.id],
  );

  const clearPersistedAttempt = useCallback(() => {
    setPersistedAttempt(null);
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(attemptStorageKey(conversation.id));
    }
  }, [conversation.id]);

  const currentLeafMessage = useMemo(
    () =>
      dbMessages.find(
        (message) => message.id === conversation.current_message_leaf_id,
      ),
    [conversation.current_message_leaf_id, dbMessages],
  );
  const inferredPendingRequestMessageId =
    currentLeafMessage?.role === 'user' &&
    shouldPollForPendingAssistant([currentLeafMessage])
      ? currentLeafMessage.id
      : undefined;
  const trackedRequestMessageId =
    persistedAttempt?.requestMessageId ?? inferredPendingRequestMessageId;
  const trackedBaselineRunId =
    persistedAttempt?.requestMessageId === trackedRequestMessageId
      ? persistedAttempt?.baselineRunId
      : undefined;
  const { data: durableGenerationRun } = useLatestBrepGenerationRun({
    conversationId: conversation.id,
    requestMessageId: trackedRequestMessageId,
    baselineRunId: trackedBaselineRunId,
    pollWhenMissing: Boolean(trackedRequestMessageId),
  });
  const durableGenerationActive = Boolean(
    durableGenerationRun && !isGenerationRunTerminal(durableGenerationRun.status),
  );
  const durableSourceEditing = Boolean(
    durableGenerationRun && isGenerationRunAiEditing(durableGenerationRun),
  );
  const durableHandoffPending = Boolean(
    trackedRequestMessageId && !durableGenerationRun,
  );
  const displayedModel =
    (durableGenerationActive ? durableGenerationRun?.requestedModelId : undefined) ??
    (durableHandoffPending ? persistedAttempt?.model : undefined) ??
    model;

  useEffect(() => {
    if (!persistedAttempt || !durableGenerationRun) return;
    if (
      !persistedAttempt.baselineRunId ||
      durableGenerationRun.id !== persistedAttempt.baselineRunId
    ) {
      clearPersistedAttempt();
    }
  }, [clearPersistedAttempt, durableGenerationRun, persistedAttempt]);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AppUIMessage>({
        api: apiUrl('parametric-chat'),
        headers: authHeaders,
        prepareSendMessagesRequest: ({ body }) => ({
          body: {
            conversationId: conversation.id,
            model,
            openCodeExecutionMode: executionMode,
            ...(body ?? {}),
          },
        }),
      }),
    [authHeaders, conversation.id, executionMode, model],
  );

  const chat = useCachedAiChat({
    id: chatCacheId,
    messages: initialBranch,
    transport,
    // BRep build/answer tools are server-executed. Client continuation here
    // would re-enter the same external session and recreate the 3F loop bug.
    sendAutomaticallyWhen: () => false,
    onData: (part) => {
      if (part.type === 'data-title-update') {
        const { title } = part.data as ConversationTitleUpdate;
        queryClient.setQueryData(
          ['conversation', conversation.id],
          (old: Conversation | undefined) => (old ? { ...old, title } : old),
        );
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        return;
      }
      if (part.type === 'data-suggestions-update') {
        const { suggestions } = part.data as ConversationSuggestionsUpdate;
        queryClient.setQueryData(
          ['conversation', conversation.id],
          (old: Conversation | undefined) =>
            old
              ? {
                  ...old,
                  settings: {
                    ...(old.settings && typeof old.settings === 'object'
                      ? old.settings
                      : {}),
                    suggestions,
                  },
                }
              : old,
        );
      }
    },
    onFinish: () => {
      // Native BRep persistence advances current_message_leaf_id atomically on
      // the server. Do not point the client cache at the streamed assistant id
      // before the persisted message snapshot has arrived; doing so creates a
      // transient branch with a leaf that the messages cache cannot resolve.
      queryClient.invalidateQueries({
        queryKey: ['messages', conversation.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['conversation', conversation.id],
      });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (error) => {
      console.error('[brep-chat]', error);
      const message = error instanceof Error ? error.message : String(error);
      toast({
        title: 'Brepia ran into a problem',
        description: message || 'The BRep model call failed. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const {
    messages,
    status,
    error: chatError,
    stop,
    sendMessage,
    regenerate,
    setMessages,
  } = useChat<AppUIMessage>({ chat });

  const stopGeneration = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const response = await fetch(apiUrl('parametric-chat'), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel',
          conversationId: conversation.id,
        }),
      });
      if (!response.ok) {
        throw new Error(`Cancel request failed with HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('[brep-chat-cancel]', error);
      toast({
        title: 'Could not stop generation',
        description: 'The server may still be completing this response.',
        variant: 'destructive',
      });
    } finally {
      stop();
    }
  }, [authHeaders, conversation.id, stop, toast]);

  const isRecoveringInterruptedTurn =
    status === 'error' &&
    !!chatError &&
    userFacingChatError(chatError).message === CONNECTION_INTERRUPTED_MESSAGE &&
    shouldPollForPendingAssistant(dbMessages);
  const sdkLoading =
    status === 'submitted' ||
    status === 'streaming' ||
    isRecoveringInterruptedTurn;
  const isLoading =
    sdkLoading || durableGenerationActive || durableHandoffPending;

  useEffect(() => {
    // The chat can remain visibly busy through native evaluation after the new
    // immutable revision is saved. Only source-owning phases should keep the
    // project editor locked; revision_saved deliberately releases that lock.
    onLoadingChange?.(
      sdkLoading || durableSourceEditing || durableHandoffPending,
    );
  }, [
    durableHandoffPending,
    durableSourceEditing,
    onLoadingChange,
    sdkLoading,
  ]);

  const treeMessages = useMemo(() => {
    const byId = new Map<string, ChatMessage>();
    for (const row of dbMessages) {
      byId.set(row.id, messageRowToChatMessage(row));
    }
    for (let i = 0; i < messages.length; i += 1) {
      const live = messages[i];
      const existing = byId.get(live.id);
      if (existing) {
        byId.set(live.id, {
          ...existing,
          parts: live.parts,
          metadata: live.metadata,
        });
      } else {
        const parent = i === 0 ? null : messages[i - 1].id;
        byId.set(live.id, {
          ...live,
          parent_message_id: parent,
          conversation_id: conversation.id,
        });
      }
    }
    return Array.from(byId.values());
  }, [conversation.id, dbMessages, messages]);

  const messageTree = useMemo(() => new Tree(treeMessages), [treeMessages]);
  const branchNodes = useMemo(
    () =>
      messages
        .map((message) => messageTree.allNodes.get(message.id))
        .filter((node): node is NonNullable<typeof node> => !!node),
    [messageTree, messages],
  );

  const handleSend = useCallback(
    async (parts: AppUIMessage['parts']) => {
      if (parts.some((part) => part.type === 'data-mesh-context')) {
        toast({
          title: 'STL attachments are OpenSCAD-only',
          description:
            'Native BRep editing currently accepts text and image context, not mesh assets.',
        });
        return;
      }
      // TextAreaChat can dispatch again before the SDK status flips to
      // submitted. A native BRep turn is CAS-persisted against one exact leaf,
      // so duplicate sends from the same UI action would intentionally make
      // one result stale. Close that small client-side window synchronously.
      if (submitInFlightRef.current) return;
      submitInFlightRef.current = true;

      try {
        const text = parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('');
        const imageCount = parts.filter(
          (part) => part.type === 'file' && part.mediaType.startsWith('image/'),
        ).length;
        posthog.capture('message_sent', {
          type: conversation.type,
          source_kind: 'brep',
          model_name: model,
          text,
          image_count: imageCount,
          mesh_count: 0,
          conversation_id: conversation.id,
        });

        const { userMessageId } = await onSendParts(parts);
        persistAttempt({
          requestMessageId: userMessageId,
          baselineRunId: null,
          model,
        });
        await sendMessage(
          { id: userMessageId, parts, metadata: { model } },
          { body: { model } },
        );
      } finally {
        submitInFlightRef.current = false;
      }
    },
    [
      conversation.id,
      conversation.type,
      model,
      onSendParts,
      persistAttempt,
      sendMessage,
      toast,
    ],
  );

  const handleEditUserText = useCallback(
    async (original: ChatMessage, text: string) => {
      const parts: AppUIMessage['parts'] = [{ type: 'text', text }];
      const { newUserMessageId, parentPath } = await onEdit(original, parts);
      persistAttempt({
        requestMessageId: newUserMessageId,
        baselineRunId: null,
        model,
      });
      setMessages(parentPath);
      await sendMessage(
        { id: newUserMessageId, parts, metadata: { model } },
        { body: { model } },
      );
    },
    [model, onEdit, persistAttempt, sendMessage, setMessages],
  );

  const handleRetry = useCallback(
    async (assistant: ChatMessage, nextModel: Model) => {
      const requestMessageId = assistant.parent_message_id;
      if (nextModel !== model) setModel(nextModel);
      if (requestMessageId) {
        const baselineRun = await getLatestBrepGenerationRun({
          conversationId: conversation.id,
          requestMessageId,
        });
        persistAttempt({
          requestMessageId,
          baselineRunId: baselineRun?.id ?? null,
          model: nextModel,
        });
      }
      await onRetry(assistant);
      await regenerate({ messageId: assistant.id, body: { model: nextModel } });
    },
    [
      conversation.id,
      model,
      onRetry,
      persistAttempt,
      regenerate,
      setModel,
    ],
  );

  const handleRestore = useCallback(
    async (assistant: ChatMessage) => {
      const { newBranch } = await onRestore(assistant);
      setMessages(newBranch);
    },
    [onRestore, setMessages],
  );

  const handleSelectLeaf = useCallback(
    async (messageId: string) => {
      await onSelectLeaf(messageId);
      setMessages(branchForLeaf(messageId));
    },
    [branchForLeaf, onSelectLeaf, setMessages],
  );

  const handleViewRevision = useCallback(
    (messageId: string) => {
      setView('model');
      onViewRevision(messageId);
    },
    [onViewRevision, setView],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [branchNodes, isLoading]);

  return (
    <>
      <ScrollArea
        className="relative w-full min-w-0 max-w-full flex-1 self-center overflow-x-hidden px-3 py-0 md:min-h-0 md:p-4 [&_[data-radix-scroll-area-viewport]]:overflow-x-hidden"
        ref={scrollRef}
      >
        <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 pb-6 md:gap-8 md:pb-4">
          {branchNodes.map((node, index) => {
            const isLastMessage = index === branchNodes.length - 1;
            const brepArtifact =
              node.role === 'assistant'
                ? getBrepProjectArtifact(node.parts)
                : undefined;
            return (
              <div key={node.id} className="flex min-w-0 flex-col gap-2">
                <MessageBubble
                  message={node}
                  isLoading={isLoading}
                  isLastMessage={isLastMessage}
                  currentModel={displayedModel}
                  onSelectLeaf={(id) => void handleSelectLeaf(id)}
                  onEditUserText={
                    node.role === 'user' ? handleEditUserText : undefined
                  }
                  onViewArtifact={() => {}}
                  onViewMesh={() => {}}
                  onChangeRating={
                    node.role === 'assistant'
                      ? (rating) => onChangeRating(node.id, rating)
                      : undefined
                  }
                  onRetry={
                    node.role === 'assistant'
                      ? (nextModel) => void handleRetry(node, nextModel)
                      : undefined
                  }
                  onRestore={
                    node.role === 'assistant' && !isLastMessage
                      ? () => void handleRestore(node)
                      : undefined
                  }
                />
                {brepArtifact ? (
                  <BrepIterationModelCard
                    artifact={brepArtifact}
                    loaded={displayedRevisionId === node.id}
                    active={activeRevisionId === node.id}
                    disabled={isLoading && isLastMessage}
                    onLoad={() => handleViewRevision(node.id)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <div className="w-full shrink-0 self-center px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-4 md:pb-4">
        {!isLoading && (
          <div className="mx-auto max-w-3xl pt-1">
            <SuggestionPills
              suggestions={conversation.settings?.suggestions ?? []}
              onSelect={(suggestion) =>
                void handleSend([{ type: 'text', text: suggestion }])
              }
            />
          </div>
        )}
        <TextAreaChat
          type="parametric"
          onSubmit={(parts) => void handleSend(parts)}
          placeholder="Describe the next BRep edit..."
          isLoading={isLoading}
          stopGenerating={() => void stopGeneration()}
          model={displayedModel}
          setModel={setModel}
          conversation={conversation}
          executionMode={executionMode}
          onExecutionModeChange={onExecutionModeChange}
        />
      </div>
    </>
  );
}
