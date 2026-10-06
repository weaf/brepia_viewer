import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator } from '@/components/brand';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  AI_INSTRUCTION_PROFILE_DEFINITIONS,
  DEFAULT_AI_INSTRUCTION_PROFILE_ID,
} from '@shared/aiInstructionCatalog';
import {
  getAiPreferences,
  updateDefaultInstructionProfile,
} from '@/services/aiPreferencesService';

export function InstructionProfileSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const {
    data: preferences,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['ai-preferences', 'defaults'],
    queryFn: getAiPreferences,
    staleTime: 0,
  });

  const mutation = useMutation({
    mutationFn: updateDefaultInstructionProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-preferences'] });
      toast({
        title: 'AI profile saved',
        description:
          'New AI work will use the selected repository-backed instruction profile.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save the AI instruction profile.',
        variant: 'destructive',
      });
    },
  });

  const selectedId =
    preferences?.defaultInstructionProfileId ??
    DEFAULT_AI_INSTRUCTION_PROFILE_ID;
  const selected = AI_INSTRUCTION_PROFILE_DEFINITIONS.find(
    (profile) => profile.id === selectedId,
  );

  return (
    <section className="rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-4 sm:p-6">
      <div className="mb-5">
        <h2 className="text-sm font-medium text-adam-neutral-50">AI profile</h2>
        <p className="mt-1 text-xs leading-relaxed text-adam-neutral-400">
          Choose the complete Brepia instruction package independently from the
          model. A profile controls the agent, tools, vision, context,
          suggestions, transports and provider instructions. Custom prompt
          overrides remain a separate layer on top.
        </p>
      </div>

      {error ? (
        <div className="text-adam-red-400 text-sm">
          Failed to load AI profile settings.
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-6">
          <ActivityIndicator label="Loading AI profiles" />
        </div>
      ) : (
        <div className="space-y-4">
          <Select
            value={selectedId}
            disabled={mutation.isPending}
            onValueChange={(value) => mutation.mutate(value)}
          >
            <SelectTrigger className="w-full sm:max-w-md">
              <SelectValue placeholder="Select AI profile" />
            </SelectTrigger>
            <SelectContent>
              {AI_INSTRUCTION_PROFILE_DEFINITIONS.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selected ? (
            <div className="max-w-2xl rounded-lg border border-adam-neutral-800 bg-adam-neutral-900/30 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-adam-neutral-50">
                  {selected.label}
                </div>
                <span className="rounded-full border border-adam-neutral-700 px-2 py-0.5 text-[11px] text-adam-neutral-400">
                  Brepia managed
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-adam-neutral-400">
                {selected.description}
              </p>
              {selected.lineage ? (
                <p className="mt-2 text-[11px] text-adam-neutral-500">
                  Source: {selected.lineage.project} ·{' '}
                  {selected.lineage.revision}
                </p>
              ) : selected.origin ? (
                <p className="mt-2 text-[11px] text-adam-neutral-500">
                  Origin: {selected.origin.profile} · {selected.origin.revision}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
