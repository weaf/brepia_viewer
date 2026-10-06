import { Box, GitBranch } from 'lucide-react';
import { BrepGrasshopperImportButton } from '@/components/brep/BrepGrasshopperImportButton';
import { BrepProjectViewerPanel } from '@/components/brep/BrepProjectEditor';
import {
  BREP_GRAPH_WORKSPACE_TARGET_ID,
  useBrepFeatureWorkspace,
} from '@/components/brep/BrepFeatureWorkspace';
import { Button } from '@/components/ui/button';

export function BrepProjectWorkspacePanel({
  isMobile = false,
  readOnly = false,
}: {
  isMobile?: boolean;
  readOnly?: boolean;
}) {
  const { view, setView } = useBrepFeatureWorkspace();

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-adam-neutral-800">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-adam-neutral-700 bg-adam-bg-secondary-dark/95 px-3 sm:px-4">
        <div className="flex items-center gap-1 rounded-lg border border-adam-neutral-700 bg-adam-neutral-900/70 p-0.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={view === 'model'}
            onClick={() => setView('model')}
            className={`h-7 gap-1.5 px-2.5 text-xs ${
              view === 'model'
                ? 'bg-adam-neutral-700 text-adam-text-primary'
                : 'text-adam-neutral-400'
            }`}
          >
            <Box className="h-3.5 w-3.5" />
            Model
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={view === 'graph'}
            onClick={() => setView('graph')}
            className={`h-7 gap-1.5 px-2.5 text-xs ${
              view === 'graph'
                ? 'bg-adam-neutral-700 text-adam-text-primary'
                : 'text-adam-neutral-400'
            }`}
          >
            <GitBranch className="h-3.5 w-3.5" />
            Graph
          </Button>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden text-[10px] text-adam-neutral-500 xl:inline">
            {readOnly
              ? 'Historical BRep preview · read only'
              : view === 'model'
                ? 'Primary BRep result'
                : 'Feature dependency graph'}
          </span>
          <BrepGrasshopperImportButton disabled={readOnly} />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {view === 'model' ? (
          <BrepProjectViewerPanel isMobile={isMobile} />
        ) : (
          <div
            id={BREP_GRAPH_WORKSPACE_TARGET_ID}
            className="h-full min-h-0 w-full overflow-hidden bg-adam-neutral-900 p-3 sm:p-4"
          />
        )}
      </div>
    </div>
  );
}
