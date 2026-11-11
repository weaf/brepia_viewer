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
  enabled,
  onEnabledChange,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <DropdownMenu>
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
          {enabled && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-label="Experimental enabled" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-1rem)] p-1">
        <DropdownMenuLabel className="px-3 py-2">Experimental features</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={enabled}
          onCheckedChange={(checked) => onEnabledChange(checked === true)}
          className="min-h-14 rounded-md border border-transparent px-2 py-2 pl-8 focus:bg-adam-neutral-800 focus:text-adam-neutral-100"
          aria-label="Enable Experimental mode"
        >
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">Enable Experimental</span>
            <span className="text-xs leading-snug text-adam-neutral-300">
              Show preview-only tools on any rendered model. Visual changes are not saved or exported.
            </span>
          </span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
