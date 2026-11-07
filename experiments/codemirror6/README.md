# OpenSCAD CodeMirror 6 – isolated technical prototype

This is a **non-production proof of concept**, created for Brepia Viewer. It is intentionally
outside `src/` and is **not imported** by the application, CI bundle, WebAssembly renderer,
IndexedDB storage or GitHub Pages deployment. The main site is unchanged.

## Run

From this directory (requires Node compatible with Vite 8):

```sh
npm install
npm run build
npx playwright install chromium
npm run test:smoke
npm run dev
```

Open the local Vite URL. A second command, `npm run build`, checks whether this
standalone prototype bundles. A dedicated GitHub Actions workflow builds this experiment and runs Chromium
smoke checks at desktop and mobile-touch viewports. A physical Android or iOS
IME and production WebAssembly integration remain untested.

## Scope

* CodeMirror 6, line numbers, bracket pairing, base multi-cursor/search/undo/folding
  capabilities, dark theme and compact touch controls.
* A first OpenSCAD-oriented syntax mode using CodeMirror's **legacy C-like mode**.
  This is intentionally **not a full OpenSCAD grammar**.
* Sample built-in keyword/module suggestions and sample project-file completions.
* Sample 2-file switching, with in-memory per-file draft and Save/Discard behavior.
* Cube snippet and Translate wrapping of the current selection.
* No persisted user models, no production data and no render/export operations.

## Verified prototype baseline (2026-11-07)

* Branch: `prototype/codemirror6-openscad-editor`.
* Verified code SHA: `39a95210c37a18161deacf9b8f7e82e406a0d2ea`.
* [GitHub Actions smoke run 42360696889](https://github.com/weaf/brepia_viewer/actions/runs/42360696889):
  dependency install PASS, Vite build PASS, eight Chromium assertions PASS on
  desktop (1440 × 900) and eight PASS on emulated mobile (390 × 844).
* Inspected screenshots show the actual CodeMirror content surface now stretches
  to fill the editor viewport on both layouts, without horizontal page overflow.
  The workflow retains a `codemirror-prototype-smoke` artifact with screenshots
  and `results.json`.
* Auto-completion acceptance must not be tested during CodeMirror's default
  75 ms `interactionDelay` safety window. The smoke test waits 140 ms rather
  than weakening the editor behavior.

## Still unverified

This is **not** a real Brepia Viewer integration or a physical Android/iOS
virtual-keyboard test. IME composition, real IndexedDB persistence,
multi-file project save semantics, rendering, parameter sliders and export
must be tested against the production application when integrating.

## Integration gate before replacing OpenScadSourceEditor.tsx

1. Install pinned CodeMirror 6 dependencies in the **root** package and update the root
   package-lock.json. Avoid runtime CDNs in production.
2. Replace only the editor input surface; keep `value`, `onChange`, `project`,
   `currentPath` props and `ProjectFilesEditor`'s save callback contract.
3. Use the existing `getOpenScadCompletionContext` from `src/lib/openScadEditor.ts`
   rather than duplicating the sample completion catalog in this experiment.
4. Keep editor change events independent from WebAssembly rendering; no per-keystroke
   3D compilation or new server dependency.
5. Confirm `Save` persists, `Discard` restores the saved source, file switching
   preserves unsaved drafts or guards against data loss, and close-with-dirty behavior
   is explicitly defined.
6. Test the existing project format and customizer parser, including the existing
   per-file 256,000 UTF-8 byte and total-project 1 MiB limits.
7. Verify mobile keyboard, scroll, multi-cursor, and no horizontal page overflow
   at 390×844; desktop 1440×900; then run `npm run check` and the
   `.github/scripts/static-viewer-smoke.mjs` test from a real production build.
8. For structural linting, test `openscad/tree-sitter-openscad` in browser WASM
   separately; do not treat the C-like colorizer or naive regexes as syntax diagnostics.

## External projects considered

* CodeMirror 6: https://codemirror.net/docs/ref/ – MIT.
* OpenSCAD Playground: https://github.com/openscad/openscad-playground –
  OpenSCAD-specific Monaco implementation (GPL compatible).
* OpenSCAD Tree-sitter grammar: https://github.com/openscad/tree-sitter-openscad – MIT.
* OpenSCAD LSP: https://github.com/Leathong/openscad-LSP – Apache-2.0, native Rust
  implementation; browser transport/compilation requires a separate feasibility study.
* Monaco Editor: https://github.com/microsoft/monaco-editor – MIT, mobile browsers
  not officially supported.
