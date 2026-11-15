import { useRef, useState } from "react";
import { Download, FileUp, Plus, RefreshCw, Save, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SavedVariants } from "@/lib/openScadPresets";

/** Match the familiar OpenSCAD Customizer default naming while avoiding collisions. */
function nextVariantName(existingNames: readonly string[]): string {
  let index = 1;
  while (existingNames.includes(`New set ${index}`)) index += 1;
  return `New set ${index}`;
}

export function SavedVariantsPanel({
  saved,
  onCreate,
  onApply,
  onUpdate,
  onRename,
  onDelete,
  onReset,
  onImport,
  onExport,
}: {
  saved?: SavedVariants;
  onCreate: (name: string) => void;
  onApply: (name: string) => void;
  onUpdate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onReset: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
}) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const names = Object.keys(saved?.parameterSets ?? {});
  const selected = saved?.activeName ?? "";
  const autoName = nextVariantName(names);
  const submit = () => {
    if (renaming && !name.trim()) return;
    if (renaming) onRename(name.trim());
    else onCreate(name.trim() || autoName);
    setName("");
    setRenaming(false);
  };

  return (
    <section id="saved-variants-panel" data-testid="saved-variants-panel" aria-label="Saved variants" className="border-b border-adam-neutral-700 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold text-adam-text-primary">Saved variants</h2>
        <span className="text-[11px] text-adam-neutral-400">{names.length} presets</span>
      </div>
      <p className="mt-1 text-xs text-adam-neutral-400">
        Save parameter combinations for this model. Import and export standard OpenSCAD Customizer JSON.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select
          aria-label="Choose saved variant"
          value={selected}
          onChange={(event) => {
            if (event.target.value) onApply(event.target.value);
          }}
          className="h-11 w-full min-w-0 flex-1 rounded-md border border-adam-neutral-600 bg-adam-neutral-900 px-3 text-sm text-adam-text-primary"
        >
          <option value="">Current / unsaved parameters</option>
          {names.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <Button type="button" variant="outline" className="h-11 shrink-0" onClick={onReset} title="Restore the original model parameters">
          <RefreshCw className="mr-2 h-4 w-4" /> Original
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-11" disabled={!selected} onClick={onUpdate}>
          <Save className="mr-1.5 h-4 w-4" /> Update
        </Button>
        <Button type="button" variant="outline" className="h-11" disabled={!selected} onClick={() => {
          setName(selected);
          setRenaming(true);
        }}>
          <Pencil className="mr-1.5 h-4 w-4" /> Rename
        </Button>
        <Button type="button" variant="outline" className="h-11" disabled={!selected} onClick={onDelete}>
          <Trash2 className="mr-1.5 h-4 w-4" /> Delete
        </Button>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label={renaming ? "New variant name" : "Name for new variant"}
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
          placeholder={renaming ? "Rename selected variant" : `Name (optional: ${autoName})`}
          className="h-11 w-full min-w-0 flex-1"
        />
        <Button type="button" className="h-11 shrink-0" disabled={renaming && !name.trim()} onClick={submit}>
          <Plus className="mr-1.5 h-4 w-4" /> {renaming ? "Save name" : "Save new variant"}
        </Button>
        {renaming && (
          <Button type="button" variant="ghost" className="h-11" onClick={() => {
            setRenaming(false);
            setName("");
          }}>Cancel</Button>
        )}
      </div>
      {!renaming && (
        <p className="mt-1 text-xs text-adam-neutral-400">
          Leave the name empty to save as {autoName}. Existing variants are kept.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-adam-neutral-700/70 pt-3">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="OpenSCAD preset JSON file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onImport(file);
          }}
        />
        <Button type="button" variant="outline" className="h-11" onClick={() => fileRef.current?.click()}>
          <FileUp className="mr-1.5 h-4 w-4" /> Import JSON
        </Button>
        <Button type="button" variant="outline" className="h-11" disabled={names.length === 0} onClick={onExport}>
          <Download className="mr-1.5 h-4 w-4" /> Export JSON
        </Button>
      </div>
    </section>
  );
}
