import { GitHubIcon } from "@/components/icons/CompanyIcons";

export function RepositoryLink() {
  return (
    <a
      href="https://github.com/weaf/brepia_viewer"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View Brepia Viewer repository on GitHub"
      title="View source code on GitHub (opens in a new tab)"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-md border border-adam-neutral-700 p-0 text-xs font-medium sm:w-auto sm:px-3 text-adam-neutral-200 transition-colors hover:border-adam-neutral-500 hover:bg-adam-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue"
    >
      <GitHubIcon className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">GitHub</span>
    </a>
  );
}
