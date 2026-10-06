import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ProviderLogo } from '@/components/ProviderLogo';
import { cn } from '@/lib/utils';
import { Model } from '@shared/types';
import { ModelConfig } from '../types/misc.ts';
import { useConversation } from '@/contexts/ConversationContext';
import { registerConversationModelPicker } from '@/lib/modelPickerBridge';
import { useParametricModelCatalog } from '@/hooks/useParametricModelCatalog';
import {
  creativeAgentCandidates,
  readPreferredCreativeAgentModel,
  resolvePreferredCreativeAgentModel,
  writePreferredCreativeAgentModel,
} from '@/lib/creativeAgentSelection';

interface ModelSelectorProps {
  models: ModelConfig[];
  selectedModel: string;
  onModelChange: (modelId: Model) => void;
  disabled?: boolean;
  className?: string;
  type?: 'parametric' | 'creative'; // Optional type prop that takes precedence over conversation context
  focused?: boolean; // New prop to indicate if text area is focused
  /** Internal mirror selectors can opt out so the primary chat selector remains the bridge owner. */
  registerBinding?: boolean;
}

type ModelDropdownProps = ModelSelectorProps & {
  currentType: 'parametric' | 'creative';
  emptyLabel?: string;
};

/**
 * Shared single-model dropdown. Creative mode composes two of these: the
 * public 3D backend selector and a separate controller-LLM selector.
 */
function ModelDropdown({
  models,
  selectedModel,
  onModelChange,
  className,
  disabled,
  focused = false,
  registerBinding = true,
  currentType,
  emptyLabel = 'Select model',
}: ModelDropdownProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { conversation } = useConversation();

  useEffect(() => {
    if (!registerBinding) return;
    return registerConversationModelPicker(conversation.id, {
      models,
      selectedModel,
      onModelChange,
      disabled: !!disabled,
      type: currentType,
    });
  }, [
    conversation.id,
    currentType,
    disabled,
    models,
    onModelChange,
    registerBinding,
    selectedModel,
  ]);

  // Creative provider availability can change between deployments. If an old
  // conversation points at a retired local backend or an optional provider
  // that is no longer enabled, move it to the first selectable Creative model
  // (TRELLIS.2 in the core catalog) instead of rendering a blank selector and
  // submitting an unavailable backend ID. This applies only to the public 3D
  // selector; the Creative controller uses its own validation/pinning logic.
  useEffect(() => {
    if (!registerBinding || currentType !== 'creative' || models.length === 0) {
      return;
    }
    if (models.some((model) => model.id === selectedModel)) return;
    onModelChange(models[0].id);
  }, [currentType, models, onModelChange, registerBinding, selectedModel]);

  // Track previous model name for slide animation
  const [prevModelName, setPrevModelName] = useState<string | null>(null);
  const [isSliding, setIsSliding] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'up' | 'down'>('up');

  const selectedModelConfig = models.find((m) => m.id === selectedModel);
  const selectedModelName =
    selectedModelConfig?.name || selectedModel || emptyLabel;

  // Store previous selected model name and type
  const prevNameRef = useRef<string | undefined>(selectedModelName);
  const prevTypeRef = useRef<'parametric' | 'creative' | undefined>(
    currentType,
  );
  const recentTypeChangeRef = useRef<number>(0); // Timestamp of last type change

  // ---------------------------------------------------------------------------
  // Focus management
  // ---------------------------------------------------------------------------
  // Radix will always move focus back to the trigger after the dropdown closes.
  // When the user opened the menu via *keyboard* this is great for accessibility
  // because they can keep tabbing. But when the user opened the menu with a
  // *pointer* (mouse / touch), that behaviour leaves an unwanted focus outline
  // "stuck" on the button.
  // ---------------------------------------------------------------------------
  const openedWithPointerRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Trigger slide animation when selected model changes
  useEffect(() => {
    if (prevNameRef.current && prevNameRef.current !== selectedModelName) {
      setPrevModelName(prevNameRef.current);
      setIsSliding(true);

      const typeChanged = prevTypeRef.current !== currentType;
      const now = Date.now();
      const recentTypeChange = now - recentTypeChangeRef.current < 100;

      if (typeChanged) {
        const direction = currentType === 'parametric' ? 'down' : 'up';
        setSlideDirection(direction);
        recentTypeChangeRef.current = now;
      } else if (!recentTypeChange) {
        const prevIndex = models.findIndex(
          (m) => m.name === prevNameRef.current,
        );
        const newIndex = models.findIndex((m) => m.id === selectedModel);
        if (prevIndex !== -1 && newIndex !== -1) {
          const direction = newIndex > prevIndex ? 'up' : 'down';
          setSlideDirection(direction);
        }
      }
    }

    prevNameRef.current = selectedModelName;
    prevTypeRef.current = currentType;
  }, [currentType, models, selectedModel, selectedModelName]);

  const handleSlideEnd = () => {
    setPrevModelName(null);
    setIsSliding(false);
  };

  return (
    <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          onPointerDown={() => {
            openedWithPointerRef.current = true;
          }}
          onKeyDown={() => {
            openedWithPointerRef.current = false;
          }}
          variant="ghost"
          className={cn(
            'flex h-8 w-auto min-w-0 items-center gap-1.5 rounded-lg px-3 text-sm transition-all duration-200 hover:border-[#333333] hover:bg-adam-neutral-800',
            focused
              ? 'text-white hover:text-white'
              : 'text-adam-text-secondary hover:text-adam-text-primary',
            isDropdownOpen &&
              (focused
                ? 'bg-adam-neutral-800 text-white'
                : 'bg-adam-neutral-800 text-adam-text-primary'),
            className,
          )}
          disabled={!!disabled || models.length === 0}
        >
          <span className="relative inline-grid min-w-0 items-center overflow-hidden text-right font-normal">
            {prevModelName && (
              <span
                style={{ gridColumn: 1, gridRow: 1 }}
                className={`block truncate ${
                  slideDirection === 'up' ? 'slide-out-up' : 'slide-out-down'
                }`}
                onAnimationEnd={handleSlideEnd}
              >
                {prevModelName}
              </span>
            )}

            <span
              style={{ gridColumn: 1, gridRow: 1 }}
              className={cn(
                'block truncate',
                isSliding
                  ? slideDirection === 'up'
                    ? 'slide-in-up'
                    : 'slide-in-down'
                  : '',
              )}
            >
              {selectedModelName}
            </span>
          </span>
          <ChevronDown
            className={`ml-1 h-4 w-4 flex-shrink-0 opacity-70 transition-transform duration-200 ${
              isDropdownOpen ? 'rotate-180' : ''
            }`}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1 overflow-y-auto rounded-lg bg-adam-neutral-700 p-1 [max-height:min(340px,var(--radix-dropdown-menu-content-available-height))]"
        align="end"
        onCloseAutoFocus={(event) => {
          if (openedWithPointerRef.current) {
            event.preventDefault();
            openedWithPointerRef.current = false;
            triggerRef.current?.blur();
          }
        }}
      >
        {models.map((model) => (
          <DropdownMenuItem
            key={model.id}
            className={cn(
              'cursor-pointer rounded-md bg-adam-neutral-700 px-3 py-2.5 transition-colors duration-150 focus:bg-adam-bg-secondary-dark',
              selectedModel === model.id && 'bg-adam-neutral-800',
              !!model.disabled && 'cursor-not-allowed opacity-50',
            )}
            onClick={(event) => {
              onModelChange(model.id);
              setIsDropdownOpen(false);
              event.stopPropagation();
            }}
            disabled={!!model.disabled}
          >
            <div className="flex w-full items-start gap-3">
              <ProviderLogo
                provider={model.provider}
                className={cn(
                  'mt-0.5',
                  focused ? 'text-white' : 'text-adam-text-primary',
                )}
              />
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    'text-sm font-medium',
                    focused ? 'text-white' : 'text-adam-text-primary',
                  )}
                >
                  {model.name}
                </span>
                {model.description && (
                  <p
                    className={cn(
                      'mt-0.5 text-xs',
                      focused ? 'text-white' : 'text-gray-400',
                    )}
                  >
                    {model.description}
                  </p>
                )}
                {(model.inputCapability || model.timeEstimate) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {model.inputCapability && (
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5',
                          focused
                            ? 'border-white/25 text-white'
                            : 'border-adam-neutral-500 text-adam-text-secondary',
                        )}
                      >
                        {model.inputCapability}
                      </span>
                    )}
                    {model.timeEstimate && (
                      <span
                        className={cn(
                          focused ? 'text-white/80' : 'text-gray-500',
                        )}
                      >
                        {model.timeEstimate}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {selectedModel === model.id && (
                <Check
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    focused ? 'text-white' : 'text-adam-text-primary',
                  )}
                />
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CreativeAgentSelector({
  disabled,
  className,
  focused,
}: Pick<ModelSelectorProps, 'disabled' | 'className' | 'focused'>) {
  const { conversation, updateConversation } = useConversation();
  const { models: catalogModels, isLoading } = useParametricModelCatalog();
  const agentModels = useMemo(
    () => creativeAgentCandidates(catalogModels),
    [catalogModels],
  );
  const pinnedAgentModel = conversation.settings?.creativeAgentModel;
  const [selectedAgentModel, setSelectedAgentModel] = useState<Model>(
    () => pinnedAgentModel ?? readPreferredCreativeAgentModel() ?? '',
  );

  useEffect(() => {
    if (pinnedAgentModel) {
      setSelectedAgentModel(pinnedAgentModel);
      writePreferredCreativeAgentModel(pinnedAgentModel);
      return;
    }

    const preferred = resolvePreferredCreativeAgentModel(agentModels);
    if (!preferred) return;

    setSelectedAgentModel(preferred);
    writePreferredCreativeAgentModel(preferred);

    // Existing legacy Creative conversations may not have a controller pinned.
    // Pin the same deterministic fallback the picker shows so subsequent turns
    // do not depend on catalog ordering.
    if (conversation.id && updateConversation) {
      updateConversation({
        id: conversation.id,
        patch: { settings: { creativeAgentModel: preferred } },
      });
    }
  }, [agentModels, conversation, pinnedAgentModel, updateConversation]);

  const handleAgentModelChange = (modelId: Model) => {
    setSelectedAgentModel(modelId);
    writePreferredCreativeAgentModel(modelId);

    if (!conversation.id || !updateConversation) return;
    updateConversation({
      id: conversation.id,
      patch: { settings: { creativeAgentModel: modelId } },
    });
  };

  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-adam-text-secondary/70">
        AI
      </span>
      <ModelDropdown
        models={agentModels}
        selectedModel={selectedAgentModel}
        onModelChange={handleAgentModelChange}
        disabled={disabled || isLoading}
        className={className}
        currentType="parametric"
        focused={focused}
        registerBinding={false}
        emptyLabel={isLoading ? 'Loading AI…' : 'No AI model'}
      />
    </div>
  );
}

export function ModelSelector({
  models,
  selectedModel,
  onModelChange,
  className,
  disabled,
  type,
  focused = false,
  registerBinding = true,
}: ModelSelectorProps) {
  const { conversation } = useConversation();
  const currentType = type || conversation.type;

  if (currentType === 'creative' && registerBinding) {
    return (
      <div className="flex max-w-full flex-wrap items-center gap-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-adam-text-secondary/70">
            3D
          </span>
          <ModelDropdown
            models={models}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            disabled={disabled}
            className={className}
            currentType="creative"
            focused={focused}
            registerBinding
          />
        </div>
        <CreativeAgentSelector
          disabled={disabled}
          className={className}
          focused={focused}
        />
      </div>
    );
  }

  return (
    <ModelDropdown
      models={models}
      selectedModel={selectedModel}
      onModelChange={onModelChange}
      disabled={disabled}
      className={className}
      currentType={currentType}
      focused={focused}
      registerBinding={registerBinding}
    />
  );
}
