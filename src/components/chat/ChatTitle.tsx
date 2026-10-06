import { ChevronDown, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useState, useEffect, useRef } from 'react';
import { useConversation } from '@/contexts/ConversationContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Share as ShareIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { ShareContent } from '@/components/ui/ShareContent';
import {
  DEFAULT_AI_INSTRUCTION_PROFILE_ID,
  getAiInstructionProfileDefinition,
} from '@shared/aiInstructionCatalog';
import type { OpenScadProject } from '@shared/openScadProject';

interface ChatTitleProps {
  activeMeshId?: string | null;
  activeOpenscadProject?: OpenScadProject | null;
}

function InstructionProfileBadge({ label }: { label: string }) {
  return (
    <span
      className="shrink-0 rounded-full border border-adam-neutral-700 px-2 py-0.5 text-[10px] font-medium leading-none text-adam-neutral-300"
      title={`AI profile: ${label}`}
    >
      {label}
    </span>
  );
}

export function ChatTitle({
  activeMeshId,
  activeOpenscadProject,
}: ChatTitleProps = {}) {
  const { conversation, updateConversation } = useConversation();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(conversation.title);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const isParametric = conversation.type === 'parametric';
  const instructionProfileId =
    conversation.settings?.instructionProfileId ??
    DEFAULT_AI_INSTRUCTION_PROFILE_ID;
  const instructionProfileLabel =
    getAiInstructionProfileDefinition(instructionProfileId)?.label ??
    instructionProfileId;

  // Keep local state in sync when switching conversations quickly
  useEffect(() => {
    setTitleInput(conversation.title);
    // Don't reset isEditingTitle here to allow animation to complete if triggered externally
  }, [conversation.id, conversation.title]);

  const handleTitleSave = () => {
    if (titleInput.trim() === '' || titleInput.trim() === conversation.title) {
      setTitleInput(conversation.title);
      setIsEditingTitle(false);
      return;
    }

    updateConversation?.(
      {
        id: conversation.id,
        patch: { title: titleInput.trim() },
      },
      {
        onSettled() {
          setIsEditingTitle(false);
        },
        onError(error) {
          console.error('Error updating title:', error);
          setTitleInput(conversation.title); // Revert on error
          setIsEditingTitle(false); // Or keep editing, TBD by UX preference
        },
      },
    );
  };

  const animationProps = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.12 },
  };

  const handleInputAnimationComplete = () => {
    if (isEditingTitle) {
      inputRef.current?.select();
    }
  };

  const handlePrivacyChange = (privacy: 'public' | 'private') => {
    updateConversation?.({
      id: conversation.id,
      patch: { privacy },
    });
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          {isEditingTitle ? (
            <motion.div
              key="editing-title-input"
              className="h-8 w-full"
              {...animationProps}
              onAnimationComplete={handleInputAnimationComplete}
            >
              <div className="flex h-8 w-full items-center gap-2">
                <Input
                  ref={inputRef}
                  className={cn(
                    'h-8 w-full bg-transparent px-2 text-left text-[17px] font-medium leading-tight tracking-tight text-adam-neutral-10 selection:bg-adam-blue/50 selection:text-white',
                    'rounded-none border-x-0 border-b-2 border-t-0 border-adam-neutral-500',
                    'focus:border-adam-neutral-500 focus:outline-none focus:ring-0',
                    isParametric && isMobile && 'text-center',
                  )}
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleTitleSave();
                    } else if (e.key === 'Escape') {
                      setTitleInput(conversation.title);
                      setIsEditingTitle(false);
                    }
                  }}
                  onBlur={handleTitleSave}
                  autoFocus
                />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="display-title"
              className={cn(
                'h-8 w-full',
                isParametric && isMobile && 'flex items-center justify-center',
              )}
              {...animationProps}
            >
              {updateConversation ? (
                <>
                  {isMobile ? (
                    // The Dialog wrapper is always needed for mobile here for the ShareDialogContent
                    <Dialog>
                      <DropdownMenu
                        open={isMenuOpen}
                        onOpenChange={setIsMenuOpen}
                      >
                        <DropdownMenuTrigger asChild>
                          <div
                            className={cn(
                              'flex h-8 w-fit max-w-full cursor-pointer items-center justify-center gap-1 overflow-hidden rounded p-0 px-2 text-[17px] font-medium tracking-tight text-adam-neutral-10 transition-colors duration-200',
                              isMenuOpen
                                ? 'bg-black text-adam-neutral-0'
                                : 'hover:bg-black hover:text-adam-neutral-0',
                            )}
                          >
                            <span
                              className={cn(
                                'line-clamp-1 min-w-0 select-text',
                                isParametric && 'text-center',
                              )}
                            >
                              {conversation.title || 'Chat'}
                            </span>
                            <ChevronDown className="h-4 w-4 min-w-4" />
                            <InstructionProfileBadge
                              label={instructionProfileLabel}
                            />
                          </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="center"
                          onCloseAutoFocus={(e) => e.preventDefault()}
                        >
                          <DropdownMenuItem
                            className="text-adam-neutral-200 hover:text-adam-neutral-100"
                            onClick={() => setIsEditingTitle(true)}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Rename
                          </DropdownMenuItem>
                          <DialogTrigger asChild>
                            <DropdownMenuItem className="text-adam-neutral-200 hover:text-adam-neutral-100">
                              <ShareIcon className="mr-2 h-4 w-4" />
                              Share
                            </DropdownMenuItem>
                          </DialogTrigger>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <DialogContent className="mx-auto flex max-h-dvh w-[calc(100%-2rem)] flex-col items-center gap-8 rounded-lg border border-adam-neutral-800 text-adam-text-primary">
                        <DialogTitle className="hidden">
                          Share public link to chat
                        </DialogTitle>
                        <DialogDescription className="hidden">
                          Share public link to chat
                        </DialogDescription>
                        <ShareContent
                          conversationId={conversation.id}
                          privacy={conversation.privacy}
                          onPrivacyChange={handlePrivacyChange}
                          meshId={activeMeshId ?? undefined}
                          openscadProject={activeOpenscadProject ?? undefined}
                        />
                      </DialogContent>
                    </Dialog>
                  ) : (
                    // Desktop view: Click to edit
                    <div className="flex h-8 w-fit max-w-full items-center gap-2 rounded font-medium tracking-tight text-adam-neutral-10 transition-colors duration-200 hover:bg-black hover:text-adam-neutral-0">
                      <span
                        className={cn(
                          'line-clamp-1 min-w-0 cursor-pointer px-2 text-left text-[17px]',
                          isParametric && 'text-center',
                        )}
                        onClick={() => setIsEditingTitle(true)}
                      >
                        {conversation.title || 'Chat'}
                      </span>
                      <InstructionProfileBadge
                        label={instructionProfileLabel}
                      />
                    </div>
                  )}
                </>
              ) : (
                // Fallback if no updateConversation (e.g., view-only mode)
                <div className="flex h-8 w-fit max-w-full items-center gap-2 rounded font-medium tracking-tight text-adam-neutral-10">
                  <span
                    className={cn(
                      'line-clamp-1 min-w-0 px-2 text-left text-[17px]',
                      isParametric && 'text-center',
                    )}
                  >
                    {conversation.title || 'Chat'}
                  </span>
                  <InstructionProfileBadge label={instructionProfileLabel} />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
