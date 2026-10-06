import { Box, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BrepProjectArtifactData } from '@shared/chatAi';

export function BrepIterationModelCard({
  artifact,
  loaded,
  active,
  disabled = false,
  onLoad,
}: {
  artifact: BrepProjectArtifactData;
  loaded: boolean;
  active: boolean;
  disabled?: boolean;
  onLoad: () => void;
}) {
  return (
    <div className="ml-11 min-w-0 max-w-[calc(100%-2.75rem)]">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-pressed={loaded}
        aria-label={`${loaded ? 'Loaded' : 'Load'} BRep model ${artifact.title}`}
        onClick={onLoad}
        className="h-auto w-full min-w-0 justify-start gap-2 rounded-lg border-adam-neutral-700 bg-adam-neutral-900 px-3 py-2 text-left text-adam-text-primary hover:bg-adam-neutral-800"
      >
        {loaded ? (
          <Check className="h-4 w-4 shrink-0 text-adam-blue" />
        ) : (
          <Box className="h-4 w-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
        <span className="shrink-0 text-[10px] text-adam-neutral-400">
          {loaded ? (active ? 'Active model' : 'Loaded') : 'Load model'}
        </span>
      </Button>
    </div>
  );
}
