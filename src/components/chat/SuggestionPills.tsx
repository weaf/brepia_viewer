import { Button } from '@/components/ui/button';
import { useConversation } from '@/contexts/ConversationContext';
import { registerChatTextSubmitter } from '@/lib/chatSubmitBridge';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';

interface SuggestionPillsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  disabled?: boolean;
}

export function SuggestionPills({
  disabled,
  suggestions,
  onSelect,
}: SuggestionPillsProps) {
  const { conversation } = useConversation();

  useEffect(
    () =>
      registerChatTextSubmitter(conversation.id, (text) => {
        if (disabled) return false;
        onSelect(text);
        return true;
      }),
    [conversation.id, disabled, onSelect],
  );

  if (!suggestions.length) return null;

  return (
    <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {suggestions.map((suggestion, index) => (
        <Button
          key={index}
          variant="outline"
          size="sm"
          className={cn(
            'shrink-0 rounded-full border border-adam-neutral-700 bg-adam-neutral-800 text-xs text-white hover:text-white hover:opacity-80',
            disabled ? 'opacity-50' : '',
          )}
          onClick={() => onSelect(suggestion)}
          disabled={disabled}
        >
          {suggestion}
        </Button>
      ))}
    </div>
  );
}
