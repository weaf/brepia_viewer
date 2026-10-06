import { tool, type InferUITools, type UIMessage } from 'ai';
import { z } from 'zod';
import { loadBundledInstruction } from './aiInstructionCatalog.ts';
import {
  brepAiBuildOutputSchema,
  brepAiBuildProviderInputSchema,
} from './brepAiTool.ts';
import {
  OPENSCAD_PROJECT_MAX_ASSETS,
  OPENSCAD_PROJECT_MAX_FILES,
  OPENSCAD_PROJECT_SCHEMA_VERSION,
  normalizeOpenScadProject,
  type OpenScadProject,
  type OpenScadProjectAsset,
} from './openScadProject.ts';
import type { MeshFileType, Model } from './types.ts';
import {
  normalizeParametricProjectSource,
  type ParametricProjectSource,
  type ParametricProjectSourceInput,
} from './parametricProjectSource.ts';
import type { ProjectOrigin } from './projectOrigin.ts';

export const createMeshInputSchema = z.object({
  text: z.string().optional(),
  imageIds: z.array(z.string()).optional(),
  meshId: z.string().optional(),
  // Reserved compatibility field. The selected Creative mesh backend belongs
  // to Brepia's conversation/UI state, not to the LLM. Keeping an optional
  // never-field preserves the existing execute typing while preventing an
  // agent from silently overriding Hunyuan/TRELLIS/SF3D/fal selection.
  model: z.never().optional(),
  meshTopology: z.enum(['quads', 'polys']).optional(),
  polygonCount: z.number().optional(),
});

export const createMeshOutputSchema = z.object({
  id: z.string(),
  fileType: z.enum(['glb', 'stl', 'obj', 'fbx']),
});

const openScadProjectFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const openScadProjectAssetSchema = z.object({
  path: z.string().min(1),
  storagePath: z.string().min(1),
  mediaType: z.enum([
    'model/stl',
    'text/plain',
    'application/dxf',
    'image/svg+xml',
  ]),
  byteLength: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const openScadProjectSchema = z
  .object({
    schemaVersion: z.literal(OPENSCAD_PROJECT_SCHEMA_VERSION),
    entrypointPath: z.string().min(1),
    files: z
      .array(openScadProjectFileSchema)
      .min(1)
      .max(OPENSCAD_PROJECT_MAX_FILES),
    assets: z
      .array(openScadProjectAssetSchema)
      .max(OPENSCAD_PROJECT_MAX_ASSETS)
      .optional(),
  })
  .superRefine((project, context) => {
    try {
      normalizeOpenScadProject(project as OpenScadProject);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          error instanceof Error
            ? error.message
            : 'Invalid OpenSCAD project snapshot.',
      });
    }
  });

export const parametricArtifactSchema = z.object({
  title: z.string().min(1),
  version: z.string().default('v1'),
  project: openScadProjectSchema,
});

/**
 * Persisted project-source boundary shared by the Phase 2 lifecycle. It is
 * intentionally separate from the OpenSCAD-only AI build tool until Phase 3
 * explicitly authorizes AI-native BRep editing.
 */
export const parametricProjectSourceSchema =
  z.custom<ParametricProjectSourceInput>((value) => {
    try {
      normalizeParametricProjectSource(value);
      return true;
    } catch {
      return false;
    }
  }, 'Invalid parametric project source.');

export const parametricCompileOutputSchema = z.object({
  status: z.literal('success'),
  message: z.string(),
  inspection: z
    .object({
      views: z.array(
        z.enum(['ISO', 'FRONT', 'BACK', 'LEFT', 'RIGHT', 'TOP', 'BOTTOM']),
      ),
      imageAttached: z.boolean(),
    })
    .optional(),
});

export const answerUserSchema = z.object({
  message: z.string().min(1),
});

export const chatTools = {
  build_parametric_model: tool({
    description: loadBundledInstruction('tool.build_parametric_model'),
    inputSchema: parametricArtifactSchema,
    outputSchema: parametricCompileOutputSchema,
  }),
  build_brep_project: tool({
    description: loadBundledInstruction('tool.build_brep_project'),
    inputSchema: brepAiBuildProviderInputSchema,
    outputSchema: brepAiBuildOutputSchema,
  }),
  answer_user: tool({
    description: loadBundledInstruction('tool.answer_user'),
    inputSchema: answerUserSchema,
    outputSchema: answerUserSchema,
  }),
  create_mesh: tool({
    description: loadBundledInstruction('tool.create_mesh'),
    inputSchema: createMeshInputSchema,
    outputSchema: createMeshOutputSchema,
  }),
};

export type AppTools = InferUITools<typeof chatTools>;

export type MeshContextData = {
  meshId: string;
  fileType: MeshFileType;
  filename?: string;
  boundingBox?: { x: number; y: number; z: number };
  /** Authoritative descriptor for a Parametric import()/surface() asset. */
  asset?: OpenScadProjectAsset;
};

export type MeshPreferencesData = {
  topology: 'quads' | 'polys';
  polygonCount: number;
};

export type ImportedArtifactOrigin = {
  type: 'import';
  source: 'upload' | 'github';
  filename: string;
  importedAt: string;
  canonicalUrl?: string;
};

/**
 * Conversation-level signals the server emits as transient stream parts
 * (`writer.write({ transient: true, type: 'data-X', data })`). Transient
 * parts never land in `messages.parts` — they're side-channel updates the
 * client folds straight into the conversation query cache.
 *
 *  * `title-update`    fires once when the server generates a title for
 *    a fresh conversation; client updates `conversations.title`.
 *  * `suggestions-update` fires after each assistant turn finishes;
 *    client updates `conversations.settings.suggestions` so the pills
 *    below the input refresh in lock-step with the response.
 */
export type ConversationTitleUpdate = {
  conversationId: string;
  title: string;
};
export type ConversationSuggestionsUpdate = {
  conversationId: string;
  suggestions: string[];
};

export type AppDataTypes = {
  'mesh-context': MeshContextData;
  'mesh-preferences': MeshPreferencesData;
  'brep-project': BrepProjectArtifactData;
  'title-update': ConversationTitleUpdate;
  'suggestions-update': ConversationSuggestionsUpdate;
};

/** Immutable canonical BRep source snapshot persisted on a message branch. */
export type BrepProjectArtifactData = {
  title: string;
  version: string;
  source: Extract<ParametricProjectSource, { kind: 'brep' }>;
};

export const meshContextDataSchema = z.object({
  meshId: z.string(),
  fileType: z.enum(['glb', 'stl', 'obj', 'fbx']),
  filename: z.string().optional(),
  boundingBox: z
    .object({ x: z.number(), y: z.number(), z: z.number() })
    .optional(),
  asset: openScadProjectAssetSchema.optional(),
});

export const meshPreferencesDataSchema = z.object({
  topology: z.enum(['quads', 'polys']),
  polygonCount: z.number(),
});

export type AppUIMessage = UIMessage<
  {
    /** Product-facing model selection for this immutable turn. In Parametric
     * mode this is the requested/used AI model. In Creative mode it remains
     * the 3D backend ID so existing retry and mesh semantics stay compatible. */
    model?: Model;
    /** Actual LLM/agent used by a Creative turn. `model` remains the mesh
     * backend ID in Creative mode so retry/UI behavior stays compatible. */
    agentModel?: Model;
    /** Actual normalized LLM/agent model dispatched by the server for this
     * assistant turn. Forward-going provenance must not be reconstructed from
     * the conversation's current model after the turn has completed. */
    actualModel?: Model;
    /** Immutable transport selected for this assistant turn. Legacy messages
     * may omit this and the UI must then avoid inventing a transport label. */
    transportKind?: 'direct' | 'opencode' | 'codex' | 'cli-agent';
    /** OpenCode execution mode used for this turn when relevant. It belongs to
     * message provenance, not only mutable conversation settings. */
    openCodeExecutionMode?: 'cli' | 'streaming';
    /** Provenance for an OpenSCAD artifact that entered Brepia through import.
     * UI-only metadata: the complete project snapshot remains in the normal
     * build_parametric_model tool input and is not duplicated here. */
    artifactOrigin?: ImportedArtifactOrigin;
    /** Immutable creation provenance for a BRep project baseline revision. */
    projectCreation?: ProjectOrigin;
    // OpenSCAD entrypoint baseline used by parameter controls for Reset /
    // slider-home / auto-range semantics. It is captured lazily before the
    // first parameter-control edit and explicitly rebased whenever the user
    // directly saves a new authored entrypoint source from Project files.
    originalCode?: string;
  },
  AppDataTypes,
  AppTools
>;
