import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, SyntheticEvent } from 'react';
import {
  ArrowRight, MoveHorizontal, Ruler, Box, Circle, Code2, Cylinder, Ellipsis, Eye, EyeOff, FileCode2,
  FlipHorizontal, GitBranch, Grid3X3, Layers, Maximize2, Minus,
  MousePointer2, Move, Palette, Repeat, RotateCw, Save, Scan,
  Search, Settings2, Shapes, Square, Triangle, Type,
  type LucideIcon,
} from 'lucide-react';
import { EditorView, basicSetup } from 'codemirror';
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { diagnosticCount, lintGutter, linter, lintKeymap, openLintPanel } from '@codemirror/lint';
import { StreamLanguage } from '@codemirror/language';
import { clike } from '@codemirror/legacy-modes/mode/clike';
import {
  autocompletion,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import {
  gotoLine,
  openSearchPanel,
  selectNextOccurrence,
  selectSelectionMatches,
} from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import type { OpenScadProject } from '@shared/openScadProject';
import { getOpenScadCompletionContext } from '@/lib/openScadEditor';
import { getOpenScadBasicDiagnostics } from '@/lib/openScadBasicDiagnostics';
import { findOpenScadProjectDefinition } from '@/lib/openScadDefinitionNavigation';
import { getOpenScadSignatureHelp, type OpenScadSignatureHint } from '@/lib/openScadSignatureHelp';
import {
  insertOpenScadSnippet,
  getOpenScadSnippetCaption,
  openScadSnippets,
  snippetCategories,
  type OpenScadSnippet,
  type OpenScadSnippetCategory,
  type OpenScadSnippetIcon,
} from '@/lib/openScadSnippets';
import './OpenScadSourceEditor.css';

interface OpenScadSourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  ariaLabel: string;
  project?: OpenScadProject;
  currentPath?: string | null;
  onSelectFile?: (path: string, offset?: number) => void;
  definitionTarget?: { path: string; offset: number } | null;
  viewportKey?: string;
  onSave?: () => void;
  onDiscard?: () => void;
  isDirty?: boolean;
  isSaving?: boolean;
}

const scadLanguage = StreamLanguage.define(
  clike({
    name: 'openscad',
    keywords: Object.fromEntries(
      'module function if else for intersection_for let each include use assert echo'.split(' ').map(word => [word, true]),
    ),
    builtin: Object.fromEntries(
      'cube sphere cylinder circle square polygon polyhedron text translate rotate scale mirror color union difference intersection linear_extrude rotate_extrude hull minkowski import surface'.split(' ').map(word => [word, true]),
    ),
    atoms: { true: true, false: true, undef: true },
  }),
);

const snippetIcons: Record<OpenScadSnippetIcon, LucideIcon> = {
  'arrow-right': ArrowRight,
  'move-horizontal': MoveHorizontal,
  ruler: Ruler,
  box: Box,
  circle: Circle,
  cylinder: Cylinder,
  square: Square,
  triangle: Triangle,
  type: Type,
  move: Move,
  rotate: RotateCw,
  scale: Maximize2,
  mirror: FlipHorizontal,
  layers: Layers,
  minus: Minus,
  scan: Scan,
  palette: Palette,
  eye: Eye,
  'eye-off': EyeOff,
  code: Code2,
  repeat: Repeat,
  branch: GitBranch,
  settings: Settings2,
  file: FileCode2,
  grid: Grid3X3,
};

type CompletionState = Pick<OpenScadSourceEditorProps, 'project' | 'currentPath'>;

function completionSource(context: CompletionContext, latest: MutableRefObject<CompletionState>): CompletionResult | null {
  const { project, currentPath } = latest.current;
  const result = getOpenScadCompletionContext({
    source: context.state.doc.toString(),
    cursor: context.pos,
    project,
    currentPath,
    explicit: context.explicit,
  });
  if (!result.options.length) return null;
  return {
    from: result.from,
    to: result.to,
    options: result.options.map(option => ({
      label: option.label,
      detail: option.detail,
      type: option.kind === 'keyword' ? 'keyword' : option.kind === 'file' ? 'text' : 'function',
      apply: option.insertText ?? option.label,
    })),
  };
}

export function OpenScadSourceEditor({
  value,
  onChange,
  readOnly = false,
  ariaLabel,
  project,
  currentPath,
  onSelectFile,
  definitionTarget,
  viewportKey,
  onSave,
  onDiscard,
  isDirty = false,
  isSaving = false,
}: OpenScadSourceEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableRef = useRef(new Compartment());
  const initialRef = useRef({ value, readOnly, ariaLabel });
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onSelectFileRef = useRef(onSelectFile);
  const completionRef = useRef<CompletionState>({ project, currentPath });
  const syncingRef = useRef(false);
  const [position, setPosition] = useState('Line 1, column 1');
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const [syntaxIssueCount, setSyntaxIssueCount] = useState(0);
  const [definitionStatus, setDefinitionStatus] = useState<string | null>(null);
  const [signatureHelp, setSignatureHelp] = useState<OpenScadSignatureHint | null>(null);
  const [snippetCategory, setSnippetCategory] = useState<OpenScadSnippetCategory>('Shapes');
  const [snippetQuery, setSnippetQuery] = useState('');
  const [snippetHint, setSnippetHint] = useState<OpenScadSnippet | null>(null);
  const query = snippetQuery.trim().toLowerCase();
  const visibleSnippets = openScadSnippets.filter(item =>
    query
      ? (item.label + ' ' + item.description + ' ' + item.category).toLowerCase().includes(query)
      : item.category === snippetCategory,
  );

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    onSelectFileRef.current = onSelectFile;
    completionRef.current = { project, currentPath };
  }, [onChange, onSave, project, currentPath]);

  useEffect(() => {
    const parent = viewportRef.current;
    if (!parent) return;
    const initial = initialRef.current;
    const editable = editableRef.current;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          basicSetup,
          oneDark,
          scadLanguage,
          linter(view => getOpenScadBasicDiagnostics(view.state.doc.toString()), { delay: 500 }),
          lintGutter(),
          keymap.of(lintKeymap),
          autocompletion({ override: [context => completionSource(context, completionRef)] }),
          EditorView.lineWrapping,
          editable.of([
            EditorState.readOnly.of(initial.readOnly),
            EditorView.editable.of(!initial.readOnly),
          ]),
          EditorView.domEventHandlers({
            keydown(event) {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                onSaveRef.current?.();
                return true;
              }
              return false;
            },
          }),
          EditorView.updateListener.of(update => {
            setSyntaxIssueCount(diagnosticCount(update.state));
            if (update.docChanged && !syncingRef.current) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (update.docChanged) {
              setHistoryDepth({ undo: undoDepth(update.state), redo: redoDepth(update.state) });
            }
            if (update.docChanged || update.selectionSet) {
              const head = update.state.selection.main.head;
              setSignatureHelp(getOpenScadSignatureHelp({
                source: update.state.doc.toString(), cursor: head,
                project: completionRef.current.project, currentPath: completionRef.current.currentPath,
              }));
              const line = update.state.doc.lineAt(head);
              setPosition('Line ' + line.number + ', column ' + (head - line.from + 1));
            }
          }),
        ],
      }),
    });
    view.contentDOM.setAttribute('aria-label', initial.ariaLabel);
    view.contentDOM.setAttribute('role', 'textbox');
    view.contentDOM.setAttribute('aria-multiline', 'true');
    view.contentDOM.setAttribute('spellcheck', 'false');
    view.contentDOM.setAttribute('autocapitalize', 'off');
    view.contentDOM.setAttribute('autocomplete', 'off');
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncingRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    } finally {
      syncingRef.current = false;
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  useEffect(() => {
    viewRef.current?.contentDOM.setAttribute('aria-label', ariaLabel);
  }, [ariaLabel]);

  useEffect(() => {
    if (!definitionTarget || definitionTarget.path !== currentPath) return;
    const view = viewRef.current;
    if (!view) return;
    const offset = Math.max(0, Math.min(definitionTarget.offset, view.state.doc.length));
    view.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: 'center' }) });
    view.focus();
  }, [definitionTarget, currentPath]);

  // Android Chrome can change the visual viewport without changing the
  // CodeMirror document. Remeasure and scroll the caret into the actual
  // resized scroller; otherwise typing may continue beneath the footer.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      view.requestMeasure();
      secondFrame = requestAnimationFrame(() => {
        if (viewRef.current !== view) return;
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.selection.main.head, {
            y: 'nearest', yMargin: 8,
          }),
        });
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [viewportKey]);

  useEffect(() => {
    const handlePointer = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.querySelector('.scad-editor__toolbar')?.contains(event.target as Node)) {
        closeMenus();
      }
    };
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const root = rootRef.current;
      const menu = root?.querySelector<HTMLDetailsElement>('details[open]');
      if (!menu) return;
      menu.open = false;
      menu.querySelector('summary')?.focus();
      event.preventDefault();
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  const closeMenus = () => {
    rootRef.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(menu => {
      menu.open = false;
    });
  };
  const showMenu = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) return;
    rootRef.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(menu => {
      if (menu !== event.currentTarget) menu.open = false;
    });
  };
  const withView = (command: (view: EditorView) => void, focusEditor = true) => {
    const view = viewRef.current;
    if (!view) return;
    command(view);
    closeMenus();
    if (focusEditor) view.focus();
  };
  const insertSnippet = (snippet: OpenScadSnippet) => {
    if (readOnly) return;
    withView(view => {
      const range = view.state.selection.main;
      const selected = view.state.sliceDoc(range.from, range.to);
      view.dispatch(view.state.replaceSelection(insertOpenScadSnippet(snippet, selected)));
    });
  };
  const goToDefinition = () => withView(view => {
    const { project: currentProject, currentPath: path } = completionRef.current;
    const definition = findOpenScadProjectDefinition(currentProject, path, view.state.doc.toString(), view.state.selection.main.head);
    if (!definition) {
      setDefinitionStatus('No project definition at cursor (modules, functions, variables or parameters).');
      return;
    }
    setDefinitionStatus(definition.kind.charAt(0).toUpperCase() + definition.kind.slice(1) + ': ' + definition.name);
    if (definition.path === path) {
      // In the current file, move the actual selection synchronously. Merely
      // asking the parent to reselect the file could leave a stale caret line.
      view.dispatch({
        selection: { anchor: definition.offset },
        effects: EditorView.scrollIntoView(definition.offset, { y: 'center' }),
      });
    } else {
      onSelectFileRef.current?.(definition.path, definition.offset);
    }
  });
  const selectAllMatches = () => withView(view => {
    if (view.state.selection.main.empty) selectNextOccurrence(view);
    selectSelectionMatches(view);
  });
  const selectNextMatch = () => withView(view => { selectNextOccurrence(view); });
  const changeFile = (nextPath: string) => {
    if (nextPath !== currentPath) onSelectFile?.(nextPath);
    closeMenus();
  };

  return (
    <div ref={rootRef} className="scad-editor" data-testid="scad-editor">
      <nav className="scad-editor__toolbar" aria-label="OpenSCAD editor tools">
        {project && currentPath ? (
          <select
            aria-label="Open project file"
            title="Open project file"
            className="scad-editor__file"
            value={currentPath}
            onChange={event => changeFile(event.target.value)}
            disabled={!onSelectFile || isSaving}
          >
            {project.files.map(file => (
              <option key={file.path} value={file.path}>{file.path}</option>
            ))}
          </select>
        ) : (
          <span className="scad-editor__file" title={currentPath ?? 'OpenSCAD'}>{currentPath ?? 'OpenSCAD'}</span>
        )}
        <span className="scad-editor__separator" aria-hidden="true" />

        <button
          type="button" className="scad-editor__icon" aria-label="Find / replace"
          title="Find / replace"
          onClick={() => withView(view => { openSearchPanel(view); }, false)}
        >
          <Search aria-hidden="true" />
        </button>

        <details className="scad-editor__menu" onToggle={showMenu}>
          <summary className="scad-editor__icon" role="button" tabIndex={0}
            aria-label="Insert OpenSCAD code" title="Insert OpenSCAD code">
            <Shapes aria-hidden="true" />
          </summary>
          <div className="scad-editor__panel scad-editor__panel--wide" aria-label="OpenSCAD snippets">
            <div className="scad-editor__snippet-heading">
              <span>Insert OpenSCAD code</span>
              <span>{openScadSnippets.length} tools</span>
            </div>
            <div className="scad-editor__snippet-search-wrap">
              <Search aria-hidden="true" />
              <input
                className="scad-editor__snippet-search"
                type="search"
                aria-label="Search OpenSCAD snippets"
                placeholder="Search commands…"
                value={snippetQuery}
                onChange={event => {
                  setSnippetQuery(event.target.value);
                  setSnippetHint(null);
                }}
              />
            </div>
            <div className="scad-editor__snippet-categories" role="group" aria-label="Snippet categories">
              {snippetCategories.map(category => (
                <button
                  type="button"
                  key={category}
                  className="scad-editor__category"
                  aria-pressed={!query && snippetCategory === category}
                  title={category}
                  onClick={() => {
                    setSnippetCategory(category);
                    setSnippetQuery('');
                    setSnippetHint(null);
                  }}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="scad-editor__snippet-grid" role="group" aria-label="Available OpenSCAD snippets">
              {visibleSnippets.map(item => {
                const Glyph = snippetIcons[item.icon];
                return (
                  <button
                    type="button"
                    key={item.id}
                    className="scad-editor__snippet"
                    aria-label={item.label}
                    title={item.label + ' — ' + item.description}
                    data-snippet={item.id}
                    disabled={readOnly}
                    onMouseEnter={() => setSnippetHint(item)}
                    onFocus={() => setSnippetHint(item)}
                    onTouchStart={() => setSnippetHint(item)}
                    onClick={() => insertSnippet(item)}
                  >
                    <Glyph aria-hidden="true" />
                    <span className="scad-editor__snippet-caption" aria-hidden="true">
                      {getOpenScadSnippetCaption(item)}
                    </span>
                  </button>
                );
              })}
              {!visibleSnippets.length && (
                <div className="scad-editor__snippet-empty">No matching commands</div>
              )}
            </div>
            <div className="scad-editor__snippet-hint" aria-live="polite">
              {snippetHint && visibleSnippets.some(item => item.id === snippetHint.id)
                ? <><strong>{snippetHint.label}</strong> · {snippetHint.description}</>
                : <>{query ? visibleSnippets.length + ' matches' : snippetCategory + ' · ' + visibleSnippets.length + ' tools'}</>}
            </div>
          </div>
        </details>

        <details className="scad-editor__menu scad-editor__selection-menu" onToggle={showMenu}>
          <summary className="scad-editor__icon" role="button" tabIndex={0}
            aria-label="Selection tools" title="Selection tools">
            <MousePointer2 aria-hidden="true" />
          </summary>
          <div className="scad-editor__panel" aria-label="Selection actions">
            <div className="scad-editor__panel-title">Selection tools</div>
            <div className="scad-editor__menu-actions">
              <button type="button" aria-label="Next match" onClick={selectNextMatch}>Next match</button>
              <button type="button" aria-label="Select all matches" onClick={selectAllMatches}>Select all matches</button>
            </div>
          </div>
        </details>

        <details className="scad-editor__menu" onToggle={showMenu}>
          <summary className="scad-editor__icon" role="button" tabIndex={0}
            aria-label="More editor tools" title="More editor tools">
            <Ellipsis aria-hidden="true" />
          </summary>
          <div className="scad-editor__panel" aria-label="Additional editor actions">
            <div className="scad-editor__panel-title">Editor tools</div>
            <div className="scad-editor__menu-actions">
              <button type="button" aria-label="Undo" disabled={readOnly || historyDepth.undo === 0}
                onClick={() => withView(view => { undo(view); })}>Undo</button>
              <button type="button" aria-label="Redo" disabled={readOnly || historyDepth.redo === 0}
                onClick={() => withView(view => { redo(view); })}>Redo</button>
              <button type="button" aria-label="Complete" onClick={() => withView(view => { startCompletion(view); })}>Complete</button>
              <button type="button" aria-label="Go to line" onClick={() => withView(view => { gotoLine(view); }, false)}>Go to line</button>
              <button type="button" aria-label="Show syntax issues" onClick={() => withView(view => { openLintPanel(view); }, false)}>Syntax issues</button>
              <button type="button" aria-label="Go to definition" onClick={goToDefinition}>Go to definition</button>
              <button type="button" aria-label="Discard" disabled={!isDirty || isSaving || !onDiscard}
                onClick={() => { closeMenus(); onDiscard?.(); }}>Discard</button>
              <button className="scad-editor__selection-compact" type="button" aria-label="Next match"
                onClick={selectNextMatch}>Next match</button>
              <button className="scad-editor__selection-compact" type="button" aria-label="Select all matches"
                onClick={selectAllMatches}>Select all matches</button>
            </div>
          </div>
        </details>

        <span className="scad-editor__spacer" />
        <button type="button" className="scad-editor__save" aria-label="Save" title="Save"
          disabled={readOnly || !isDirty || isSaving || !onSave}
          onClick={() => { closeMenus(); onSave?.(); }}>
          <Save aria-hidden="true" />
          <span>{isSaving ? 'Saving…' : 'Save'}</span>
        </button>
      </nav>
      {signatureHelp && (
        <div className="scad-editor__signature" role="status" aria-label="OpenSCAD signature help" data-testid="scad-signature-help">
          <span className="scad-editor__signature-context">
            {signatureHelp.kind === 'builtin' ? 'Built-in' : signatureHelp.path ?? signatureHelp.kind}
          </span>
          <span className="scad-editor__signature-code">
            <strong>{signatureHelp.name}</strong>{'('}
            {signatureHelp.parameters.map((parameter, index) => (
              <span key={index} data-active-parameter={index === signatureHelp.activeParameter ? 'true' : undefined} className={index === signatureHelp.activeParameter ? 'scad-editor__signature-active' : undefined}>
                {index > 0 ? ', ' : ''}{parameter}
              </span>
            ))}
            {')'}
          </span>
        </div>
      )}
      <div ref={viewportRef} className="scad-editor__viewport" />
      <div className="scad-editor__status" role="status">
        <span className={isDirty ? 'scad-editor__status-dirty' : undefined}>
          {readOnly ? 'Read-only' : isDirty ? 'Unsaved changes' : 'Saved'}
        </span>
        {definitionStatus ? (
          <span className="scad-editor__status-feedback" role="alert" title={definitionStatus}>{definitionStatus}</span>
        ) : (
          <span>{syntaxIssueCount ? syntaxIssueCount + ' basic syntax ' + (syntaxIssueCount === 1 ? 'issue' : 'issues') : 'Basic syntax: clear'}</span>
        )}
        <span>{position}</span>
      </div>
    </div>
  );
}
