import { Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConversation } from '@/contexts/ConversationContext';
import { useMessagesQuery } from '@/services/messageService';
import {
  importBrepGrasshopperGhxFile,
  type BrepGrasshopperGhxFileLike,
} from '@/services/brepGrasshopperImport';
import { persistBrepGrasshopperImportedRevision } from '@/services/brepGrasshopperImportPersistence';
import { resolveActiveBrepAiSourceForLeaf } from '@shared/brepAiContext';
import { useQueryClient } from '@tanstack/react-query';

type ImportStatus = {
  kind: 'success' | 'error';
  message: string;
};

export function BrepGrasshopperImportButton({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const { conversation } = useConversation();
  const queryClient = useQueryClient();
  const { data: dbMessages = [] } = useMessagesQuery();
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<ImportStatus | null>(null);

  const leafId =
    conversation.current_message_leaf_id ?? dbMessages.at(-1)?.id ?? '';
  const activeSource = useMemo(
    () =>
      leafId ? resolveActiveBrepAiSourceForLeaf(dbMessages, leafId) : undefined,
    [dbMessages, leafId],
  );

  const importFile = async (file: BrepGrasshopperGhxFileLike) => {
    if (disabled || !activeSource || !leafId || importing) return;
    setImporting(true);
    setStatus(null);
    try {
      const result = await importBrepGrasshopperGhxFile(
        activeSource.artifact.source.source,
        activeSource.messageId,
        file,
      );

      if (result.changedParameterIds.length === 0) {
        setStatus({
          kind: 'success',
          message: 'GHX matches the active Brepia revision; no revision created.',
        });
        return;
      }

      await persistBrepGrasshopperImportedRevision({
        conversationId: conversation.id,
        parentMessageId: activeSource.messageId,
        activeLeafId: leafId,
        artifact: activeSource.artifact,
        parameterValues: result.parameterValues,
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['messages', conversation.id],
        }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      ]);
      setStatus({
        kind: 'success',
        message: `Imported ${result.changedParameterIds.length} GHX parameter change${result.changedParameterIds.length === 1 ? '' : 's'} as a new revision. Activate it from Revision history when ready.`,
      });
    } catch (reason) {
      setStatus({
        kind: 'error',
        message:
          reason instanceof Error
            ? reason.message
            : 'Grasshopper GHX import failed.',
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".ghx,application/xml,text/xml"
        className="hidden"
        aria-label="Import Grasshopper GHX"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importFile(file);
        }}
      />
      {status ? (
        <span
          aria-live="polite"
          title={status.message}
          className={`hidden max-w-72 truncate text-[10px] lg:inline ${
            status.kind === 'error'
              ? 'text-destructive'
              : 'text-adam-neutral-400'
          }`}
        >
          {status.message}
        </span>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled || !activeSource || importing}
        title={
          disabled
            ? 'Return to the active BRep revision before importing Grasshopper changes'
            : 'Validate a returned Brepia GHX and import supported parameter edits as a new immutable revision'
        }
        onClick={() => inputRef.current?.click()}
        className="h-7 shrink-0 gap-1.5 px-2 text-xs text-adam-neutral-300"
      >
        <Upload className="h-3.5 w-3.5" />
        {importing ? 'Importing…' : 'Import GHX'}
      </Button>
    </div>
  );
}
