import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { downloadFile } from "@/utils/downloadUtils";
import { getSafeFilename } from "@/utils/file-utils";
import {
  saveLocalModel,
  type LocalModelRecord,
} from "@/services/localModelLibrary";
import {
  applyParameterSet,
  captureCustomizerValues,
  createSavedVariants,
  mergeImportedVariants,
  parseOpenScadPresetJson,
  serializeOpenScadPresetJson,
  validateVariantName,
  type SavedVariants,
} from "@/lib/openScadPresets";

type Notify = (details: {
  title: string;
  description: string;
  variant?: "destructive";
}) => unknown;

type ActionsConfig = {
  activeRecord: LocalModelRecord | null;
  activeRecordRef: MutableRefObject<LocalModelRecord | null>;
  saveQueueRef: MutableRefObject<Promise<void>>;
  setActiveRecord: Dispatch<SetStateAction<LocalModelRecord | null>>;
  refreshLocalModels: () => Promise<void>;
  toast: Notify;
};

/** Uses the existing per-model IndexedDB record and serialized parameter write queue. */
export function createSavedVariantActions(config: ActionsConfig) {
  const current = () => config.activeRecordRef.current ?? config.activeRecord;

  const sourceOf = (record: LocalModelRecord): string => {
    const source = record.project.files.find(file =>
      file.path === record.project.entrypointPath);
    if (!source) throw new Error("OpenSCAD entrypoint is missing.");
    return source.content;
  };

  const variantsOf = (record: LocalModelRecord): SavedVariants => {
    if (record.savedVariants) return record.savedVariants;
    const baselineSource = record.baseProject?.files.find(file =>
      file.path === record.project.entrypointPath)?.content;
    return createSavedVariants(baselineSource ?? sourceOf(record));
  };

  const errorToast = (cause: unknown) => {
    config.toast({
      title: "Saved variants",
      description: cause instanceof Error ? cause.message : "Could not update variants.",
      variant: "destructive",
    });
  };

  const commit = async (
    record: LocalModelRecord,
    project: LocalModelRecord["project"],
    savedVariants: SavedVariants,
    title: string,
    description: string,
    skipped: string[] = [],
  ): Promise<void> => {
    const next: LocalModelRecord = {
      ...record, project, savedVariants, updatedAt: new Date().toISOString(),
    };
    config.activeRecordRef.current = next;
    config.setActiveRecord(next);
    const write = config.saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await saveLocalModel(next);
        if (next.origin === "upload") await config.refreshLocalModels();
      });
    config.saveQueueRef.current = write;
    try {
      await write;
      config.toast({
        title,
        description: skipped.length
          ? description + " Skipped incompatible or unknown parameter(s): " +
            skipped.slice(0, 5).join(", ") +
            (skipped.length > 5 ? "…" : "")
          : description,
      });
    } catch (cause) {
      errorToast(cause);
    }
  };

  const attempt = (run: (record: LocalModelRecord, saved: SavedVariants) => void) => {
    try {
      const record = current();
      if (!record) return;
      run(record, variantsOf(record));
    } catch (cause) {
      errorToast(cause);
    }
  };

  const create = (name: string) => attempt((record, saved) => {
    const validated = validateVariantName(name);
    if (Object.prototype.hasOwnProperty.call(saved.parameterSets, validated)) {
      throw new Error("A variant with that name already exists.");
    }
    const values = captureCustomizerValues(sourceOf(record));
    if (!Object.keys(values).length) throw new Error("No Customizer parameters found.");
    void commit(record, record.project, {
      ...saved,
      parameterSets: { ...saved.parameterSets, [validated]: values },
      activeName: validated,
    }, "Variant saved", '"' + validated + '" saved for this model.');
  });

  const select = (name: string) => attempt((record, saved) => {
    if (!Object.prototype.hasOwnProperty.call(saved.parameterSets, name)) throw new Error("Variant does not exist.");
    // OpenSCAD presets are overlays on the model defaults, not cumulative edits.
    // Omitted keys revert to the original parameter values when switching presets.
    const result = applyParameterSet(record.project, {
      ...saved.originalParameters,
      ...saved.parameterSets[name],
    });
    void commit(record, result.project, { ...saved, activeName: name },
      "Variant applied", '"' + name + '" applied to the Customizer and 3D model.',
      result.skipped);
  });

  const update = () => attempt((record, saved) => {
    const name = saved.activeName;
    if (!name || !Object.prototype.hasOwnProperty.call(saved.parameterSets, name)) {
      throw new Error("Choose a saved variant to update.");
    }
    void commit(record, record.project, {
      ...saved,
      parameterSets: { ...saved.parameterSets, [name]: captureCustomizerValues(sourceOf(record)) },
    }, "Variant updated", '"' + name + '" now contains the current parameters.');
  });

  const rename = (newName: string) => attempt((record, saved) => {
    const oldName = saved.activeName;
    if (!oldName || !Object.prototype.hasOwnProperty.call(saved.parameterSets, oldName)) {
      throw new Error("Choose a variant to rename.");
    }
    const name = validateVariantName(newName);
    if (name !== oldName && Object.prototype.hasOwnProperty.call(saved.parameterSets, name)) {
      throw new Error("A variant with that name already exists.");
    }
    const renamed = Object.fromEntries(Object.entries(saved.parameterSets)
      .map(([key, value]) => [key === oldName ? name : key, value]));
    void commit(record, record.project, {
      ...saved, parameterSets: renamed, activeName: name,
    }, "Variant renamed", '"' + oldName + '" renamed to "' + name + '".');
  });

  const remove = () => attempt((record, saved) => {
    const name = saved.activeName;
    if (!name || !Object.prototype.hasOwnProperty.call(saved.parameterSets, name)) {
      throw new Error("Choose a variant to delete.");
    }
    if (!window.confirm('Delete "' + name + '"? The current model will remain unchanged.')) return;
    const rest = Object.fromEntries(Object.entries(saved.parameterSets)
      .filter(([key]) => key !== name));
    void commit(record, record.project, {
      ...saved, parameterSets: rest, activeName: null,
    }, "Variant deleted", '"' + name + '" deleted without changing the model.');
  });

  const reset = () => attempt((record, saved) => {
    const result = applyParameterSet(record.project, saved.originalParameters);
    void commit(record, result.project, { ...saved, activeName: null },
      "Original parameters restored", "Source edits outside Customizer were preserved.",
      result.skipped);
  });

  const importJson = async (file: File) => {
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("JSON file exceeds 2 MB.");
      const imported = parseOpenScadPresetJson(await file.text());
      if (!Object.keys(imported).length) throw new Error("No variants in this JSON file.");
      const record = current();
      if (!record) return;
      const saved = variantsOf(record);
      await commit(record, record.project, {
        ...saved,
        parameterSets: mergeImportedVariants(saved.parameterSets, imported),
      }, "Variants imported",
      Object.keys(imported).length + " variant(s) added. Existing presets are safe.");
    } catch (cause) {
      errorToast(cause);
    }
  };

  const exportJson = () => attempt((record, saved) => {
    if (!Object.keys(saved.parameterSets).length) {
      throw new Error("Save or import a variant before exporting.");
    }
    downloadFile({
      content: serializeOpenScadPresetJson(saved.parameterSets),
      filename: getSafeFilename(record.name, "model") + ".json",
      mimeType: "application/json",
    });
  });

  return { create, select, update, rename, remove, reset, importJson, exportJson };
}
