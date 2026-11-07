import { EditorView, basicSetup } from 'codemirror';
import { StreamLanguage } from '@codemirror/language';
import { clike } from '@codemirror/legacy-modes/mode/clike';
import { autocompletion, startCompletion } from '@codemirror/autocomplete';
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

const snippets = {
  cube: { code: 'cube([10, 10, 10], center = true);' },
  sphere: { code: 'sphere(r = 10);' },
  cylinder: { code: 'cylinder(h = 20, r = 5, center = true);' },
  translate: { before: 'translate([10, 0, 0])', defaultBody: 'cube([10, 10, 10]);' },
  rotate: { before: 'rotate([0, 0, 45])', defaultBody: 'cube([10, 10, 10]);' },
  scale: { before: 'scale([1, 1, 1])', defaultBody: 'cube([10, 10, 10]);' },
  mirror: { before: 'mirror([1, 0, 0])', defaultBody: 'cube([10, 10, 10]);' },
  union: { before: 'union()', defaultBody: 'cube(10);\nsphere(5);' },
  difference: { before: 'difference()', defaultBody: 'cube(20);\nsphere(9);' },
  intersection: { before: 'intersection()', defaultBody: 'cube(20);\nsphere(13);' },
  color: { before: 'color("steelblue")', defaultBody: 'cube(10);' },
  'linear-extrude': { before: 'linear_extrude(height = 10)', defaultBody: 'circle(r = 5);' },
  'rotate-extrude': { before: 'rotate_extrude(angle = 360)', defaultBody: 'translate([10, 0, 0]) circle(r = 2);' },
  module: { before: 'module my_part(size = 10)', defaultBody: 'cube(size);' },
  function: { code: 'function double_value(x) = x * 2;' },
  for: { before: 'for (i = [0:4])', defaultBody: 'translate([i * 10, 0, 0]) sphere(r = 3);' },
  'if-else': { code: 'if (true) {\n    cube(10);\n} else {\n    sphere(5);\n}' },
  parameter: { code: 'width = 30; // [10:1:100]' },
};

function applySnippet(name) {
  const item = snippets[name];
  if (!item) return;
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  if (!item.before) { insert(item.code); return; }
  const body = (selected || item.defaultBody)
    .split('\n')
    .map(line => line.trim() ? '    ' + line : line)
    .join('\n');
  insert(item.before + ' {\n' + body + '\n}');
}

document.querySelectorAll('[data-snippet]').forEach(button => {
  button.addEventListener('click', () => applySnippet(button.dataset.snippet));
});

// Native details/summary supports pointer, keyboard, and assistive technology.
// Keep one category open; dismiss by Escape, outside pointer or an action click.
const toolbar = document.querySelector('.toolbar');
const menus = [...toolbar.querySelectorAll('details.tool-menu')];
menus.forEach(menu => {
  menu.addEventListener('toggle', () => {
    if (menu.open) menus.filter(other => other !== menu).forEach(other => { other.open = false; });
  });
});
function closeMenus() {
  for (const menu of menus) menu.open = false;
}
toolbar.addEventListener('click', event => {
  if (event.target.closest('.menu-panel button')) queueMicrotask(closeMenus);
});
document.addEventListener('pointerdown', event => {
  if (!toolbar.contains(event.target)) closeMenus();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const open = menus.find(menu => menu.open);
  if (!open) return;
  event.preventDefault();
  open.open = false;
  open.querySelector('summary')?.focus();
});

document.querySelector('#find').addEventListener('click', () => { openSearchPanel(view); view.focus(); });
for (const button of document.querySelectorAll('#next, #next-compact')) {
  button.addEventListener('click', () => { selectNextOccurrence(view); view.focus(); });
}
for (const button of document.querySelectorAll('#all, #all-compact')) {
  button.addEventListener('click', () => {
    if (view.state.selection.main.empty) selectNextOccurrence(view);
    selectSelectionMatches(view);
    view.focus();
  });
}
document.querySelector('#complete').addEventListener('click', () => { view.focus(); startCompletion(view); });
document.querySelector('#line').addEventListener('click', () => { gotoLine(view); view.focus(); });
