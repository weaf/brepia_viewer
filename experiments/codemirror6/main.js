import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { clike } from '@codemirror/legacy-modes/mode/clike';
import {
  autocompletion,
  startCompletion,
  completionKeymap,
  selectedCompletion,
  completionStatus,
} from '@codemirror/autocomplete';
import {
  openSearchPanel,
  gotoLine,
  selectNextOccurrence,
  selectSelectionMatches,
} from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';

// A lightweight colorizer only. Tree-sitter-based structural syntax checking is
// deliberately left to a later phase. Do not mistake this for a real parser.
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

const fixture = new Map([
  [
    'main.scad',
    '// Brepia Viewer CodeMirror evaluation\ninclude <lib/shape.scad>\n\nwidth = 30; // [10:1:100]\nheight = 12; // [2:1:40]\n\ntranslate([0, 0, 0]) {\n    demo_shape(width, height);\n}\n',
  ],
  [
    'lib/shape.scad',
    'module demo_shape(width, height) {\n    difference() {\n        cube([width, width, height], center = true);\n        cylinder(h = height + 2, d = width / 3, center = true);\n    }\n}\n',
  ],
]);

const saved = new Map(fixture);
const drafts = new Map(fixture);
let activePath = 'main.scad';
let isSwitching = false;

const elements = {
  file: document.querySelector('#file'),
  status: document.querySelector('#status'),
  position: document.querySelector('#position'),
  save: document.querySelector('#save'),
  discard: document.querySelector('#discard'),
};

const keywords = [
  { label: 'cube', type: 'function', detail: '3D primitive', apply: 'cube([10, 10, 10], center = true);' },
  { label: 'sphere', type: 'function', detail: '3D primitive', apply: 'sphere(r = 10);' },
  { label: 'cylinder', type: 'function', detail: '3D primitive', apply: 'cylinder(h = 20, r = 5, center = true);' },
  { label: 'translate', type: 'function', detail: 'Transform', apply: 'translate([10, 0, 0]) {\n    cube([10, 10, 10]);\n}' },
  { label: 'rotate', type: 'function', detail: 'Transform', apply: 'rotate([0, 0, 45]) {\n    cube([10, 10, 10]);\n}' },
  { label: 'scale', type: 'function', detail: 'Transform', apply: 'scale([1, 1, 1]) {\n    cube([10, 10, 10]);\n}' },
  { label: 'difference', type: 'function', detail: 'Boolean operation', apply: 'difference() {\n    cube([20, 20, 20]);\n    sphere(r = 10);\n}' },
  { label: 'union', type: 'function', detail: 'Boolean operation', apply: 'union() {\n    cube(10);\n    sphere(5);\n}' },
  { label: 'intersection', type: 'function', detail: 'Boolean operation', apply: 'intersection() {\n    cube(10);\n    sphere(8);\n}' },
  ...['module', 'function', 'for', 'if', 'else', 'include', 'use'].map(word => ({
    label: word, type: 'keyword', detail: 'OpenSCAD keyword',
  })),
];

function completeScad(context) {
  const prefix = context.state.sliceDoc(0, context.pos);
  const fileMatch = prefix.match(/\b(?:include|use)\s*<([^>]*)$/);
  if (fileMatch) {
    const typed = fileMatch[1];
    return {
      from: context.pos - typed.length,
      options: [...saved.keys()]
        .filter(path => path !== activePath)
        .map(path => ({ label: path, type: 'text', detail: 'Project file' })),
    };
  }

  const token = context.matchBefore(/[$A-Za-z_][$A-Za-z_0-9]*/);
  if (!token || (!context.explicit && token.text.length < 2)) return null;

  // Only a proof of concept. It will later call the project's existing
  // getOpenScadCompletionContext and use an AST to exclude comments/strings.
  const projectNames = [];
  for (const [path, code] of drafts) {
    const regexp = /\b(module|function)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    for (const match of code.matchAll(regexp)) {
      projectNames.push({ label: match[2], type: match[1] === 'module' ? 'function' : 'function', detail: path });
    }
  }
  return { from: token.from, options: [...keywords, ...projectNames] };
}

function updateUi(view) {
  const code = view.state.doc.toString();
  const dirty = code !== saved.get(activePath);
  elements.status.dataset.dirty = String(dirty);
  elements.status.textContent = dirty ? activePath + ' · Unsaved changes' : activePath + ' · Saved';
  elements.save.disabled = !dirty;
  elements.discard.disabled = !dirty;

  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  elements.position.textContent = 'Line ' + line.number + ', column ' + (head - line.from + 1);
}

const view = new EditorView({
  parent: document.querySelector('#editor'),
  doc: drafts.get(activePath),
  extensions: [
    // Completion acceptance must take priority over newline/indent handlers.
    Prec.highest(keymap.of(completionKeymap)),
    basicSetup,
    oneDark,
    scadLanguage,
    autocompletion({ override: [completeScad] }),
    EditorView.lineWrapping,
    EditorView.updateListener.of(update => {
      if (update.docChanged && !isSwitching) drafts.set(activePath, update.state.doc.toString());
      updateUi(update.view);
    }),
  ],
});
// The smoke harness can inspect CodeMirror state without affecting normal use.
if (new URLSearchParams(window.location.search).has('smoke')) {
  window.__brepiaSmokeView = view;
  window.__brepiaSmokeCompletion = () => ({
    status: completionStatus(view.state),
    selected: selectedCompletion(view.state)?.label ?? null,
  });
}
view.contentDOM.setAttribute('aria-label', 'OpenSCAD source editor');
view.contentDOM.setAttribute('spellcheck', 'false');
view.contentDOM.setAttribute('autocapitalize', 'off');
view.contentDOM.setAttribute('autocomplete', 'off');
updateUi(view);

function replaceDocument(next) {
  isSwitching = true;
  try {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: { anchor: 0 },
      scrollIntoView: true,
    });
  } finally {
    isSwitching = false;
  }
  updateUi(view);
}

elements.file.addEventListener('change', event => {
  drafts.set(activePath, view.state.doc.toString());
  activePath = event.target.value;
  replaceDocument(drafts.get(activePath));
  view.focus();
});

elements.save.addEventListener('click', () => {
  const code = view.state.doc.toString();
  saved.set(activePath, code);
  drafts.set(activePath, code);
  updateUi(view);
});

elements.discard.addEventListener('click', () => {
  const restored = saved.get(activePath);
  drafts.set(activePath, restored);
  replaceDocument(restored);
  view.focus();
});

function insert(text) {
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

document.querySelector('#cube').addEventListener('click', () => insert('cube([10, 10, 10], center = true);'));
document.querySelector('#translate').addEventListener('click', () => {
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  const code = selected
    ? 'translate([10, 0, 0]) {\n' + selected.split('\n').map(line => '    ' + line).join('\n') + '\n}'
    : 'translate([10, 0, 0]) {\n    cube([10, 10, 10]);\n}';
  insert(code);
});
document.querySelector('#find').addEventListener('click', () => { openSearchPanel(view); view.focus(); });
document.querySelector('#next').addEventListener('click', () => { selectNextOccurrence(view); view.focus(); });
document.querySelector('#all').addEventListener('click', () => {
  if (view.state.selection.main.empty) selectNextOccurrence(view);
  selectSelectionMatches(view);
  view.focus();
});
document.querySelector('#complete').addEventListener('click', () => { view.focus(); startCompletion(view); });
document.querySelector('#line').addEventListener('click', () => { gotoLine(view); view.focus(); });
