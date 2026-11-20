import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ExperimentalMenu({
  fastPreviewEnabled,
  onFastPreviewChange,
  sourceMoveEnabled,
  onSourceMoveChange,
}: {
  fastPreviewEnabled: boolean;
  onFastPreviewChange: (enabled: boolean) => void;
  sourceMoveEnabled: boolean;
  onSourceMoveChange: (enabled: boolean) => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Experimental menu"
          title="Experimental features"
          className="h-11 min-h-11 shrink-0 gap-1.5 border-adam-neutral-700 px-2.5"
        >
          <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden text-[11px] sm:inline">Experimental</span>
          {(fastPreviewEnabled || sourceMoveEnabled) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-label="An experimental tool is active" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-1rem)] p-1">
        <DropdownMenuLabel className="px-3 py-2">Experimental features</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={fastPreviewEnabled}
          onCheckedChange={(checked) => onFastPreviewChange(checked === true)}
          className="min-h-14 rounded-md border border-transparent px-2 py-2 pl-8 focus:bg-adam-neutral-800 focus:text-adam-neutral-100"
          aria-label="Enable fast STL-only preview"
        >
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">Fast STL preview</span>
            <span className="text-xs leading-snug text-adam-neutral-300">
              Faster preview without part colors. Orca Color export remains available.
            </span>
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={sourceMoveEnabled}
          onCheckedChange={(checked) => onSourceMoveChange(checked === true)}
          className="min-h-14 rounded-md border border-transparent px-2 py-2 pl-8 focus:bg-adam-neutral-800 focus:text-adam-neutral-100"
          aria-label="Enable source-aware Part Move"
        >
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">Source Move</span>
            <span className="text-xs leading-snug text-adam-neutral-300">
              Find the SCAD code behind a moved part and verify before applying.
            </span>
          </span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
