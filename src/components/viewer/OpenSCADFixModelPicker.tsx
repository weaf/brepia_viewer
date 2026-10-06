import { ModelSelector } from '@/components/ModelSelector';
import { useConversation } from '@/contexts/ConversationContext';
import { useConversationModelPicker } from '@/lib/modelPickerBridge';

export function OpenSCADFixModelPicker() {
  const { conversation } = useConversation();
  const binding = useConversationModelPicker(conversation.id);

  if (
    !binding ||
    binding.type !== 'parametric' ||
    binding.models.length === 0
  ) {
    return null;
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-xs text-adam-text-primary/60">
        Choose the AI model for this repair
      </span>
      <ModelSelector
        models={binding.models}
        selectedModel={binding.selectedModel}
        onModelChange={binding.onModelChange}
        disabled={binding.disabled}
        type="parametric"
        focused
        registerBinding={false}
        className="border-adam-neutral-600 border bg-adam-neutral-800"
      />
    </div>
  );
}
