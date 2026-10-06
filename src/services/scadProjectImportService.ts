import { supabase } from '@/lib/supabase';
import {
  boundedScadCompileError,
  isBlockingScadCompileError,
  scadImportProjectPath,
  scadImportTitle,
  type ScadFolderAssetInput,
} from '@/lib/scadImport';
import { createOpenScadProjectAssetDescriptor } from '@/lib/openScadProjectAssetStorage';
import { persistImportedArtifact } from '@/services/importedArtifactService';
import { syncConversationWorkspace } from '@/services/conversationWorkspaceService';
import { previewScadColoredViaToolWorker } from '@/worker/toolWorker';
import type { ImportedArtifactBaseline } from '@shared/importedArtifact';
import type { ImportedArtifactOrigin } from '@shared/chatAi';
import {
  normalizeOpenScadProject,
  type OpenScadProject,
  type OpenScadProjectAsset,
} from '@shared/openScadProject';
import { validateOpenScadProjectAssetReferences } from '@shared/openScadProjectReferences';
import type { Model } from '@shared/types';

const OPENSCAD_ASSET_BUCKET = 'meshes';

type CreateImportedScadProjectBase = {
  userId: string;
  model: Model;
  executionMode: 'cli' | 'streaming';
  filename: string;
  origin: Omit<ImportedArtifactOrigin, 'type' | 'filename' | 'importedAt'>;
};

export type CreateImportedScadProjectInput = CreateImportedScadProjectBase &
  (
    | {
        code: string;
        project?: never;
        title?: never;
        assets?: never;
      }
    | {
        project: OpenScadProject;
        title: string;
        assets?: ScadFolderAssetInput[];
        code?: never;
      }
  );

export type CreateImportedScadProjectResult = {
  conversationId: string;
  baseline: ImportedArtifactBaseline;
};

function assetStoragePath(input: {
  userId: string;
  conversationId: string;
  projectPath: string;
}): string {
  const dot = input.projectPath.lastIndexOf('.');
  const slash = input.projectPath.lastIndexOf('/');
  const extension = dot > slash ? input.projectPath.slice(dot).toLowerCase() : '';
  return `${input.userId}/${input.conversationId}/openscad-assets/${crypto.randomUUID()}${extension}`;
}

async function removeUploadedAssets(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage
    .from(OPENSCAD_ASSET_BUCKET)
    .remove([...paths]);
  if (error) {
    console.warn('[SCAD import] Failed to clean up uploaded assets:', error);
  }
}

async function persistImportAssets(input: {
  userId: string;
  conversationId: string;
  assets: readonly ScadFolderAssetInput[];
}): Promise<{ descriptors: OpenScadProjectAsset[]; storagePaths: string[] }> {
  const descriptors: OpenScadProjectAsset[] = [];
  const storagePaths: string[] = [];

  try {
    for (const asset of input.assets) {
      const storagePath = assetStoragePath({
        userId: input.userId,
        conversationId: input.conversationId,
        projectPath: asset.path,
      });
      const blob = new Blob([new Uint8Array(asset.bytes)]);
      const descriptor = await createOpenScadProjectAssetDescriptor({
        path: asset.path,
        storagePath,
        blob,
      });
      const { error } = await supabase.storage
        .from(OPENSCAD_ASSET_BUCKET)
        .upload(storagePath, blob, {
          contentType: descriptor.mediaType,
          upsert: false,
        });
      if (error) {
        throw new Error(
          `Failed to store OpenSCAD project asset ${asset.path}: ${error.message}`,
        );
      }
      descriptors.push(descriptor);
      storagePaths.push(storagePath);
    }
    return { descriptors, storagePaths };
  } catch (error) {
    await removeUploadedAssets(storagePaths);
    throw error;
  }
}

export async function createImportedScadProject(
  input: CreateImportedScadProjectInput,
): Promise<CreateImportedScadProjectResult> {
  const { userId, model, executionMode, filename, origin } = input;

  let title: string;
  let project: OpenScadProject;
  const pendingAssets = input.project ? (input.assets ?? []) : [];
  if (input.project) {
    title = input.title;
    project = normalizeOpenScadProject(input.project);
  } else {
    if (typeof input.code !== 'string') {
      throw new Error('Imported OpenSCAD source is missing.');
    }
    title = scadImportTitle(filename);
    const entrypointPath = scadImportProjectPath(filename);
    project = normalizeOpenScadProject({
      schemaVersion: 1,
      entrypointPath,
      files: [{ path: entrypointPath, content: input.code }],
    });
  }

  const { data: aiPreferences, error: preferencesError } = await supabase
    .from('user_ai_preferences')
    .select('default_prompt_profile_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (preferencesError) {
    throw new Error(
      `Failed to load AI preferences: ${preferencesError.message}`,
    );
  }

  const conversationId = crypto.randomUUID();
  let uploadedStoragePaths: string[] = [];

  try {
    if (pendingAssets.length > 0) {
      const persistedAssets = await persistImportAssets({
        userId,
        conversationId,
        assets: pendingAssets,
      });
      uploadedStoragePaths = persistedAssets.storagePaths;
      project = normalizeOpenScadProject({
        ...project,
        assets: persistedAssets.descriptors,
      });
      validateOpenScadProjectAssetReferences(project);
    }

    let baseline: ImportedArtifactBaseline;
    try {
      await previewScadColoredViaToolWorker(
        project,
        project.assets?.length ? { userId, conversationId } : undefined,
      );
      baseline = { status: 'success' };
    } catch (error) {
      if (isBlockingScadCompileError(error)) throw error;
      baseline = {
        status: 'error',
        errorText: `Compilation failed:\n${boundedScadCompileError(error)}`,
      };
    }

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .insert({
        id: conversationId,
        user_id: userId,
        title,
        type: 'parametric',
        settings: {
          model,
          openCodeExecutionMode: executionMode,
          promptProfileId: aiPreferences?.default_prompt_profile_id ?? null,
        },
      })
      .select()
      .single();
    if (conversationError) {
      throw new Error(
        `Failed to create conversation: ${conversationError.message}`,
      );
    }
    if (!conversation) throw new Error('Failed to create conversation');

    try {
      await persistImportedArtifact({
        conversationId,
        artifact: { title, version: 'v1', project },
        origin: {
          type: 'import',
          source: origin.source,
          filename,
          importedAt: new Date().toISOString(),
          ...(origin.canonicalUrl ? { canonicalUrl: origin.canonicalUrl } : {}),
        },
        baseline,
      });
    } catch (error) {
      try {
        await supabase
          .from('conversations')
          .delete()
          .eq('id', conversationId)
          .eq('user_id', userId);
      } catch {
        // Preserve the authoritative persistence failure; cleanup is best-effort.
      }
      throw error;
    }

    try {
      await syncConversationWorkspace(conversationId);
    } catch (error) {
      // Workspace persistence is intentionally best-effort throughout Brepia.
      // A local filesystem problem must not turn an otherwise valid import into
      // a failed/rolled-back conversation.
      console.warn(
        `[conversation-workspace] Failed to sync imported SCAD ${conversationId}:`,
        error,
      );
    }

    return { conversationId, baseline };
  } catch (error) {
    await removeUploadedAssets(uploadedStoragePaths);
    throw error;
  }
}
