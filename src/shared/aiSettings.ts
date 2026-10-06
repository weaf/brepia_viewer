// P02A: Shared DTOs and validation schemas for the local customization settings.
//
// These types define the contract between server modules (src/server/*)
// and API routes (src/routes/api/ai-settings/*).  They are also consumed
// by the React Query hooks in src/services/aiSettingsService.ts.
//
// NOTE: Types align with actual P01 database schema in supabase/schemas/*.
// The prompt_profiles table does NOT have a `mode` column (computed server-side).
// The ai_providers table does NOT have `preset` or `headers` columns yet (pending migration).

// ──────────────────────────────────────────────────────────────────────
// User AI Preferences
// ──────────────────────────────────────────────────────────────────────

export interface AiPreferencesDto {
  userId: string;
  hiddenModelIds: string[];
  defaultPromptProfileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateAiPreferencesInput {
  hiddenModelIds?: string[];
  defaultPromptProfileId?: string | null;
}

// ──────────────────────────────────────────────────────────────────────
// Prompt Profiles
// ──────────────────────────────────────────────────────────────────────

export interface PromptProfileSummaryDto {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptProfileDetailDto extends PromptProfileSummaryDto {
  promptTemplate: string;
  baseRevision: string | null;
}

export interface CreatePromptProfileInput {
  name: string;
  promptTemplate: string;
  description?: string | null;
  baseRevision?: string | null;
}

export interface UpdatePromptProfileInput {
  name?: string;
  description?: string | null;
  promptTemplate?: string;
  baseRevision?: string | null;
}

// ──────────────────────────────────────────────────────────────────────
// AI Providers
// ──────────────────────────────────────────────────────────────────────

export interface ProviderSummaryDto {
  id: string;
  userId: string;
  slug: string;
  name: string;
  driver: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderDetailDto extends ProviderSummaryDto {
  baseUrl: string;
  hasCredential: boolean;
}

export interface CreateProviderInput {
  slug: string;
  name: string;
  driver: string;
  baseUrl: string;
  credential?: string;
}

export interface UpdateProviderInput {
  name?: string;
  driver?: string;
  baseUrl?: string;
  /**
   * New credential to encrypt and store.
   * If `null`, the stored credential is removed (if any).
   * If `undefined`, the existing credential is NOT changed.
   */
  credential?: string | null;
  enabled?: boolean;
}

export interface TestProviderResultDto {
  ok: boolean;
  message: string;
  latencyMs: number;
}

// ──────────────────────────────────────────────────────────────────────
// Provider Models
// ──────────────────────────────────────────────────────────────────────

export interface ProviderModelDto {
  id: string;
  providerId: string;
  userId: string;
  modelId: string;
  displayName: string;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderModelInput {
  modelId: string;
  displayName: string;
  isVisible?: boolean;
}

export interface UpdateProviderModelInput {
  displayName?: string;
  isVisible?: boolean;
}
