import { useState } from "react";
import { Code2, Folder } from "lucide-react";
import type { BuiltInModel } from "@/services/localModelLibrary";
import { builtInModelRecordId } from "@/services/localModelLibrary";
import type { BuiltInGalleryCard } from "@/lib/builtInGalleryGroups";

type FolderCard = Extract<BuiltInGalleryCard, { kind: "folder" }>;

export function BuiltInFolderCard({
  card,
  repositoryLabel,
  thumbnailUrl,
  disabled,
  onOpen,
}: {
  card: FolderCard;
  repositoryLabel: string;
  thumbnailUrl?: string;
  disabled: boolean;
  onOpen: (entry: BuiltInModel) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article
      data-gallery-model-id={builtInModelRecordId(card.representative.path, card.repositoryId)}
      className="group flex min-h-64 flex-col border border-adam-neutral-700 bg-adam-background-1 transition-colors hover:border-adam-neutral-500"
    >
      <button
        type="button"
        aria-label={"Open " + card.label + " folder"}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex min-h-64 w-full flex-col justify-between p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue"
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
        <div className="mt-5 flex items-center justify-between gap-2 text-[11px] text-adam-neutral-300">
          <span>
            {card.entries.length === card.totalCount
              ? card.totalCount + " models"
              : card.entries.length + " of " + card.totalCount + " models"}
          </span>
          <span>{expanded ? "Hide files ↑" : "Choose model ↓"}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-adam-neutral-700 px-3 pb-3 pt-2" aria-label={card.label + " models"}>
          <ul className="space-y-1">
            {card.entries.map((entry) => (
              <li key={entry.repositoryId + ":" + entry.path}>
                <button
                  type="button"
                  aria-label={"Open " + entry.path}
                  disabled={disabled}
                  onClick={() => void onOpen(entry)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-adam-neutral-200 transition-colors hover:bg-adam-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue disabled:opacity-60"
                >
                  <Code2 className="h-4 w-4 shrink-0 text-adam-neutral-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1 break-all font-mono">{entry.path.slice(card.folder.length + 1)}</span>
                  <span className="shrink-0 text-adam-neutral-400">View →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
