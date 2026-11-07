import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, SyntheticEvent } from 'react';
import { Ellipsis, MousePointer2, Save, Search, Shapes } from 'lucide-react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
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
import {
  insertOpenScadSnippet,
  openScadSnippets,
  snippetCategories,
  type OpenScadSnippet,
} from '@/lib/openScadSnippets';
import './OpenScadSourceEditor.css';

interface OpenScadSourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  ariaLabel: string;
  project?: OpenScadProject;
  currentPath?: string | null;
  onSelectFile?: (path: string) => void;
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
  const completionRef = useRef<CompletionState>({ project, currentPath });
  const syncingRef = useRef(false);
  const [position, setPosition] = useState('Line 1, column 1');

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
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
            if (update.docChanged && !syncingRef.current) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (update.docChanged || update.selectionSet) {
              const head = update.state.selection.main.head;
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
            <div className="scad-editor__panel-title">Insert OpenSCAD code</div>
            {snippetCategories.map(category => (
              <section className="scad-editor__section" key={category} aria-label={category}>
                <h3 className="scad-editor__section-title">{category}</h3>
                <div className="scad-editor__grid">
                  {openScadSnippets.filter(item => item.category === category).map(item => (
                    <button type="button" key={item.id} aria-label={item.label}
                      disabled={readOnly} onClick={() => insertSnippet(item)}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>
            ))}
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
              <button type="button" aria-label="Complete" onClick={() => withView(view => { startCompletion(view); })}>Complete</button>
              <button type="button" aria-label="Go to line" onClick={() => withView(view => { gotoLine(view); }, false)}>Go to line</button>
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
      <div ref={viewportRef} className="scad-editor__viewport" />
      <div className="scad-editor__status" role="status">
        <span className={isDirty ? 'scad-editor__status-dirty' : undefined}>
          {readOnly ? 'Read-only' : isDirty ? 'Unsaved changes' : 'Saved'}
        </span>
        <span>{position}</span>
      </div>
    </div>
  );
}
