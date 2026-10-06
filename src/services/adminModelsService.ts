import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { apiJson, apiUrl } from '@/services/api';

const AdminModelFileSchema = z.object({
  name: z.string(),
  relativePath: z.string(),
  absolutePath: z.string(),
  kind: z.enum(['generated', 'parametric', 'export']),
  sizeBytes: z.number(),
  modifiedAt: z.string(),
});

const AdminImageFileSchema = z.object({
  name: z.string(),
  relativePath: z.string(),
  absolutePath: z.string(),
  kind: z.enum(['render', 'input']),
  sizeBytes: z.number(),
  modifiedAt: z.string(),
});

const AdminConversationWorkspaceSchema = z.object({
  conversationId: z.string(),
  title: z.string().nullable(),
  type: z.string().nullable(),
  userId: z.string().nullable(),
  ownerLabel: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  workspacePath: z.string(),
  workspaceExists: z.boolean(),
  missingWorkspace: z.boolean(),
  totalBytes: z.number(),
  fileCount: z.number(),
  modelCount: z.number(),
  imageCount: z.number(),
  orphaned: z.boolean(),
  models: z.array(AdminModelFileSchema),
  images: z.array(AdminImageFileSchema),
});

export const AdminModelInventorySchema = z.object({
  workspaceRoot: z.string(),
  conversationCount: z.number(),
  workspaceCount: z.number(),
  missingWorkspaceCount: z.number(),
  orphanedCount: z.number(),
  modelCount: z.number(),
  imageCount: z.number(),
  totalBytes: z.number(),
  workspaces: z.array(AdminConversationWorkspaceSchema),
});

const AdminWorkspaceDeleteResultSchema = z.object({
  success: z.literal(true),
  orphaned: z.boolean(),
});

export type AdminModelFile = z.infer<typeof AdminModelFileSchema>;
export type AdminImageFile = z.infer<typeof AdminImageFileSchema>;
export type AdminConversationWorkspace = z.infer<
  typeof AdminConversationWorkspaceSchema
>;
export type AdminModelInventory = z.infer<typeof AdminModelInventorySchema>;

export function getAdminModelInventory() {
  return apiJson(
    'settings/adminModels',
    { method: 'GET' },
    AdminModelInventorySchema,
  );
}

export function deleteAdminModelWorkspace(conversationId: string) {
  return apiJson(
    'settings/adminModels',
    {
      method: 'POST',
      body: JSON.stringify({ conversationId }),
    },
    AdminWorkspaceDeleteResultSchema,
  );
}

export async function getAdminWorkspaceImage(
  conversationId: string,
  relativePath: string,
): Promise<Blob> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const params = new URLSearchParams({
    assetConversationId: conversationId,
    assetPath: relativePath,
  });
  const response = await fetch(`${apiUrl('settings/adminModels')}?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      if (typeof data?.error === 'string') throw new Error(data.error);
    }
    throw new Error(response.statusText || 'Could not load workspace image');
  }
  return response.blob();
}
