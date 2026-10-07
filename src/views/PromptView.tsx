import { useNavigate, Link } from '@tanstack/react-router';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, ssoProvider } from '@/lib/supabase';
import { signInWithSsoProvider } from '@/lib/ssoAuth';
import TextAreaChat from '@/components/TextAreaChat';
import { ScadImportButton } from '@/components/ScadImportButton';
import { InstructionProfileSelector } from '@/components/InstructionProfileSelector';
import { BrepCreationProgress } from '@/components/brep/BrepCreationProgress';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { useState, useMemo, useEffect, useRef } from 'react';
import { Model } from '@shared/types';
import {
  DEFAULT_AI_INSTRUCTION_PROFILE_ID,
  type AiInstructionProfileId,
} from '@shared/aiInstructionCatalog';
import { conversationTitleFromText } from '@shared/conversationTitle';
import { MessageItem } from '../types/misc.ts';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import { createUuid } from '@/lib/uuid';
import { SelectedItemsContext } from '@/contexts/SelectedItemsContext';
import posthog from 'posthog-js';
import * as Sentry from '@sentry/react';
import { useProfile } from '@/services/profileService';
import { useLayoutContext } from '@/contexts/LayoutContext';
import { apiUrl } from '@/services/api';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import { createAndCacheAiChat } from '@/hooks/useCachedAiChat';
import type { AppUIMessage } from '@shared/chatAi';
import { ensureInputRecords } from '@/lib/aiMessages';
import { createOpenScadProjectAssetDescriptor } from '@/lib/openScadProjectAssetStorage';
import { useLatestBrepGenerationRun } from '@/services/generationRunService';
import { persistUserMessage } from '@/services/messageService';
import { HOME_PROMPT_DRAFT_KEY } from '@/lib/promptDraft';
import { pickHomePromptMessage } from '@/lib/homePromptCopy';
import { getRegistrationSettings } from '@/services/accountAdminService';
import { useParametricModelCatalog } from '@/hooks/useParametricModelCatalog';
import { getAiPreferences } from '@/services/aiPreferencesService';
import {
  UNCONFIGURED_MODEL_ID,
  resolveCreativeDefaultModel,
  resolveParametricDefaultModel,
} from '@/lib/defaultModels';
import { getCreativeInputValidationIssue } from '@/lib/creativeInputValidation';
import { resolvePreferredCreativeAgentModel } from '@/lib/creativeAgentSelection';

type ParametricSourceKind = 'openscad' | 'brep';
type PromptMessageMetadata = AppUIMessage['metadata'] & {
  parametricSourceKind?: 'brep';
};

const PENDING_BREP_SESSION_KEY = 'brepia.pendingBrepConversationId';

function mutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message
  ) {
    return error.message;
  }
  return fallback;
}

export function PromptView() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: profile, isLoading: isProfileLoading } = useProfile();
  const { isSidebarOpen } = useLayoutContext();
  const queryClient = useQueryClient();
  const { data: registration } = useQuery({
    queryKey: ['registration-settings'],
    queryFn: getRegistrationSettings,
    staleTime: 30_000,
    enabled: !user && !ssoProvider,
  });
  const { models: parametricModels, isLoading: isParametricCatalogLoading } =
    useParametricModelCatalog();
  const { data: aiPreferences } = useQuery({
    queryKey: ['ai-preferences', 'defaults'],
    queryFn: getAiPreferences,
    staleTime: 0,
    enabled: Boolean(user),
  });

  const signupAvailable =
    Boolean(ssoProvider) ||
    registration?.bootstrapAvailable === true ||
    registration?.allowRegistration === true;
  const signupLabel = registration?.bootstrapAvailable
    ? 'Create Administrator'
    : 'Sign Up';

  const firstName = useMemo(() => {
    if (user && isProfileLoading) return '';
    const source = profile?.full_name || user?.email?.split('@')[0] || '';
    return source.trim().split(/\s+/)[0] || '';
  }, [profile?.full_name, user, isProfileLoading]);

  const [type, setType] = useState<'parametric' | 'creative'>('parametric');
  const [parametricSourceKind, setParametricSourceKind] =
    useState<ParametricSourceKind>('openscad');
  const [brepRequestSaved, setBrepRequestSaved] = useState(false);

  const parametricDefaultModel = useMemo(
    () =>
      resolveParametricDefaultModel(
        aiPreferences?.defaultParametricModelId,
        parametricModels,
      ),
    [aiPreferences?.defaultParametricModelId, parametricModels],
  );
  const creativeDefaultModel = useMemo(
    () => resolveCreativeDefaultModel(aiPreferences?.defaultCreativeModelId),
    [aiPreferences?.defaultCreativeModelId],
  );

  const [model, setModel] = useState<Model>(UNCONFIGURED_MODEL_ID);
  const parametricModelReady = useMemo(
    () =>
      model !== UNCONFIGURED_MODEL_ID &&
      parametricModels.some((candidate) => candidate.id === model),
    [model, parametricModels],
  );
  const [instructionProfileId, setInstructionProfileId] =
    useState<AiInstructionProfileId>(DEFAULT_AI_INSTRUCTION_PROFILE_ID);
  const initialDefaultAppliedRef = useRef(false);
  const initialInstructionProfileAppliedRef = useRef(false);

  useEffect(() => {
    if (
      !user ||
      !aiPreferences ||
      isParametricCatalogLoading ||
      initialDefaultAppliedRef.current
    ) {
      return;
    }

    setModel(
      type === 'creative' ? creativeDefaultModel : parametricDefaultModel,
    );
    initialDefaultAppliedRef.current = true;
  }, [
    aiPreferences,
    creativeDefaultModel,
    isParametricCatalogLoading,
    parametricDefaultModel,
    type,
    user,
  ]);

  useEffect(() => {
    if (
      !user ||
      !aiPreferences ||
      initialInstructionProfileAppliedRef.current
    ) {
      return;
    }
    setInstructionProfileId(aiPreferences.defaultInstructionProfileId);
    initialInstructionProfileAppliedRef.current = true;
  }, [aiPreferences, user]);

  useEffect(() => {
    const navigation = window.performance
      .getEntriesByType('navigation')
      .at(0) as PerformanceNavigationTiming | undefined;
    if (navigation?.type !== 'reload') return;

    const pendingConversationId = window.sessionStorage.getItem(
      PENDING_BREP_SESSION_KEY,
    );
    if (!pendingConversationId) return;

    window.sessionStorage.removeItem(PENDING_BREP_SESSION_KEY);
    window.location.replace(`/brep/${pendingConversationId}`);
  }, []);

  const [executionMode, setExecutionMode] = useState<'cli' | 'streaming'>(
    'cli',
  );

  const [isLoaded, setIsLoaded] = useState(false);
  const isMobile = useIsMobile();
  const [images, setImages] = useState<MessageItem[]>([]);
  const [mesh, setMesh] = useState<MessageItem | null>(null);

  const handleTypeChange = (newType: 'parametric' | 'creative') => {
    if (newType === type) return;

    if (newType === 'parametric' && (images.length > 0 || mesh)) {
      const nativeBrepTarget = parametricSourceKind === 'brep';
      const hasUnsupportedImages = images.length > 0;
      const hasUnsupportedMesh = Boolean(
        mesh && (mesh.fileType !== 'stl' || mesh.isUploading),
      );

      if (nativeBrepTarget || hasUnsupportedImages || hasUnsupportedMesh) {
        toast({
          title: 'Remove incompatible attachments first',
          description: nativeBrepTarget
            ? 'Native BRep creation is text-only. Remove attachments before switching back to Parametric.'
            : 'OpenSCAD Parametric mode can retain a completed STL attachment, but other Mesh-mode attachments must be removed first.',
        });
        return;
      }
    }

    setType(newType);
    setModel(
      newType === 'creative' ? creativeDefaultModel : parametricDefaultModel,
    );
  };

  const handleParametricSourceChange = (next: ParametricSourceKind) => {
    if (next === 'brep' && (images.length > 0 || mesh)) {
      toast({
        title: 'Remove attachments first',
        description:
          'Native BRep creation currently starts from a text prompt only. Remove attached images or meshes before switching model type.',
      });
      return;
    }
    setParametricSourceKind(next);
  };

  const [draftConversationId, setDraftConversationId] = useState(() =>
    createUuid(),
  );
  const [homePrompt] = useState(() => pickHomePromptMessage());

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsLoaded(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const getTimeBasedGreeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) {
      return 'Good morning';
    } else if (hour < 18) {
      return 'Good afternoon';
    } else {
      return 'Good evening';
    }
  }, []);

  const { mutate: signInWithSso } = useMutation({
    mutationFn: () => signInWithSsoProvider('/app'),
    onError: (error) => {
      toast({
        title: 'Whoopsies',
        description: mutationErrorMessage(error, 'Something went wrong'),
        variant: 'destructive',
      });
    },
  });

  const { mutate: handleGenerate, isPending: isGenerating } = useMutation({
    mutationFn: async (parts: AppUIMessage['parts']) => {
      if (!user?.id) throw new Error('User must be authenticated');
      if (type === 'parametric' && !parametricModelReady) {
        throw new Error(
          'No selectable Parametric AI model is ready. Wait for model settings to load or select an available model.',
        );
      }
      const conversationId = draftConversationId;
      const isNativeBrep =
        type === 'parametric' && parametricSourceKind === 'brep';
      if (isNativeBrep) setBrepRequestSaved(false);
      const creativeAgentModel =
        type === 'creative'
          ? resolvePreferredCreativeAgentModel(parametricModels)
          : undefined;

      if (type === 'creative' && !creativeAgentModel) {
        throw new Error('No compatible Creative AI model is available');
      }
      if (isNativeBrep && parts.some((part) => part.type !== 'text')) {
        throw new Error(
          'Native BRep creation currently supports text prompts only. Remove attachments and try again.',
        );
      }

      const submittedParts =
        type === 'parametric' && !isNativeBrep
          ? ((await Promise.all(
              parts.map(async (part) => {
                if (
                  part.type !== 'data-mesh-context' ||
                  part.data.fileType !== 'stl' ||
                  !part.data.filename ||
                  part.data.asset
                ) {
                  return part;
                }

                const storagePath = `${user.id}/${conversationId}/${part.data.meshId}.stl`;
                const { data, error } = await supabase.storage
                  .from('meshes')
                  .download(storagePath);
                if (error || !data) {
                  throw new Error(
                    `Could not load attached STL: ${
                      error?.message ?? 'missing object'
                    }`,
                  );
                }

                const asset = await createOpenScadProjectAssetDescriptor({
                  path: part.data.filename,
                  storagePath,
                  blob: data,
                });

                return {
                  ...part,
                  data: {
                    ...part.data,
                    asset,
                  },
                };
              }),
            )) as AppUIMessage['parts'])
          : parts;

      const text = submittedParts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
      const imageCount = submittedParts.filter(
        (p) => p.type === 'file' && p.mediaType.startsWith('image/'),
      ).length;
      const meshCount = submittedParts.filter(
        (p) => p.type === 'data-mesh-context',
      ).length;
      const initialTitle = conversationTitleFromText(text, {
        imageCount,
        meshCount,
      });

      posthog.capture('new_conversation', {
        type: type,
        model_name: model,
        ...(type === 'parametric'
          ? { parametric_source_kind: parametricSourceKind }
          : {}),
        ...(creativeAgentModel
          ? { creative_agent_model_name: creativeAgentModel }
          : {}),
        instruction_profile_id: instructionProfileId,
        text: text.trim().slice(0, 100),
        image_count: imageCount,
        mesh_count: meshCount,
        conversation_id: conversationId,
      });

      // Pin the complete repository instruction package independently from the
      // mode-specific custom prompt profile. Existing conversations therefore
      // keep their selected Brepia/Standard lineage when defaults change.
      const promptProfileId = aiPreferences?.defaultPromptProfileId ?? null;
      const creativePromptProfileId =
        aiPreferences?.defaultCreativePromptProfileId ?? null;

      const createConversation = (title: string) =>
        supabase
          .from('conversations')
          .insert([
            {
              id: conversationId,
              user_id: user.id,
              title,
              type: type,
              settings: {
                model: model,
                instructionProfileId,
                openCodeExecutionMode: executionMode,
                ...(type === 'creative'
                  ? { creativePromptProfileId, creativeAgentModel }
                  : {
                      promptProfileId,
                      ...(isNativeBrep
                        ? { parametricSourceKind: 'brep' as const }
                        : {}),
                    }),
              },
            },
          ])
          .select()
          .single();

      let conversationResult = await createConversation(initialTitle);
      if (conversationResult.error && initialTitle !== 'New Conversation') {
        console.warn(
          '[conversation-title] initial titled insert failed; retrying with legacy title',
          conversationResult.error,
        );
        conversationResult = await createConversation('New Conversation');
      }

      const { data: conversation, error: conversationError } =
        conversationResult;
      if (conversationError) {
        throw new Error(
          `Failed to create conversation: ${conversationError.message}`,
        );
      }
      if (!conversation) throw new Error('Failed to create conversation');

      await ensureInputRecords({
        parts: submittedParts,
        conversationId: conversation.id,
        userId: user.id,
      });
      if (submittedParts.length === 0) {
        throw new Error('No message parts to send');
      }

      const messageMetadata: PromptMessageMetadata = {
        model,
        ...(isNativeBrep ? { parametricSourceKind: 'brep' as const } : {}),
        ...(creativeAgentModel ? { agentModel: creativeAgentModel } : {}),
      };

      const userMessageId = await persistUserMessage({
        conversationId: conversation.id,
        parts: submittedParts,
        metadata: messageMetadata,
        parentMessageId: null,
      });

      if (isNativeBrep) {
        window.sessionStorage.setItem(
          PENDING_BREP_SESSION_KEY,
          conversation.id,
        );
        setBrepRequestSaved(true);
      }

      const chat = createAndCacheAiChat({
        id: isNativeBrep ? `brep:${conversation.id}` : conversation.id,
        generateId: () => createUuid(),
        messages: [],
        transport: new DefaultChatTransport<AppUIMessage>({
          api: apiUrl(
            type === 'creative' ? 'creative-chat' : 'parametric-chat',
          ),
          headers: async (): Promise<Record<string, string>> => {
            const accessToken = (await supabase.auth.getSession()).data.session
              ?.access_token;
            const headers: Record<string, string> = {};
            if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
            return headers;
          },
          prepareSendMessagesRequest: ({ body }) => ({
            body: {
              conversationId: conversation.id,
              model,
              ...(creativeAgentModel ? { agentModel: creativeAgentModel } : {}),
              openCodeExecutionMode: executionMode,
              ...(body ?? {}),
            },
          }),
        }),
        sendAutomaticallyWhen: isNativeBrep
          ? () => false
          : lastAssistantMessageIsCompleteWithToolCalls,
      });

      const sendPromise = chat.sendMessage({
        id: userMessageId,
        parts: submittedParts,
        metadata: messageMetadata,
      });
      if (isNativeBrep) {
        await sendPromise;
      } else {
        void sendPromise.catch((error) => {
          Sentry.captureException(error, {
            extra: {
              hook: 'PromptView initial chat',
              conversationId: conversation.id,
            },
          });
        });
      }

      void (async () => {
        try {
          if (conversation.title !== initialTitle) {
            const { error: localTitleError } = await supabase
              .from('conversations')
              .update({ title: initialTitle })
              .eq('id', conversation.id)
              .eq('user_id', user.id);
            if (localTitleError) throw localTitleError;
            await queryClient.invalidateQueries({
              queryKey: ['conversations'],
            });
          }

          const accessToken = (await supabase.auth.getSession()).data.session
            ?.access_token;
          const response = await fetch(apiUrl('title-generator'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(accessToken
                ? { Authorization: `Bearer ${accessToken}` }
                : {}),
            },
            body: JSON.stringify({ text, imageCount, meshCount }),
          });
          if (!response.ok) return;

          const result: unknown = await response.json();
          if (
            typeof result !== 'object' ||
            result === null ||
            !('title' in result) ||
            typeof result.title !== 'string' ||
            !result.title.trim() ||
            result.title === initialTitle
          ) {
            return;
          }

          const { error: titleUpdateError } = await supabase
            .from('conversations')
            .update({ title: result.title })
            .eq('id', conversation.id)
            .eq('user_id', user.id);
          if (titleUpdateError) throw titleUpdateError;
          await queryClient.invalidateQueries({ queryKey: ['conversations'] });
        } catch (error) {
          Sentry.captureException(error, {
            extra: {
              hook: 'PromptView conversation title',
              conversationId: conversation.id,
            },
          });
        }
      })();

      return {
        conversationId: conversation.id,
        destination: isNativeBrep ? ('brep' as const) : ('editor' as const),
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (data.destination === 'brep') {
        window.sessionStorage.removeItem(PENDING_BREP_SESSION_KEY);
        window.location.assign(`/brep/${data.conversationId}`);
        return;
      }
      navigate({ to: '/editor/$id', params: { id: data.conversationId } });
    },
    onError: (error) => {
      window.sessionStorage.removeItem(PENDING_BREP_SESSION_KEY);
      setBrepRequestSaved(false);
      setDraftConversationId(createUuid());
      Sentry.captureException(error);
      toast({
        title: 'Error',
        description: mutationErrorMessage(error, 'Failed to process prompt'),
        variant: 'destructive',
      });
    },
  });

  const nativeBrepGenerationActive =
    isGenerating && type === 'parametric' && parametricSourceKind === 'brep';
  const { data: homeGenerationRun } = useLatestBrepGenerationRun({
    conversationId: draftConversationId,
    enabled: Boolean(user?.id) && nativeBrepGenerationActive,
    pollWhenMissing: nativeBrepGenerationActive,
  });

  const handlePromptSubmit = (parts: AppUIMessage['parts']) => {
    if (type === 'parametric' && !parametricModelReady) {
      toast({
        title: 'AI model is still loading',
        description:
          'Wait for an available Parametric model to load before starting generation.',
      });
      return;
    }

    if (
      type === 'parametric' &&
      parametricSourceKind === 'brep' &&
      parts.some((part) => part.type !== 'text')
    ) {
      toast({
        title: 'Native BRep is text-only for now',
        description:
          'Remove attached images or meshes before creating a native BRep project.',
      });
      return;
    }

    const issue = getCreativeInputValidationIssue({
      conversationType: type,
      model,
      parts,
    });

    if (issue) {
      toast({
        title: issue.title,
        description: issue.description,
      });
      return;
    }

    handleGenerate(parts);
  };

  if (nativeBrepGenerationActive) {
    return (
      <BrepCreationProgress
        messages={[]}
        messagesFetched
        leafPresent
        model={model}
        executionMode={executionMode}
        requestSavedOverride={brepRequestSaved}
        generationRun={homeGenerationRun}
      />
    );
  }

  return (
    <div
      className={cn(
        'relative h-full min-h-full w-full transition-all duration-300 ease-in-out',
        isSidebarOpen && !isMobile && user?.id && 'pb-6 pr-6 pt-6',
      )}
    >
      <div
        className={cn(
          'h-full min-h-full bg-adam-bg-secondary-dark',
          isSidebarOpen &&
            !isMobile &&
            user?.id &&
            'rounded-xl shadow-[0_0_15px_rgba(0,0,0,0.1)]',
        )}
      >
        {!user && (
          <div className="fixed right-4 top-4 z-10 flex flex-row gap-2">
            {signupAvailable && (
              <Button
                variant="light"
                onClick={() =>
                  ssoProvider ? signInWithSso() : navigate({ to: '/signup' })
                }
                className="w-auto"
              >
                {signupLabel}
              </Button>
            )}
            <Button
              onClick={() =>
                ssoProvider ? signInWithSso() : navigate({ to: '/signin' })
              }
              className="w-auto"
            >
              <LogIn className="mr-2 h-4 w-4" />
              Sign In
            </Button>
          </div>
        )}

        <main className="relative flex h-full w-full flex-col items-center justify-center px-4 md:px-8">
          <div className="mx-auto flex max-w-3xl flex-col items-center justify-center">
            <h1
              className={cn(
                'mb-8 text-center text-2xl font-medium text-adam-text-primary md:text-3xl lg:text-4xl',
                'motion-safe:transition-opacity motion-safe:duration-1000 motion-safe:ease-out',
                isLoaded ? 'opacity-100' : 'opacity-0',
              )}
            >
              {getTimeBasedGreeting}
              {firstName ? `, ${firstName}` : ''}!
            </h1>
          </div>
          <div className="flex w-full flex-col items-center">
            <div className="w-full max-w-3xl space-y-4 pb-12">
              {user && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div
                    role="group"
                    aria-label="Creation mode"
                    className="flex shrink-0 overflow-hidden rounded-lg border border-adam-neutral-700 bg-adam-background-2"
                  >
                    <button
                      type="button"
                      aria-pressed={type === 'parametric'}
                      disabled={isGenerating}
                      onClick={() => handleTypeChange('parametric')}
                      className={cn(
                        'px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        type === 'parametric'
                          ? 'bg-adam-blue/15 text-adam-blue'
                          : 'bg-transparent text-adam-text-secondary hover:bg-adam-neutral-800 hover:text-adam-text-primary',
                      )}
                    >
                      Parametric
                    </button>
                    <button
                      type="button"
                      aria-pressed={type === 'creative'}
                      disabled={isGenerating}
                      onClick={() => handleTypeChange('creative')}
                      className={cn(
                        'border-l border-adam-neutral-700 px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        type === 'creative'
                          ? 'bg-adam-blue/15 text-adam-blue'
                          : 'bg-transparent text-adam-text-secondary hover:bg-adam-neutral-800 hover:text-adam-text-primary',
                      )}
                    >
                      Mesh
                    </button>
                  </div>
                  <InstructionProfileSelector
                    selectedProfileId={instructionProfileId}
                    onProfileChange={setInstructionProfileId}
                    disabled={isGenerating}
                    className="max-w-[260px] border border-adam-neutral-700 bg-adam-background-2"
                  />
                </div>
              )}
              {user && type === 'parametric' && (
                <div className="flex flex-col gap-3 rounded-xl border border-adam-neutral-700 bg-adam-background-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-adam-text-tertiary">
                      Parametric source
                    </p>
                    <p className="mt-1 text-xs text-adam-text-secondary">
                      {parametricSourceKind === 'brep'
                        ? 'Native BRep uses the exact Brepia BRep kernel and opens in the BRep workspace.'
                        : 'OpenSCAD keeps the existing script-based parametric workflow.'}
                    </p>
                  </div>
                  <div
                    role="group"
                    aria-label="Parametric model type"
                    className="flex shrink-0 overflow-hidden rounded-lg border border-adam-neutral-700"
                  >
                    <button
                      type="button"
                      aria-pressed={parametricSourceKind === 'openscad'}
                      disabled={isGenerating}
                      onClick={() => handleParametricSourceChange('openscad')}
                      className={cn(
                        'px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        parametricSourceKind === 'openscad'
                          ? 'bg-adam-blue/15 text-adam-blue'
                          : 'bg-transparent text-adam-text-secondary hover:bg-adam-neutral-800 hover:text-adam-text-primary',
                      )}
                    >
                      OpenSCAD
                    </button>
                    <button
                      type="button"
                      aria-pressed={parametricSourceKind === 'brep'}
                      disabled={isGenerating}
                      onClick={() => handleParametricSourceChange('brep')}
                      className={cn(
                        'border-l border-adam-neutral-700 px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        parametricSourceKind === 'brep'
                          ? 'bg-adam-blue/15 text-adam-blue'
                          : 'bg-transparent text-adam-text-secondary hover:bg-adam-neutral-800 hover:text-adam-text-primary',
                      )}
                    >
                      Native BRep
                    </button>
                  </div>
                </div>
              )}
              <SelectedItemsContext.Provider
                value={{ images, setImages, mesh, setMesh }}
              >
                <TextAreaChat
                  onSubmit={handlePromptSubmit}
                  conversation={{
                    id: draftConversationId,
                    user_id: user?.id ?? '',
                  }}
                  onFocus={() => {
                    if (!user) {
                      if (ssoProvider) {
                        signInWithSso();
                        return;
                      }
                      navigate({ to: '/signin' });
                      return;
                    }
                  }}
                  placeholder={
                    type === 'parametric' && parametricSourceKind === 'brep'
                      ? 'Describe the native parametric BRep model you want to create…'
                      : homePrompt
                  }
                  type={type}
                  disabled={isGenerating}
                  attachmentsDisabled={
                    type === 'parametric' && parametricSourceKind === 'brep'
                  }
                  attachmentDisabledReason="Native BRep creation is text-only for now."
                  model={model}
                  setModel={setModel}
                  showFullLabels={true}
                  executionMode={executionMode}
                  onExecutionModeChange={setExecutionMode}
                  draftStorageKey={HOME_PROMPT_DRAFT_KEY}
                />
              </SelectedItemsContext.Provider>
              {user &&
                type === 'parametric' &&
                parametricSourceKind === 'openscad' && (
                  <div className="flex justify-end">
                    <ScadImportButton
                      model={model}
                      executionMode={executionMode}
                      disabled={isGenerating}
                    />
                  </div>
                )}
              {!user && (
                <p className="text-center text-sm text-gray-500">
                  <Link
                    to="/signin"
                    onClick={(e) => {
                      if (ssoProvider) {
                        e.preventDefault();
                        signInWithSso();
                      }
                    }}
                    className="!text-adam-blue hover:!text-adam-blue/80"
                  >
                    Sign in
                  </Link>{' '}
                  {signupAvailable ? (
                    <>
                      or{' '}
                      <Link
                        to="/signup"
                        onClick={(e) => {
                          if (ssoProvider) {
                            e.preventDefault();
                            signInWithSso();
                          }
                        }}
                        className="!text-adam-blue hover:!text-adam-blue/80"
                      >
                        {registration?.bootstrapAvailable
                          ? 'create the administrator account'
                          : 'create an account'}
                      </Link>{' '}
                    </>
                  ) : null}
                  to start generating
                </p>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
