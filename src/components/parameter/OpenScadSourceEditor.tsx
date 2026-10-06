import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { OpenScadProject } from '@shared/openScadProject';
import { cn } from '@/lib/utils';
import {
  applyOpenScadAutoPair,
  getOpenScadCompletionContext,
  type OpenScadAutoPairEdit,
  type OpenScadCompletion,
} from '@/lib/openScadEditor';
import { highlightOpenScadSource } from '@/lib/openScadEditorHighlighter';
import { recoverOpenScadAutoPairAfterInput } from '@/lib/openScadEditorInput';

interface OpenScadSourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  ariaLabel: string;
  project?: OpenScadProject;
  currentPath?: string | null;
}

const COMPLETION_LIST_ID = 'openscad-editor-completions';
const LINE_HEIGHT_PX = 20;
const MONO_CHARACTER_WIDTH_PX = 7.2;
const EDITOR_PADDING_PX = 12;
const AUTO_PAIR_KEYS = ['(', ')', '<', '>'];

function completionKindLabel(option: OpenScadCompletion) {
  switch (option.kind) {
    case 'module':
      return 'module';
    case 'function':
      return 'function';
    case 'file':
      return 'file';
    case 'keyword':
      return 'keyword';
    default:
      return 'builtin';
  }
}

export function OpenScadSourceEditor({
  value,
  onChange,
  readOnly = false,
  ariaLabel,
  project,
  currentPath,
}: OpenScadSourceEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightLayerRef = useRef<HTMLDivElement>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [highlightedSource, setHighlightedSource] = useState('');
  const [cursor, setCursor] = useState(0);
  const [activeCompletion, setActiveCompletion] = useState(0);
  const [explicitCompletion, setExplicitCompletion] = useState(false);
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const [scrollPosition, setScrollPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void highlightOpenScadSource(value)
        .then((html) => {
          if (cancelled) return;
          setHighlightedHtml(html);
          setHighlightedSource(value);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error('[OpenSCAD editor] Syntax highlighting failed:', error);
          setHighlightedHtml(null);
          setHighlightedSource('');
        });
    }, 40);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [value]);

  const completionContext = useMemo(
    () =>
      readOnly || completionDismissed
        ? { from: cursor, to: cursor, options: [] }
        : getOpenScadCompletionContext({
            source: value,
            cursor,
            project,
            currentPath,
            explicit: explicitCompletion,
          }),
    [
      completionDismissed,
      currentPath,
      cursor,
      explicitCompletion,
      project,
      readOnly,
      value,
    ],
  );

  useEffect(() => {
    setActiveCompletion(0);
  }, [completionContext.from, completionContext.to, value]);

  const completionVisible = completionContext.options.length > 0;
  const hasCurrentHighlight =
    highlightedHtml !== null && highlightedSource === value;

  const beforeCursor = value.slice(0, Math.max(0, cursor));
  const lastLineBreak = beforeCursor.lastIndexOf('\n');
  const lineNumber = beforeCursor.split('\n').length - 1;
  const columnNumber = Math.max(0, cursor - lastLineBreak - 1);
  const completionLeft = Math.max(
    8,
    EDITOR_PADDING_PX +
      columnNumber * MONO_CHARACTER_WIDTH_PX -
      scrollPosition.left,
  );
  const completionTop = Math.max(
    8,
    EDITOR_PADDING_PX +
      (lineNumber + 1) * LINE_HEIGHT_PX -
      scrollPosition.top,
  );

  const syncCursor = (textarea: HTMLTextAreaElement) => {
    setCursor(textarea.selectionStart);
    setExplicitCompletion(false);
    setCompletionDismissed(false);
  };

  const restoreSelection = (selectionStart: number, selectionEnd: number) => {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const commitAutoPairEdit = (autoPairEdit: OpenScadAutoPairEdit) => {
    if (autoPairEdit.value !== value) onChange(autoPairEdit.value);
    setCursor(autoPairEdit.selectionEnd);
    setExplicitCompletion(false);
    setCompletionDismissed(false);
    restoreSelection(autoPairEdit.selectionStart, autoPairEdit.selectionEnd);
  };

  const handleBeforeInput = (event: FormEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;

    const nativeEvent = event.nativeEvent as InputEvent;
    if (nativeEvent.isComposing) return;
    if (
      nativeEvent.inputType &&
      !nativeEvent.inputType.startsWith('insert')
    ) {
      return;
    }

    const key = nativeEvent.data;
    if (!key || key.length !== 1 || !AUTO_PAIR_KEYS.includes(key)) return;

    const textarea = event.currentTarget;
    const autoPairEdit = applyOpenScadAutoPair({
      source: value,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
      key,
    });

    if (!autoPairEdit) return;

    event.preventDefault();
    commitAutoPairEdit(autoPairEdit);
  };

  const applyCompletion = (option: OpenScadCompletion) => {
    const insertion = option.insertText ?? option.label;
    const nextValue =
      value.slice(0, completionContext.from) +
      insertion +
      value.slice(completionContext.to);
    const nextCursor = completionContext.from + insertion.length;

    onChange(nextValue);
    setCursor(nextCursor);
    setExplicitCompletion(false);
    setCompletionDismissed(true);
    restoreSelection(nextCursor, nextCursor);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
      event.preventDefault();
      setCursor(event.currentTarget.selectionStart);
      setCompletionDismissed(false);
      setExplicitCompletion(true);
      return;
    }

    if (!completionVisible) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveCompletion((current) =>
        (current + 1) % completionContext.options.length,
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveCompletion((current) =>
        (current - 1 + completionContext.options.length) %
        completionContext.options.length,
      );
      return;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      applyCompletion(completionContext.options[activeCompletion]);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setExplicitCompletion(false);
      setCompletionDismissed(true);
    }
  };

  const handleScroll = (textarea: HTMLTextAreaElement) => {
    if (highlightLayerRef.current) {
      highlightLayerRef.current.scrollTop = textarea.scrollTop;
      highlightLayerRef.current.scrollLeft = textarea.scrollLeft;
    }
    setScrollPosition({ left: textarea.scrollLeft, top: textarea.scrollTop });
  };

  return (
    <div className="relative min-h-[45dvh] flex-1 overflow-hidden rounded-md border border-adam-neutral-700 bg-adam-background-1 focus-within:ring-1 focus-within:ring-adam-neutral-500">
      <div
        ref={highlightLayerRef}
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 overflow-hidden font-mono text-xs leading-5',
          '[&_.shiki]:m-0 [&_.shiki]:min-h-full [&_.shiki]:min-w-max [&_.shiki]:!bg-transparent [&_.shiki]:p-3 [&_.shiki]:font-mono [&_.shiki]:text-xs [&_.shiki]:leading-5',
        )}
        dangerouslySetInnerHTML={{ __html: highlightedHtml ?? '' }}
      />

      <textarea
        ref={textareaRef}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={completionVisible ? COMPLETION_LIST_ID : undefined}
        aria-expanded={completionVisible}
        aria-activedescendant={
          completionVisible
            ? `${COMPLETION_LIST_ID}-${activeCompletion}`
            : undefined
        }
        value={value}
        onBeforeInput={handleBeforeInput}
        onChange={(event) => {
          const nextValue = event.target.value;
          const recoveredAutoPair = readOnly
            ? null
            : recoverOpenScadAutoPairAfterInput({
                source: value,
                nextValue,
                selectionStart: event.target.selectionStart,
                selectionEnd: event.target.selectionEnd,
              });

          if (recoveredAutoPair) {
            commitAutoPairEdit(recoveredAutoPair);
            return;
          }

          onChange(nextValue);
          setCursor(event.target.selectionStart);
          setExplicitCompletion(false);
          setCompletionDismissed(false);
        }}
        onClick={(event) => syncCursor(event.currentTarget)}
        onKeyUp={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === ' ') return;
          if (AUTO_PAIR_KEYS.includes(event.key)) return;
          if (
            event.key !== 'ArrowDown' &&
            event.key !== 'ArrowUp' &&
            event.key !== 'Enter' &&
            event.key !== 'Tab' &&
            event.key !== 'Escape'
          ) {
            syncCursor(event.currentTarget);
          }
        }}
        onKeyDown={handleKeyDown}
        onScroll={(event) => handleScroll(event.currentTarget)}
        readOnly={readOnly}
        spellCheck={false}
        className="relative z-10 h-full min-h-[45dvh] w-full resize-none overflow-auto whitespace-pre bg-transparent p-3 font-mono text-xs leading-5 outline-none"
        style={{
          color: hasCurrentHighlight ? 'transparent' : undefined,
          caretColor: 'var(--adam-text-primary, #f5f5f5)',
        }}
      />

      {completionVisible && (
        <div
          id={COMPLETION_LIST_ID}
          role="listbox"
          className="absolute z-20 max-h-48 w-72 overflow-y-auto rounded-md border border-adam-neutral-600 bg-adam-bg-secondary-dark p-1 shadow-xl"
          style={{
            left: `max(8px, min(${completionLeft}px, calc(100% - 18rem - 8px)))`,
            top: `max(8px, min(${completionTop}px, calc(100% - 12rem - 8px)))`,
          }}
        >
          {completionContext.options.map((option, index) => (
            <button
              key={`${option.kind}:${option.label}`}
              id={`${COMPLETION_LIST_ID}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeCompletion}
              title={option.detail}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs',
                index === activeCompletion
                  ? 'bg-adam-neutral-700 text-adam-text-primary'
                  : 'text-adam-neutral-300 hover:bg-adam-neutral-800 hover:text-adam-text-primary',
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyCompletion(option)}
            >
              <span className="min-w-0 flex-1 truncate font-mono">
                {option.label}
              </span>
              <span className="shrink-0 text-[9px] uppercase tracking-wide text-adam-neutral-500">
                {completionKindLabel(option)}
              </span>
            </button>
          ))}
          <div className="border-t border-adam-neutral-700 px-2 pt-1 text-[9px] text-adam-neutral-500">
            ↑↓ select · Enter/Tab apply · Esc close · Ctrl+Space show
          </div>
        </div>
      )}
    </div>
  );
}
