import { Check, ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  AI_INSTRUCTION_PROFILE_DEFINITIONS,
  isAiInstructionProfileId,
  type AiInstructionProfileId,
} from '@shared/aiInstructionCatalog';

type InstructionProfileSelectorProps = {
  selectedProfileId: AiInstructionProfileId;
  onProfileChange: (profileId: AiInstructionProfileId) => void;
  disabled?: boolean;
  focused?: boolean;
  className?: string;
};

export function InstructionProfileSelector({
  selectedProfileId,
  onProfileChange,
  disabled = false,
  focused = false,
  className,
}: InstructionProfileSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const openedWithPointerRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = AI_INSTRUCTION_PROFILE_DEFINITIONS.find(
    (profile) => profile.id === selectedProfileId,
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          disabled={disabled}
          onPointerDown={() => {
            openedWithPointerRef.current = true;
          }}
          onKeyDown={() => {
            openedWithPointerRef.current = false;
          }}
          className={cn(
            'flex h-8 w-auto min-w-0 items-center gap-1.5 rounded-lg px-3 text-sm transition-all duration-200 hover:bg-adam-neutral-800',
            focused
              ? 'text-white hover:text-white'
              : 'text-adam-text-secondary hover:text-adam-text-primary',
            isOpen && 'bg-adam-neutral-800 text-adam-text-primary',
            className,
          )}
        >
          <span className="hidden text-[11px] text-adam-neutral-500 sm:inline">
            Profile
          </span>
          <span className="truncate font-normal">
            {selected?.label ?? selectedProfileId}
          </span>
          <ChevronDown
            className={cn(
              'ml-1 h-4 w-4 shrink-0 opacity-70 transition-transform duration-200',
              isOpen && 'rotate-180',
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg bg-adam-neutral-700 p-1"
        onCloseAutoFocus={(event) => {
          if (openedWithPointerRef.current) {
            event.preventDefault();
            openedWithPointerRef.current = false;
            triggerRef.current?.blur();
          }
        }}
      >
        {AI_INSTRUCTION_PROFILE_DEFINITIONS.map((profile) => (
          <DropdownMenuItem
            key={profile.id}
            className={cn(
              'cursor-pointer rounded-md bg-adam-neutral-700 px-3 py-2.5 transition-colors duration-150 focus:bg-adam-bg-secondary-dark',
              selectedProfileId === profile.id && 'bg-adam-neutral-800',
            )}
            onClick={(event) => {
              if (isAiInstructionProfileId(profile.id)) {
                onProfileChange(profile.id);
              }
              setIsOpen(false);
              event.stopPropagation();
            }}
          >
            <div className="flex w-full items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-adam-text-primary">
                    {profile.label}
                  </span>
                  <span className="rounded-full border border-adam-neutral-500 px-1.5 py-0.5 text-[10px] text-adam-neutral-400">
                    Brepia
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-gray-400">
                  {profile.description}
                </p>
              </div>
              {selectedProfileId === profile.id && (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-adam-text-primary" />
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
