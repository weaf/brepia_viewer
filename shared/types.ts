import { Database } from './database.ts';
import type { AppUIMessage } from './chatAi.ts';
import type { CreativeMeshModelId } from './creativeMeshModels.ts';
import type { OpenScadProject } from './openScadProject.ts';
export type Model = string;
export type CreativeModel = CreativeMeshModelId;

export type Prompt = {
  text?: string;
  images?: string[];
  mesh?: string;
  model?: Model;
};

type MessageRow = Database['public']['Tables']['messages']['Row'];

export type Message = Pick<
  MessageRow,
  'conversation_id' | 'created_at' | 'id' | 'parent_message_id' | 'rating'
> & {
  role: 'user' | 'assistant';
  metadata: AppUIMessage['metadata'];
  parts: AppUIMessage['parts'];
};

export type MeshFileType = Database['public']['Enums']['mesh_file_type'];

export type Mesh = {
  id: string;
  fileType: MeshFileType;
};

export type MeshData = Omit<
  Database['public']['Tables']['meshes']['Row'],
  'prompt'
> & {
  prompt: Prompt;
};

export type ParametricArtifact = {
  title: string;
  version: string;
  project: OpenScadProject;
};

// label is optional: an OpenSCAD customizer comment can list bare values
// (e.g. `[Assembled, Exploded]`) with no `value:label` pair, in which case
// the parser leaves label undefined and the UI falls back to the value.
export type ParameterOption = { value: string | number; label?: string };

export type ParameterRange = { min?: number; max?: number; step?: number };

export type ParameterType =
  'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]';

export type Parameter = {
  name: string;
  displayName: string;
  value: string | boolean | number | string[] | number[] | boolean[];
  defaultValue: string | boolean | number | string[] | number[] | boolean[];
  // Type should always exist, but old messages don't have it.
  type?: ParameterType;
  description?: string;
  group?: string;
  range?: ParameterRange;
  options?: ParameterOption[];
  maxLength?: number;
};

export type Conversation = Omit<
  Database['public']['Tables']['conversations']['Row'],
  'settings'
> & {
  settings: ConversationSettings;
};

export type GenerationStatus = Database['public']['Enums']['generation-status'];

export type ConversationSettings = {
  model?: Model;
  /**
   * Explicit product/source intent used only to arm first-turn native BRep
   * creation before a canonical data-brep-project source exists. Once a source
   * snapshot exists, source-derived routing is authoritative again.
   */
  parametricSourceKind?: 'brep';
  /**
   * Product-level cleanup for the BRep revision picker. Hidden revisions remain
   * intact in the immutable message lineage so historical branches, retries and
   * source ancestry cannot be corrupted by presentation-only cleanup.
   */
  brepHiddenRevisionIds?: string[];
  /**
   * Optional user-facing names for immutable BRep source revisions. Keys are
   * persisted message/revision IDs; changing a label never mutates canonical
   * source bytes, parent lineage or export provenance.
   */
  brepRevisionLabels?: Record<string, string>;
  /**
   * Repository-backed AI instruction package pinned when the conversation is
   * created. Model selection remains independent. Old conversations without
   * this field fall back to the user's current package for compatibility.
   */
  instructionProfileId?: string;
  /**
   * LLM/agent model used by Creative conversations. `model` remains the
   * Creative mesh backend ID in that mode, so keeping the two identities
   * separate avoids treating a mesh backend as an LLM.
   */
  creativeAgentModel?: Model;
  /**
   * Prompt profile ID pinned to a Creative conversation. It is independent
   * from the Parametric/Generative prompt profile so each mode can keep a
   * reproducible system prompt across later Settings changes.
   */
  creativePromptProfileId?: string | null;
  /**
   * Local Creative runtime profile captured when a Creative conversation is
   * created. Missing means a legacy conversation that keeps compatibility
   * routing; null means the conversation was explicitly created without a
   * Local Creative profile selected.
   */
  localCreativeProfileId?: string | null;
  /**
   * Per-conversation follow-up suggestions rendered as pills above the
   * chat input. Regenerated server-side after each non-tool-call
   * assistant turn — see `emitConversationSuggestions` in
   * `src/server/aiChat.ts`.
   */
  suggestions?: string[];
  /**
   * Execution mode for OpenCode agents: 'cli' for traditional CLI transport,
   * 'streaming' for HTTP/SSE streaming transport. Defaults to 'cli' if not set.
   */
  openCodeExecutionMode?: 'cli' | 'streaming';
  /**
   * Parametric/Generative prompt profile ID pinned to this conversation.
   * When set, the resolver fetches the profile at runtime and uses its
   * template (or the built-in when NULL). Pinned profiles make
   * new-conversation behavior reproducible — changing Settings later does not
   * silently alter old conversations.
   */
  promptProfileId?: string | null;
} | null;

export type Profile = Database['public']['Tables']['profiles']['Row'];
