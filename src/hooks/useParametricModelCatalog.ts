/**
 * useParametricModelCatalog — React hooks for the effective
 * parametric model catalog.
 *
 * Under the hood these call the `/api/models/catalog` endpoint(s) which
 * merge built-in, opencode, Codex and custom provider models per the
 * `modelCatalog` server module.
 */

import { useState, useEffect } from 'react';
import type { CatalogEntry } from '../../src/server/modelCatalog';
import { apiJson } from '@/services/api';

interface UseCatalogResult {
  /** Catalog entries (exact set depends on the hook variant). */
  models: CatalogEntry[];
  /** Whether data is currently being fetched. */
  isLoading: boolean;
  /** Error object if the fetch failed, null otherwise. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Full catalog — includes hidden models (for Settings UI).
// ---------------------------------------------------------------------------

/**
 * Fetch the full catalog including hidden models.
 *
 * Used by AiModelsSettings so users can see and re-enable hidden models.
 * Requires authentication via `apiJson`.
 */
export function useFullParametricModelCatalog(): UseCatalogResult {
  const [models, setModels] = useState<CatalogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchCatalog = async () => {
      try {
        const entries = (await apiJson('models/catalog/all')) as CatalogEntry[];
        if (!cancelled) {
          setModels(entries);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
          setModels([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, isLoading, error };
}

// ---------------------------------------------------------------------------
// Selectable catalog — excludes hidden models (for model picker).
// ---------------------------------------------------------------------------

/**
 * Fetch the selectable catalog (hidden models excluded).
 *
 * Used by the model picker (TextAreaChat, PromptView).
 *
 * @deprecated Use `useSelectableParametricModelCatalog` directly.
 */
export function useParametricModelCatalog(): UseCatalogResult {
  return useSelectableParametricModelCatalog();
}

/**
 * Fetch the selectable catalog (hidden models excluded).
 *
 * The catalog endpoint requires the current Supabase access token.
 */
export function useSelectableParametricModelCatalog(): UseCatalogResult {
  const [models, setModels] = useState<CatalogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchCatalog = async () => {
      try {
        const entries = (await apiJson('models/catalog')) as CatalogEntry[];
        if (!cancelled) {
          const filtered = entries.filter((e) => e.enabled && e.available);
          setModels(filtered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
          setModels([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, isLoading, error };
}
