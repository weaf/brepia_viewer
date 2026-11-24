import { ChevronDown, Code2, Folder, Link2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BuiltInModel } from "@/services/localModelLibrary";
import { builtInModelRecordId } from "@/services/localModelLibrary";
import type { BuiltInGalleryCard } from "@/lib/builtInGalleryGroups";

type FolderCard = Extract<BuiltInGalleryCard, { kind: "folder" }>;

/** Keep the model preview visible while opening its file picker as a dropdown. */
export function BuiltInFolderCard({
  card,
  repositoryLabel,
  thumbnailUrl,
  disabled,
  onOpen,
  onOpenChainGenerator,
}: {
  card: FolderCard;
  repositoryLabel: string;
  thumbnailUrl?: string;
  disabled: boolean;
  onOpen: (entry: BuiltInModel) => void | Promise<void>;
  onOpenChainGenerator?: () => void;
}) {
  return (
    <article
      data-gallery-model-id={builtInModelRecordId(card.representative.path, card.repositoryId)}
      className="group flex min-h-64 flex-col border border-adam-neutral-700 bg-adam-background-1 transition-colors hover:border-adam-neutral-500"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={"Choose model from " + card.label + " folder"}
            disabled={disabled}
            className="flex min-h-64 w-full flex-col justify-between p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue disabled:cursor-wait disabled:opacity-60"
          >
            <div className="mb-4 flex aspect-[16/9] items-center justify-center overflow-hidden border border-adam-neutral-700/70 bg-adam-neutral-900/50">
              {thumbnailUrl ? (
                <img src={thumbnailUrl} alt={"Preview of " + card.label + " folder"} loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <Folder className="h-8 w-8 text-adam-neutral-600" aria-hidden="true" />
              )}
            </div>
            <div className="flex min-w-0 items-start gap-3">
              <Folder className="mt-0.5 h-4 w-4 shrink-0 text-adam-neutral-300" aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium">{card.label}</h3>
                <p className="mt-1 text-[10px] text-adam-neutral-400">
                  {repositoryLabel} / {card.folder}
                </p>
              </div>
            </div>
            <div className="mt-5 flex w-full items-center justify-between gap-2 text-[11px] text-adam-neutral-300">
              <span>
                {card.entries.length === card.totalCount
                  ? card.totalCount + " models"
                  : card.entries.length + " of " + card.totalCount + " models"}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-adam-text-primary">
                Choose model <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={4}
          className="max-h-[min(65vh,28rem)] w-[min(90vw,22rem)] overflow-y-auto p-1"
          aria-label={card.label + " models"}
        >
          <DropdownMenuLabel className="px-2 py-2 text-xs font-semibold text-adam-neutral-300">
            {card.label} · {card.entries.length} {card.entries.length === 1 ? "model" : "models"}
          </DropdownMenuLabel>
          {card.entries.map((entry) => (
            <DropdownMenuItem
              key={entry.repositoryId + ":" + entry.path}
              disabled={disabled}
              aria-label={"Open " + entry.path}
              onSelect={() => void onOpen(entry)}
              className="min-h-11 gap-3 rounded-md px-3 py-2 text-xs"
            >
              <Code2 className="h-4 w-4 shrink-0 text-adam-neutral-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words font-mono">
                {entry.path.slice(card.folder.length + 1)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {onOpenChainGenerator && (
        <div className="border-t border-adam-neutral-700 px-3 py-3">
          <button
            type="button"
            aria-label="Open chain generator"
            onClick={onOpenChainGenerator}
            className="flex min-h-11 w-full items-center gap-3 rounded-md border border-adam-neutral-600 bg-adam-neutral-800/70 px-3 py-2 text-left text-adam-text-primary transition-colors hover:border-adam-blue hover:bg-adam-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue"
          >
            <Link2 className="h-5 w-5 shrink-0 text-adam-neutral-200" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Chain generator</span>
              <span className="block text-[11px] text-adam-neutral-400">Experimental · Build a custom linked model</span>
            </span>
            <span className="shrink-0 text-xs text-adam-neutral-200">Open →</span>
          </button>
        </div>
      )}
    </article>
  );
}
