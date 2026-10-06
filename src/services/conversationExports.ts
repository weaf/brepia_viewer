import { supabase } from '@/lib/supabase';
import type { OpenScadProject } from '@shared/openScadProject';
import { apiUrl } from './api';

export type PersistConversationExportOptions = {
  conversationId: string;
  format: 'stl' | 'dxf' | '3mf';
  project: OpenScadProject;
  file: Blob;
};

const WORKSPACE_ACTION_HEADER = 'X-BREPIA-Workspace-Action';
const PERSIST_EXPORT_ACTION = 'persist-export';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postExport(
  options: PersistConversationExportOptions,
  token: string | undefined,
): Promise<Response> {
  const form = new FormData();
  form.set('conversationId', options.conversationId);
  form.set('format', options.format);
  form.set('project', JSON.stringify(options.project));
  form.set('file', options.file, `model.${options.format}`);

  return fetch(apiUrl('parametric-chat'), {
    method: 'POST',
    headers: {
      [WORKSPACE_ACTION_HEADER]: PERSIST_EXPORT_ACTION,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
  });
}

/**
 * Best-effort companion to the browser download. The server resolves the exact
 * model revision from the complete normalized project identity and stores the
 * exported bytes in the conversation workspace. A parameter edit can be a few
 * milliseconds behind in Supabase, so retry the explicit revision-not-found
 * race once.
 */
export async function persistConversationExport(
  options: PersistConversationExportOptions,
): Promise<void> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  let response = await postExport(options, token);

  if (response.status === 409) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    const retryable =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      body.error === 'source_revision_not_found';
    if (retryable) {
      await delay(300);
      response = await postExport(options, token);
    }
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : `HTTP ${response.status}`;
    throw new Error(`Failed to persist conversation export: ${message}`);
  }
}
