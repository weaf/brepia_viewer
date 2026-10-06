import { ChatTitle } from '@/components/chat/ChatTitle';
import { BrepChatSession } from '@/components/brep/BrepChatSession';
import { BrepCreationProgress } from '@/components/brep/BrepCreationProgress';
import {
  BrepProjectEditorProvider,
  BrepProjectParametersPanel,
} from '@/components/brep/BrepProjectEditor';
import { BrepFeatureWorkspaceProvider } from '@/components/brep/BrepFeatureWorkspace';
import { BrepProjectWorkspacePanel } from '@/components/brep/BrepProjectWorkspacePanel';
import { ActivityIndicator } from '@/components/brand';
import { Button } from '@/components/ui/button';
import {
  ConversationContext,
  useConversation,
} from '@/contexts/ConversationContext';
import { SelectedItemsContext } from '@/contexts/SelectedItemsContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  ensureInputRecords,
  messageRowToChatMessage,
  type ChatMessage,
} from '@/lib/aiMessages';
import { UNCONFIGURED_MODEL_ID } from '@/lib/defaultModels';
import { normalizeModelId } from '@shared/models';
import { supabase } from '@/lib/supabase';
import {
  getLatestBrepGenerationRun,
  useLatestBrepGenerationRun,
} from '@/services/generationRunService';
import {
  isRecentPendingBrepCreation,
  persistUserMessage,
  useChangeRatingMutation,
  useMessagesQuery,
} from '@/services/messageService';
import { useConversationMutations } from '@/services/conversationMutations';
import {
  hiddenBrepRevisionIds,
  persistBrepProjectParameterRevision,
  persistBrepProjectSourceRevision,
  removeBrepProjectRevisionFromHistory,
  restoreBrepProjectRevision,
  selectBrepProjectRevision,
} from '@/services/brepProjectService';
import {
  brepRevisionLabels,
  renameBrepProjectRevision,
} from '@/services/brepRevisionLabelService';
import { getBrepProjectArtifact } from '@shared/brepProjectArtifact';
import { resolveActiveBrepAiSourceForLeaf } from '@shared/brepAiContext';
import type { BrepProject } from '@shared/brepProject';
import type { BrepParameterValues } from '@shared/brepProvider';
import type { AppUIMessage } from '@shared/chatAi';
import {
  isGenerationRunAiEditing,
  isGenerationRunTerminal,
} from '@shared/generationRun';
import Tree from '@shared/Tree';
import type { Conversation, Message, Model } from '@shared/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Box } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MessageItem } from '../types/misc.ts';
import { ConversationView } from './ConversationView';

function hasEmptyMetadata(metadata: unknown): boolean {
  return (
    metadata === undefined ||
    metadata === null ||
    (typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      Object.keys(metadata).length === 0)
  );
}

function isLifecycleOnlyBrepRevision(
  message: Pick<ChatMessage, 'role' | 'parts' | 'metadata'>,
): boolean {
  return (
    message.role === 'assistant' &&
    message.parts.length === 1 &&
    message.parts[0]?.type === 'data-brep-project' &&
    hasEmptyMetadata(message.metadata)
  );
}

type BrepGenerationAttempt = {
  requestMessageId: string;
  baselineRunId: string | null;
};

export default function BrepProjectView() {
  const { id } = useParams({ from: '/_layout/_auth/brep/$id' });
  const { user } = useAuth();
  const [images, setImages] = useState<MessageItem[]>([]);
  const [mesh, setMesh] = useState<MessageItem | null>(null);

  const {
    data: conversation,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['conversation', id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error: conversationError } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', id)
        .eq('user_id', user?.id ?? '')
        .single();
      if (conversationError) throw conversationError;
      const typedConversation = data as Conversation;
      if (typedConversation.type !== 'parametric') {
        throw new Error('This is not a persisted BRep project.');
      }
      return typedConversation;
    },
  });

  const {
    updateConversation,
    updateConversationAsync,
    setConversationLeafAsync,
  } = useConversationMutations();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <ActivityIndicator label="Loading BRep project" showLabel />
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <main className="p-6 text-destructive">
        {error instanceof Error ? error.message : 'BRep project not found.'}
      </main>
    );
  }

  return (
    <ConversationContext.Provider
      value={{
        conversation,
        updateConversation,
        updateConversationAsync,
        setConversationLeafAsync,
      }}
    >
      <SelectedItemsContext.Provider
        value={{ images, setImages, mesh, setMesh }}
      >
        <BrepProjectWorkspace key={conversation.id} />
      </SelectedItemsContext.Provider>
    </ConversationContext.Provider>
  );
}

function BrepProjectWorkspace() {
  const { conversation, updateConversation, setConversationLeafAsync } =
    useConversation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [model, setModel] = useState<Model>(
    conversation.settings?.model
      ? normalizeModelId(conversation.settings.model)
      : UNCONFIGURED_MODEL_ID,
  );
  const [executionMode, setExecutionMode] = useState<'cli' | 'streaming'>(
    conversation.settings?.openCodeExecutionMode ?? 'cli',
  );
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [generationAttempt, setGenerationAttempt] =
    useState<BrepGenerationAttempt | null>(null);
  const [mobilePreviewVersion, setMobilePreviewVersion] = useState(0);
  const [viewedRevisionId, setViewedRevisionId] = useState<string | null>(null);

  const handleChatLoadingChange = useCallback((loading: boolean) => {
    setIsChatStreaming(loading);
  }, []);

  const { data: dbMessages = [], isFetched: areMessagesFetched } =
    useMessagesQuery();
  const chatMessages = useMemo(
    () => dbMessages.map(messageRowToChatMessage),
    [dbMessages],
  );
  const dbTree = useMemo(() => new Tree(chatMessages), [chatMessages]);
  const branchForLeaf = useCallback(
    (leafId: string): AppUIMessage[] =>
      dbTree
        .getPath(leafId)
        .filter((node) => !isLifecycleOnlyBrepRevision(node))
        .map((node) => ({
          id: node.id,
          role: node.role,
          parts: node.parts,
          metadata: node.metadata,
        })),
    [dbTree],
  );
  const leafId =
    conversation.current_message_leaf_id ?? dbMessages.at(-1)?.id ?? '';
  const leafPresentInMessages =
    !leafId || dbMessages.some((message) => message.id === leafId);
  const initialBranch = useMemo(
    () => (leafId && leafPresentInMessages ? branchForLeaf(leafId) : []),
    [branchForLeaf, leafId, leafPresentInMessages],
  );

  const activeSource = useMemo(
    () =>
      leafId && leafPresentInMessages
        ? resolveActiveBrepAiSourceForLeaf(dbMessages, leafId)
        : undefined,
    [dbMessages, leafId, leafPresentInMessages],
  );
  const revisions = useMemo(
    () =>
      dbMessages.flatMap((message) => {
        if (message.role !== 'assistant') return [];
        const artifact = getBrepProjectArtifact(message.parts);
        return artifact
          ? [
              {
                id: message.id,
                artifact,
              },
            ]
          : [];
      }),
    [dbMessages],
  );
  const hiddenRevisionIdSet = useMemo(
    () => new Set(hiddenBrepRevisionIds(conversation.settings)),
    [conversation.settings],
  );
  const revisionLabelMap = useMemo(
    () => brepRevisionLabels(conversation.settings),
    [conversation.settings],
  );
  const editorRevisions = useMemo(
    () =>
      revisions.flatMap((revision, index) =>
        hiddenRevisionIdSet.has(revision.id)
          ? []
          : [
              {
                id: revision.id,
                label: `Revision ${index + 1}`,
                name: revisionLabelMap[revision.id],
              },
            ],
      ),
    [hiddenRevisionIdSet, revisionLabelMap, revisions],
  );

  const displayedSource = useMemo(() => {
    if (!viewedRevisionId || viewedRevisionId === activeSource?.messageId) {
      return activeSource;
    }
    const revision = revisions.find((item) => item.id === viewedRevisionId);
    return revision
      ? {
          kind: 'source' as const,
          messageId: revision.id,
          artifact: revision.artifact,
          project: revision.artifact.source.source,
        }
      : activeSource;
  }, [activeSource, revisions, viewedRevisionId]);
  const viewingHistorical = Boolean(
    activeSource &&
    displayedSource &&
    displayedSource.messageId !== activeSource.messageId,
  );
  const displayedRevisionLabel = useMemo(
    () =>
      editorRevisions.find(
        (revision) => revision.id === displayedSource?.messageId,
      )?.name ??
      editorRevisions.find(
        (revision) => revision.id === displayedSource?.messageId,
      )?.label,
    [displayedSource?.messageId, editorRevisions],
  );

  useEffect(() => {
    setViewedRevisionId(null);
  }, [activeSource?.messageId]);

  const handleViewRevision = useCallback(
    (messageId: string) => {
      if (!revisions.some((revision) => revision.id === messageId)) return;
      setViewedRevisionId(
        messageId === activeSource?.messageId ? null : messageId,
      );
      setMobilePreviewVersion((current) => current + 1);
    },
    [activeSource?.messageId, revisions],
  );

  const returnToActiveRevision = useCallback(() => {
    setViewedRevisionId(null);
    setMobilePreviewVersion((current) => current + 1);
  }, []);

  const refreshWorkspace = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['messages', conversation.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['conversation', conversation.id],
      }),
      queryClient.invalidateQueries({ queryKey: ['conversations'] }),
    ]);
  }, [conversation.id, queryClient]);

  const updateSelectedModel = useCallback(
    (nextModel: Model) => {
      setModel(nextModel);
      updateConversation?.({
        id: conversation.id,
        patch: { settings: { model: nextModel } },
      });
    },
    [conversation, updateConversation],
  );

  const handleExecutionModeChange = useCallback(
    (nextMode: 'cli' | 'streaming') => {
      setExecutionMode(nextMode);
      updateConversation?.({
        id: conversation.id,
        patch: { settings: { openCodeExecutionMode: nextMode } },
      });
    },
    [conversation, updateConversation],
  );

  const prepareGenerationAttempt = useCallback(
    async (requestMessageId: string) => {
      const baselineRun = await getLatestBrepGenerationRun({
        conversationId: conversation.id,
        requestMessageId,
      });
      setGenerationAttempt({
        requestMessageId,
        baselineRunId: baselineRun?.id ?? null,
      });
    },
    [conversation.id],
  );

  const handleSendParts = useCallback(
    async (parts: AppUIMessage['parts']) => {
      if (!user?.id) throw new Error('User must be authenticated');
      await ensureInputRecords({
        parts,
        conversationId: conversation.id,
        userId: user.id,
      });
      const userMessageId = await persistUserMessage({
        conversationId: conversation.id,
        parts,
        metadata: { model },
        parentMessageId: conversation.current_message_leaf_id ?? null,
      });
      await prepareGenerationAttempt(userMessageId);
      return { userMessageId };
    },
    [conversation, model, prepareGenerationAttempt, user?.id],
  );

  const handleRetry = useCallback(
    async (assistant: ChatMessage) => {
      const parentId = assistant.parent_message_id;
      if (!parentId) return;
      await setConversationLeafAsync?.({
        id: conversation.id,
        leafId: parentId,
      });
      await prepareGenerationAttempt(parentId);
    },
    [conversation.id, prepareGenerationAttempt, setConversationLeafAsync],
  );

  const handleEdit = useCallback(
    async (original: ChatMessage, parts: AppUIMessage['parts']) => {
      if (!user?.id) throw new Error('User must be authenticated');
      await ensureInputRecords({
        parts,
        conversationId: conversation.id,
        userId: user.id,
      });
      const parentId = original.parent_message_id;
      const newUserMessageId = await persistUserMessage({
        conversationId: conversation.id,
        parts,
        metadata: { model },
        parentMessageId: parentId,
      });
      await prepareGenerationAttempt(newUserMessageId);
      return {
        newUserMessageId,
        parentPath: parentId ? branchForLeaf(parentId) : [],
      };
    },
    [branchForLeaf, conversation, model, prepareGenerationAttempt, user?.id],
  );

  const handleRestore = useCallback(
    async (assistant: ChatMessage) => {
      const newId = crypto.randomUUID();
      const parts = JSON.parse(JSON.stringify(assistant.parts));
      const metadata = JSON.parse(JSON.stringify(assistant.metadata ?? {}));
      const role: Message['role'] = 'assistant';
      const { error } = await supabase.from('messages').insert({
        id: newId,
        conversation_id: conversation.id,
        role,
        parts,
        metadata,
        parent_message_id: assistant.parent_message_id,
        rating: 0,
      });
      if (error) throw error;

      queryClient.setQueryData(
        ['conversation', conversation.id],
        (old: Conversation | undefined) =>
          old ? { ...old, current_message_leaf_id: newId } : old,
      );
      queryClient.setQueryData(
        ['messages', conversation.id],
        (old: Message[] | undefined): Message[] => [
          ...(old ?? []),
          {
            id: newId,
            conversation_id: conversation.id,
            role,
            parts,
            metadata,
            parent_message_id: assistant.parent_message_id,
            rating: 0,
            created_at: new Date().toISOString(),
          },
        ],
      );
      queryClient.invalidateQueries({
        queryKey: ['messages', conversation.id],
      });

      const parentPath = assistant.parent_message_id
        ? branchForLeaf(assistant.parent_message_id)
        : [];
      return {
        newBranch: [
          ...parentPath,
          { id: newId, role, parts, metadata },
        ] as AppUIMessage[],
      };
    },
    [branchForLeaf, conversation.id, queryClient],
  );

  const handleSelectLeaf = useCallback(
    async (messageId: string) => {
      await setConversationLeafAsync?.({
        id: conversation.id,
        leafId: messageId,
      });
    },
    [conversation.id, setConversationLeafAsync],
  );

  const { mutate: changeRating } = useChangeRatingMutation({
    conversationId: conversation.id,
  });
  const handleChangeRating = useCallback(
    (messageId: string, rating: number) => {
      changeRating({ messageId, rating });
    },
    [changeRating],
  );

  const pendingBrepCreation = isRecentPendingBrepCreation(
    conversation,
    dbMessages,
  );
  const { data: generationRun, isFetched: isGenerationRunFetched } =
    useLatestBrepGenerationRun({
      conversationId: conversation.id,
      enabled: Boolean(user?.id),
      pollWhenMissing: pendingBrepCreation || Boolean(generationAttempt),
      ...(generationAttempt
        ? {
            requestMessageId: generationAttempt.requestMessageId,
            baselineRunId: generationAttempt.baselineRunId,
          }
        : {}),
    });
  const generationHandoffPending = Boolean(generationAttempt && !generationRun);
  const durableAiEditing = Boolean(
    generationRun && isGenerationRunAiEditing(generationRun),
  );
  const isAiEditing =
    generationHandoffPending ||
    durableAiEditing ||
    (!generationAttempt && isChatStreaming);
  const isAiEditingRef = useRef(isAiEditing);
  isAiEditingRef.current = isAiEditing;
  const projectEditingDisabled = isAiEditing || viewingHistorical;

  const durableCreationWithoutSource =
    !activeSource &&
    Boolean(generationRun) &&
    generationRun?.status !== 'completed';
  const generationRunLookupPending = !activeSource && !isGenerationRunFetched;
  const creationWorkspacePending =
    !activeSource &&
    (pendingBrepCreation ||
      durableCreationWithoutSource ||
      generationRunLookupPending);
  const showActiveGenerationProgress = Boolean(
    activeSource &&
    (generationHandoffPending ||
      (!generationAttempt && isChatStreaming) ||
      (generationRun &&
        (!isGenerationRunTerminal(generationRun.status) ||
          (Boolean(generationAttempt) &&
            generationRun.status !== 'completed')))),
  );

  if (!areMessagesFetched || !leafPresentInMessages) {
    return (
      <div className="flex h-full items-center justify-center">
        <ActivityIndicator label="Synchronizing BRep conversation" showLabel />
      </div>
    );
  }

  if (creationWorkspacePending) {
    return (
      <BrepFeatureWorkspaceProvider>
        <ConversationView
          hasParameters={false}
          chatPanelSlot={
            <>
              <div className="flex w-full items-center justify-between gap-3 border-b border-adam-neutral-700 px-4 py-3 md:pl-12">
                <div className="min-w-0 flex-1">
                  <ChatTitle />
                </div>
                <span className="hidden shrink-0 text-xs text-adam-text-tertiary sm:inline">
                  {generationRun?.status === 'failed'
                    ? 'Generation failed'
                    : generationRun?.status === 'cancelled'
                      ? 'Generation stopped'
                      : 'AI creating…'}
                </span>
              </div>
              <BrepCreationProgress
                messages={dbMessages}
                messagesFetched={areMessagesFetched}
                leafPresent={leafPresentInMessages}
                model={model}
                executionMode={executionMode}
                generationRun={generationRun}
                variant="inline"
              />
              <BrepChatSession
                conversation={conversation}
                dbMessages={dbMessages}
                initialBranch={initialBranch}
                model={model}
                setModel={updateSelectedModel}
                executionMode={executionMode}
                onExecutionModeChange={handleExecutionModeChange}
                onSendParts={handleSendParts}
                onRetry={handleRetry}
                onEdit={handleEdit}
                onRestore={handleRestore}
                onSelectLeaf={handleSelectLeaf}
                branchForLeaf={branchForLeaf}
                onChangeRating={handleChangeRating}
                onViewRevision={handleViewRevision}
                displayedRevisionId=""
                activeRevisionId=""
                onLoadingChange={handleChatLoadingChange}
              />
            </>
          }
          previewSlot={
            <div className="flex h-full min-h-0 items-center justify-center bg-adam-background-1 p-6 text-center">
              <div className="max-w-sm">
                <ActivityIndicator
                  label="Waiting for native BRep preview"
                  showLabel
                />
                <p className="mt-3 text-sm leading-5 text-adam-text-secondary">
                  The 3D workspace will appear here after the canonical source
                  is validated and the first immutable revision is saved.
                </p>
              </div>
            </div>
          }
          parametersSlot={null}
        />
      </BrepFeatureWorkspaceProvider>
    );
  }

  if (!activeSource || !displayedSource) {
    return (
      <main className="p-6 text-destructive">
        The active project branch has no valid BRep source snapshot.
      </main>
    );
  }

  return (
    <BrepProjectEditorProvider
      key={`brep-source:${displayedSource.messageId}`}
      project={displayedSource.artifact.source.source}
      conversationId={viewingHistorical ? undefined : conversation.id}
      packageTitle={displayedSource.artifact.title}
      activeRevisionId={activeSource.messageId}
      revisions={editorRevisions}
      sourceEditingDisabled={projectEditingDisabled}
      onParameterValuesCommit={async (parameterValues: BrepParameterValues) => {
        if (viewingHistorical) {
          throw new Error(
            'Restore this historical BRep revision before editing its parameters.',
          );
        }
        if (isAiEditingRef.current) {
          throw new Error(
            'BRep parameter editing is disabled while AI is creating a new immutable revision.',
          );
        }
        await persistBrepProjectParameterRevision({
          conversationId: conversation.id,
          parentMessageId: leafId,
          artifact: activeSource.artifact,
          parameterValues,
        });
        await refreshWorkspace();
      }}
      onProjectSourceCommit={async (project: BrepProject) => {
        if (viewingHistorical) {
          throw new Error(
            'Restore this historical BRep revision before editing its features.',
          );
        }
        if (isAiEditingRef.current) {
          throw new Error(
            'BRep feature editing is disabled while AI is creating a new immutable revision.',
          );
        }
        await persistBrepProjectSourceRevision({
          conversationId: conversation.id,
          parentMessageId: leafId,
          artifact: activeSource.artifact,
          project,
        });
        await refreshWorkspace();
      }}
      onSelectRevision={async (messageId) => {
        await selectBrepProjectRevision({
          conversationId: conversation.id,
          messageId,
        });
        await refreshWorkspace();
      }}
      onRenameRevision={async (messageId, label) => {
        await renameBrepProjectRevision({
          conversationId: conversation.id,
          messageId,
          label,
        });
        await refreshWorkspace();
      }}
      onRestoreRevision={async (messageId) => {
        await restoreBrepProjectRevision({
          conversationId: conversation.id,
          sourceMessageId: messageId,
        });
        await refreshWorkspace();
      }}
      onDeleteRevision={async (messageId) => {
        await removeBrepProjectRevisionFromHistory({
          conversationId: conversation.id,
          messageId,
          activeRevisionId: activeSource.messageId,
        });
        await refreshWorkspace();
      }}
    >
      <BrepFeatureWorkspaceProvider>
        <ConversationView
          hasParameters
          mobilePreviewKey={`brep:${displayedSource.messageId}`}
          mobilePreviewVersion={mobilePreviewVersion}
          chatPanelSlot={
            <>
              <div className="flex w-full items-center justify-between gap-3 border-b border-adam-neutral-700 px-4 py-3 md:pl-12">
                <div className="min-w-0 flex-1">
                  <ChatTitle />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {viewingHistorical ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title="Return to the current authoritative BRep revision"
                      onClick={returnToActiveRevision}
                      className="hidden text-xs text-adam-neutral-300 sm:inline-flex"
                    >
                      {displayedRevisionLabel ?? 'Historical revision'} · read
                      only
                      <span className="ml-2 text-adam-blue">
                        Back to active
                      </span>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="[@media(min-width:1025px)]:hidden"
                    onClick={() =>
                      setMobilePreviewVersion((current) => current + 1)
                    }
                  >
                    <Box className="mr-1 h-4 w-4" />
                    Workspace
                  </Button>
                  <span className="hidden text-xs text-adam-text-tertiary sm:inline">
                    {isAiEditing
                      ? 'AI editing…'
                      : viewingHistorical
                        ? 'Historical preview'
                        : 'Native BRep'}
                  </span>
                </div>
              </div>
              {showActiveGenerationProgress ? (
                <BrepCreationProgress
                  messages={dbMessages}
                  messagesFetched={areMessagesFetched}
                  leafPresent={leafPresentInMessages}
                  model={model}
                  executionMode={executionMode}
                  generationRun={generationRun}
                  variant="inline"
                  mode="edit"
                />
              ) : null}
              <BrepChatSession
                conversation={conversation}
                dbMessages={dbMessages}
                initialBranch={initialBranch}
                model={model}
                setModel={updateSelectedModel}
                executionMode={executionMode}
                onExecutionModeChange={handleExecutionModeChange}
                onSendParts={handleSendParts}
                onRetry={handleRetry}
                onEdit={handleEdit}
                onRestore={handleRestore}
                onSelectLeaf={handleSelectLeaf}
                branchForLeaf={branchForLeaf}
                onChangeRating={handleChangeRating}
                onViewRevision={handleViewRevision}
                displayedRevisionId={displayedSource.messageId}
                activeRevisionId={activeSource.messageId}
                onLoadingChange={handleChatLoadingChange}
              />
            </>
          }
          previewSlot={
            <BrepProjectWorkspacePanel readOnly={viewingHistorical} />
          }
          parametersSlot={
            <fieldset disabled={projectEditingDisabled} className="contents">
              <BrepProjectParametersPanel />
            </fieldset>
          }
          mobilePreviewSlot={
            <BrepProjectWorkspacePanel isMobile readOnly={viewingHistorical} />
          }
          mobileParametersSlot={
            <fieldset disabled={projectEditingDisabled} className="contents">
              <BrepProjectParametersPanel />
            </fieldset>
          }
        />
      </BrepFeatureWorkspaceProvider>
    </BrepProjectEditorProvider>
  );
}
