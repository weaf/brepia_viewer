import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ActivityIndicator } from '@/components/brand';
import { useToast } from '@/hooks/use-toast';
import {
  deleteAdminModelWorkspace,
  getAdminModelInventory,
  getAdminWorkspaceImage,
  type AdminConversationWorkspace,
  type AdminImageFile,
} from '@/services/adminModelsService';
import { getAccountAccess } from '@/services/accountAdminService';
import { syncConversationWorkspace } from '@/services/conversationWorkspaceService';
import {
  readAdminConversationIdsEnabled,
  setAdminConversationIdsEnabled,
} from '@/lib/adminConversationIdentifiers';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function matchesWorkspace(
  workspace: AdminConversationWorkspace,
  query: string,
) {
  if (!query) return true;
  const haystack = [
    workspace.conversationId,
    workspace.title,
    workspace.type,
    workspace.userId,
    workspace.ownerLabel,
    workspace.workspacePath,
    ...workspace.models.flatMap((model) => [
      model.name,
      model.relativePath,
      model.absolutePath,
      model.kind,
    ]),
    ...workspace.images.flatMap((image) => [
      image.name,
      image.relativePath,
      image.absolutePath,
      image.kind,
    ]),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return haystack.includes(query);
}

export function AdminModelsSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [showConversationIds, setShowConversationIds] = useState(
    readAdminConversationIdsEnabled,
  );
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<Set<string>>(
    new Set(),
  );
  const { data: access } = useQuery({
    queryKey: ['account-access'],
    queryFn: getAccountAccess,
  });
  const inventoryQuery = useQuery({
    queryKey: ['admin-model-inventory'],
    queryFn: getAdminModelInventory,
  });
  const deleteMutation = useMutation({
    mutationFn: async (conversationIds: string[]) => {
      const results: Array<
        Awaited<ReturnType<typeof deleteAdminModelWorkspace>>
      > = [];

      for (const conversationId of conversationIds) {
        try {
          results.push(await deleteAdminModelWorkspace(conversationId));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown delete error';
          if (results.length > 0) {
            throw new Error(
              `Deleted ${results.length} of ${conversationIds.length} workspaces before the operation stopped: ${message}`,
            );
          }
          throw error;
        }
      }

      return results;
    },
    onSuccess: (results) => {
      setSelectedWorkspaceIds(new Set());
      setSelectionMode(false);

      if (results.length === 1) {
        const result = results[0];
        toast({
          title: result.orphaned
            ? 'Orphaned workspace deleted'
            : 'Conversation deleted',
          description: result.orphaned
            ? 'The local workspace was removed from disk.'
            : 'The conversation and its Brepia-managed artifacts were removed.',
        });
        return;
      }

      const orphanedCount = results.filter((result) => result.orphaned).length;
      toast({
        title: `${results.length} workspaces deleted`,
        description:
          orphanedCount > 0
            ? `${results.length - orphanedCount} conversations and ${orphanedCount} orphaned workspaces were removed.`
            : 'The selected conversations and their Brepia-managed artifacts were removed.',
      });
    },
    onError: (error) => {
      setSelectedWorkspaceIds(new Set());
      setSelectionMode(false);
      toast({
        title: 'Could not complete workspace deletion',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-model-inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      ]);
    },
  });
  const syncMutation = useMutation({
    mutationFn: syncConversationWorkspace,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['admin-model-inventory'],
      });
      toast({ title: 'Workspace synchronized' });
    },
    onError: (error) =>
      toast({
        title: 'Could not synchronize workspace',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      }),
  });
  const normalizedSearch = search.trim().toLowerCase();
  const workspaces = useMemo(
    () =>
      (inventoryQuery.data?.workspaces ?? []).filter((workspace) =>
        matchesWorkspace(workspace, normalizedSearch),
      ),
    [inventoryQuery.data?.workspaces, normalizedSearch],
  );

  const selectedCount = selectedWorkspaceIds.size;
  const allVisibleSelected =
    workspaces.length > 0 &&
    workspaces.every((workspace) =>
      selectedWorkspaceIds.has(workspace.conversationId),
    );

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast({ title: 'Path copied' });
    } catch {
      toast({
        title: 'Could not copy path',
        description: path,
        variant: 'destructive',
      });
    }
  };

  const toggleWorkspaceSelection = (conversationId: string) => {
    setSelectedWorkspaceIds((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      return next;
    });
  };

  const leaveSelectionMode = () => {
    setSelectionMode(false);
    setSelectedWorkspaceIds(new Set());
  };

  const toggleSelectAllVisible = () => {
    setSelectedWorkspaceIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const workspace of workspaces) {
          next.delete(workspace.conversationId);
        }
      } else {
        for (const workspace of workspaces) {
          next.add(workspace.conversationId);
        }
      }
      return next;
    });
  };

  if (inventoryQuery.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <ActivityIndicator label="Loading model inventory" />
      </div>
    );
  }

  if (inventoryQuery.isError || !inventoryQuery.data) {
    return (
      <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-200">
        Could not load the model inventory.
      </div>
    );
  }

  const inventory = inventoryQuery.data;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Summary
          label="Conversations"
          value={String(inventory.conversationCount)}
        />
        <Summary label="Workspaces" value={String(inventory.workspaceCount)} />
        <Summary label="Models" value={String(inventory.modelCount)} />
        <Summary label="Disk usage" value={formatBytes(inventory.totalBytes)} />
        <Summary
          label="Missing workspace"
          value={String(inventory.missingWorkspaceCount)}
          warning={inventory.missingWorkspaceCount > 0}
        />
        <Summary
          label="Orphaned"
          value={String(inventory.orphanedCount)}
          warning={inventory.orphanedCount > 0}
        />
      </div>

      <div className="rounded-lg border border-adam-neutral-800 p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-adam-neutral-300">
          Workspace root
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-adam-background-1 px-3 py-2 text-xs text-adam-neutral-100">
            {inventory.workspaceRoot}
          </code>
          <Button
            size="sm"
            variant="dark"
            aria-label="Copy workspace root"
            onClick={() => void copyPath(inventory.workspaceRoot)}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-adam-neutral-800 p-4">
        <div className="min-w-0">
          <div className="text-sm text-adam-neutral-50">
            Show conversation IDs in sidebar
          </div>
          <div className="mt-1 text-xs leading-relaxed text-adam-neutral-300">
            Admin-only local display preference. Shows the first eight UUID
            characters below each recent creation title to distinguish duplicate
            names.
          </div>
        </div>
        <Switch
          className="mt-0.5 shrink-0"
          checked={showConversationIds}
          onCheckedChange={(enabled) => {
            setShowConversationIds(enabled);
            setAdminConversationIdsEnabled(enabled);
          }}
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search title, user, UUID, model, image or path..."
          className="flex-1"
        />
        <div className="flex gap-2">
          <Button
            variant="dark"
            disabled={deleteMutation.isPending}
            onClick={() =>
              selectionMode ? leaveSelectionMode() : setSelectionMode(true)
            }
          >
            {selectionMode ? 'Cancel' : 'Select'}
          </Button>
          <Button
            variant="dark"
            disabled={inventoryQuery.isFetching || deleteMutation.isPending}
            onClick={() => void inventoryQuery.refetch()}
          >
            {inventoryQuery.isFetching ? (
              <ActivityIndicator label="Refreshing model inventory" size="sm" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {selectionMode && workspaces.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-adam-neutral-700 bg-adam-background-1 px-3 py-2">
          <span className="text-sm text-adam-neutral-300">
            {selectedCount} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={toggleSelectAllVisible}
            >
              {allVisibleSelected ? 'Deselect all' : 'Select all'}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={selectedCount === 0 || deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? (
                    <ActivityIndicator
                      label="Deleting selected workspaces"
                      size="sm"
                    />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-[2px] border-adam-neutral-700 bg-adam-background-1">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-adam-neutral-100">
                    Delete selected entries?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes {selectedCount}{' '}
                    {selectedCount === 1 ? 'entry' : 'entries'}. Normal
                    conversations will also be removed from the database and
                    Supabase storage. Orphaned entries remove only their local
                    workspace from disk. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700"
                    onClick={() =>
                      deleteMutation.mutate([...selectedWorkspaceIds])
                    }
                  >
                    Delete selected
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {workspaces.length === 0 ? (
          <div className="rounded-lg border border-adam-neutral-800 p-6 text-center text-sm text-adam-neutral-300">
            {normalizedSearch
              ? 'No conversations or workspaces match this search.'
              : 'No conversations or local workspaces are stored on this instance.'}
          </div>
        ) : (
          workspaces.map((workspace) => (
            <WorkspaceCard
              key={workspace.conversationId}
              workspace={workspace}
              onCopyPath={copyPath}
              onDelete={(conversationId) =>
                deleteMutation.mutate([conversationId])
              }
              deleting={
                deleteMutation.isPending &&
                (deleteMutation.variables?.includes(workspace.conversationId) ??
                  false)
              }
              canSync={
                workspace.missingWorkspace &&
                workspace.userId === access?.userId
              }
              onSync={(conversationId) => syncMutation.mutate(conversationId)}
              syncing={
                syncMutation.isPending &&
                syncMutation.variables === workspace.conversationId
              }
              selectionMode={selectionMode}
              selected={selectedWorkspaceIds.has(workspace.conversationId)}
              onToggleSelection={toggleWorkspaceSelection}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Summary({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="rounded-lg border border-adam-neutral-800 p-4">
      <div className="text-xs text-adam-neutral-300">{label}</div>
      <div
        className={`mt-1 text-xl font-medium ${warning ? 'text-amber-300' : 'text-adam-neutral-50'}`}
      >
        {value}
      </div>
    </div>
  );
}

function AdminImagePreview({
  conversationId,
  image,
  title,
}: {
  conversationId: string;
  image: AdminImageFile;
  title: string;
}) {
  const imageQuery = useQuery({
    queryKey: ['admin-workspace-image', conversationId, image.relativePath],
    queryFn: () => getAdminWorkspaceImage(conversationId, image.relativePath),
    staleTime: 60_000,
  });
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imageQuery.data) {
      setObjectUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(imageQuery.data);
    setObjectUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [imageQuery.data]);

  if (!objectUrl) {
    return (
      <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-md border border-adam-neutral-800 bg-adam-background-2 text-[10px] text-adam-neutral-400">
        {imageQuery.isError ? 'Preview unavailable' : 'Loading image…'}
      </div>
    );
  }

  return (
    <img
      src={objectUrl}
      alt={`Preview for ${title}`}
      title={image.relativePath}
      className="h-16 w-20 shrink-0 rounded-md border border-adam-neutral-800 bg-adam-background-2 object-cover"
    />
  );
}

function WorkspaceCard({
  workspace,
  onCopyPath,
  onDelete,
  deleting,
  canSync,
  onSync,
  syncing,
  selectionMode,
  selected,
  onToggleSelection,
}: {
  workspace: AdminConversationWorkspace;
  onCopyPath: (path: string) => Promise<void>;
  onDelete: (conversationId: string) => void;
  deleting: boolean;
  canSync: boolean;
  onSync: (conversationId: string) => void;
  syncing: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelection: (conversationId: string) => void;
}) {
  const title = workspace.title?.trim() || null;
  const previewImage =
    workspace.images.find((image) => image.kind === 'render') ??
    workspace.images[0] ??
    null;

  return (
    <details
      className={`group rounded-lg border p-4 open:bg-adam-background-1/30 ${
        selected ? 'border-adam-blue' : 'border-adam-neutral-800'
      }`}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-start gap-3">
          {selectionMode && (
            <input
              type="checkbox"
              checked={selected}
              aria-label={`Select ${title || workspace.conversationId}`}
              className="mt-1 h-4 w-4 shrink-0 accent-adam-blue"
              onClick={(event) => event.stopPropagation()}
              onChange={() => onToggleSelection(workspace.conversationId)}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-adam-neutral-50">
                  {title || workspace.conversationId}
                </span>
                {workspace.orphaned && (
                  <span className="rounded-full border border-amber-700 bg-amber-950/40 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                    Orphaned
                  </span>
                )}
                {workspace.missingWorkspace && (
                  <span className="rounded-full border border-orange-700 bg-orange-950/30 px-2 py-0.5 text-[11px] font-medium text-orange-300">
                    Missing workspace
                  </span>
                )}
              </div>
              {title && (
                <div className="mt-1 truncate font-mono text-[11px] text-adam-neutral-400">
                  {workspace.conversationId}
                </div>
              )}
              <div className="mt-1 text-xs text-adam-neutral-300">
                {workspace.ownerLabel || 'Unknown owner'}
                {' · '}
                {workspace.type || 'unknown type'}
                {' · '}
                {workspace.modelCount} models
                {' · '}
                {workspace.imageCount} images
                {' · '}
                {formatBytes(workspace.totalBytes)}
              </div>
            </div>
            <div className="flex shrink-0 items-start gap-3">
              {previewImage && (
                <AdminImagePreview
                  conversationId={workspace.conversationId}
                  image={previewImage}
                  title={title || workspace.conversationId}
                />
              )}
              <div className="text-xs text-adam-neutral-400">
                {workspace.fileCount} files
              </div>
            </div>
          </div>
        </div>
      </summary>

      <div className="mt-4 space-y-4 border-t border-adam-neutral-800 pt-4">
        <div>
          <div className="text-xs text-adam-neutral-300">Conversation UUID</div>
          <code className="mt-1 block break-all text-xs text-adam-neutral-100">
            {workspace.conversationId}
          </code>
        </div>

        <div>
          <div className="text-xs text-adam-neutral-300">Workspace path</div>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-adam-background-2 px-3 py-2 text-xs text-adam-neutral-100">
              {workspace.workspacePath}
            </code>
            <Button
              size="sm"
              variant="dark"
              aria-label="Copy workspace path"
              onClick={() => void onCopyPath(workspace.workspacePath)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {workspace.missingWorkspace && (
            <p className="mt-2 text-xs text-orange-300">
              The database conversation exists, but this directory is missing.
            </p>
          )}
        </div>

        {workspace.images.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium text-adam-neutral-200">
              Images
            </div>
            <div className="space-y-1">
              {workspace.images.map((image) => (
                <div
                  key={image.absolutePath}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs text-adam-neutral-300"
                >
                  <span className="min-w-0 truncate">
                    {image.relativePath} · {image.kind} ·{' '}
                    {formatBytes(image.sizeBytes)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Copy path for ${image.name}`}
                    onClick={() => void onCopyPath(image.absolutePath)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 text-xs font-medium text-adam-neutral-200">
            Model files
          </div>
          {workspace.models.length === 0 ? (
            <div className="text-xs text-adam-neutral-400">
              No generated or parametric model files found.
            </div>
          ) : (
            <div className="space-y-2">
              {workspace.models.map((model) => (
                <div
                  key={model.absolutePath}
                  className="rounded-md border border-adam-neutral-800 bg-adam-background-2 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-adam-neutral-50">
                        {model.relativePath}
                      </div>
                      <div className="mt-1 text-[11px] text-adam-neutral-400">
                        {model.kind} · {formatBytes(model.sizeBytes)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="dark"
                      aria-label={`Copy path for ${model.name}`}
                      onClick={() => void onCopyPath(model.absolutePath)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <code className="mt-2 block overflow-x-auto text-[11px] text-adam-neutral-300">
                    {model.absolutePath}
                  </code>
                </div>
              ))}
            </div>
          )}
        </div>

        {!selectionMode && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-adam-neutral-800 pt-4">
            {canSync && (
              <Button
                variant="dark"
                size="sm"
                disabled={syncing || deleting}
                onClick={() => onSync(workspace.conversationId)}
              >
                {syncing ? (
                  <ActivityIndicator
                    label="Synchronizing workspace"
                    size="sm"
                  />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Sync workspace
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleting}>
                  {deleting ? (
                    <ActivityIndicator label="Deleting workspace" size="sm" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-[2px] border-adam-neutral-700 bg-adam-background-1">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-adam-neutral-100">
                    {workspace.orphaned
                      ? 'Delete orphaned workspace?'
                      : 'Delete conversation and models?'}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {workspace.orphaned
                      ? `This permanently removes the local workspace ${title || workspace.conversationId} from disk.`
                      : `This permanently deletes ${title || workspace.conversationId}, its database conversation, storage artifacts, and local workspace if present.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700"
                    onClick={() => onDelete(workspace.conversationId)}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </details>
  );
}
