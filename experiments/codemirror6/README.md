# OpenSCAD CodeMirror 6 – isolated technical prototype

This is a **non-production proof of concept**, created for Brepia Viewer. It is intentionally
outside `src/` and is **not imported** by the application, CI bundle, WebAssembly renderer,
IndexedDB storage or GitHub Pages deployment. The main site is unchanged.

## Phase 3 – real React integration (2026-11-07)

**Implemented on this branch, not deployed to main.** The reusable React
CodeMirror editor is now in `src/components/parameter/OpenScadSourceEditor.tsx`,
with compact responsive controls in its CSS and a dedicated snippet catalog in
`src/lib/openScadSnippets.ts`. `ProjectFilesEditor.tsx` connects it to the
existing model persistence via `onSaveFile`, keeps drafts per source file,
and confirms before closing unsaved work. Completion calls the existing
`getOpenScadCompletionContext`.

**Verified against the real static viewer:**
[GitHub Actions run 42369587983](https://github.com/weaf/brepia_viewer/actions/runs/42369587983)
passed ESLint, Vitest, TypeScript, production and GitHub Pages builds,
Playwright desktop and mobile checks, real Save/Discard, snippet insertion,
visible 3D rendering and STL export. No Playwright violations, JavaScript
errors, missing assets or HTTP failures; the OpenSCAD WASM requests returned
HTTP 200. The exact tested dependency lockfile was committed automatically as
`c047714d87a33ca0df66ffd2df66898a09473437`.

**Completed follow-up gates:** real folder import using `use`/`include`,
two-file independent unsaved drafts, single-file Discard, consecutive Save
without losing the other file, re-opening saved files, parameter slider
source persistence, and visible 3D model at desktop and emulated mobile
viewports. See Phase 3.1 below.

**Next unverified gates:** physical Android/iOS virtual keyboard and actual
IME composition, plus the owner's visual acceptance. Do not merge/release
or switch the live site without that approval.

## Owner test preview – published without merging (2026-11-07)

**Test link:** https://viewer.notydesign.se/editor-preview/

**Deployment:** [isolated test preview run 42395166767](https://github.com/weaf/brepia_viewer/actions/runs/42395166767)
at source commit `0d8511b6568068a5f42304d34efec5cea4998368` – **SUCCESS**.
The GitHub Pages upload/deploy succeeded. Browser smoke passed at
`/editor-preview/` for desktop and mobile, with a visible WebAssembly-rendered
3D model and valid STL download; all generated preview asset requests returned
200 and no browser exceptions were reported.

**Production root protection:** the workflow retrieved the exact artifact
(`github-pages`) from the last approved main deployment
[42352859741](https://github.com/weaf/brepia_viewer/actions/runs/42352859741),
retained all existing root files byte-for-byte and added only the
`/editor-preview/` subtree. The main branch stayed unchanged. The workflow
checks equality against the original artifact before deploying and refuses
to publish if the pinned main SHA changes.

**Storage isolation:** the preview builds with
`VITE_PREVIEW_STORAGE_NAMESPACE=pr10`; IndexedDB uses
`brepia-local-models-preview-pr10` and appearance preference uses
`brepia-appearance-preview-pr10`. Ordinary models stored at the root under
`brepia-local-models` are not read or written by this test build.
Browser storage is still local to the device; preview models are disposable.

**External access qualification:** external command-line requests to the custom
domain returned HTTP 403, so the preview's public URL was not independently
opened outside GitHub's build runner. GitHub Pages accepted the deployment;
the owner should confirm access in the signed-in browser.

**Owner acceptance:** on a physical phone, open the link, import a disposable
`.scad` model, use Open, type Swedish characters with the real soft keyboard,
test autocomplete and the Insert menu, Save/Discard, render and export. Check
portrait and landscape, including virtual-keyboard resizing and cursor
visibility. Record any defects before the draft PR is merged or released.

## Phase 3.4 – compact icon palette and expanded OpenSCAD library (2026-11-07)

**Owner test URL:** https://viewer.notydesign.se/editor-preview/

**Deployed source commit:** `e2724cb1f87df193ea49c97320908b51006261cb`.
[Isolated preview deployment 42399477024](https://github.com/weaf/brepia_viewer/actions/runs/42399477024):
**PASS** (preview-path static browser smoke + production root preservation + Pages publish).

The Insert menu now uses a compact, single-category-at-a-time six-column
**icon-only** layout with 44px touch targets, 19px glyphs, a horizontally
scrollable category strip, a search field and accessible names/tooltips. The
selected/hovered item is explained in a small footer instead of an oversized
card. Existing editor toolbar, project persistence and Save/Discard are unchanged.

The centralized `src/lib/openScadSnippets.ts` now contains **57 templates in
nine categories**: Shapes, Transform, Booleans, 2D & extrude, Modifiers,
Programming, Parameters, Files and Templates. New examples include a hollow
tube, screw hole, enclosure shell, grid/radial arrays, rounded plate, a
mounting tab, 2D primitives, file references and OpenSCAD modifiers.
Placeholders for imported external files still require the referenced files.

**Accepted automated evidence:**
- [CI run 42399256229](https://github.com/weaf/brepia_viewer/actions/runs/42399256229): **PASS**.
- [Static gallery/edit/render/export 42399256224](https://github.com/weaf/brepia_viewer/actions/runs/42399256224):
  **PASS**, no browser violations. Browser tests assert compact menu height,
  icon-only cells, searching for Cylinder, switching to Templates, inserting
  Tube, and Discard restoring the previous content.
- [Independent integration run 42399251432](https://github.com/weaf/brepia_viewer/actions/runs/42399251432):
  **PASS**, including two-file and parameter regressions.
- Retained screenshots: `mobile-compact-insert-menu.png` and
  `desktop-compact-insert-menu.png`, within the
  `static-viewer-smoke` artifact from run 42399256224. Screenshots were
  visually inspected: single category, six icons per row, searchable
  compact menu, no unexpected editor resize.

**Safe rollout:** preview uses its existing isolated IndexedDB and
`/editor-preview/` path. Production Pages files were copied byte-for-byte
from the last approved release artifact, with only the preview subtree
added. `main` remains at `f728a4832b0e0582f519ac14a68df2815b83ed69`.
PR #10 remains draft; the live homepage has not gained this new editor.

**Next:** owner reviews the preview on an actual phone. Physical soft keyboard,
native IME and owner acceptance are not covered by emulation. Tabstops,
user-created snippets and a favorites list are optional follow-on
capabilities, not part of this accepted slice.

## Phase 3.3 – import notice must not cover mobile toolbar (2026-11-07)

**Verified code commit:** `7e2ddaf9c1db7c5a9e5dbdc862f95652a3f8e16d`.
The previous mobile screenshot proved that the global `Model uploaded`
toast, shown at higher z-index than the source dialog, blocked the
compact editor controls.

The fix is scoped to successful uploads only: `ModelGalleryView` retains
the latest successful upload toast handle, and the `ProjectFilesEditor`
open callback dismisses it before opening the source dialog.
Error notifications, unrelated toasts, file drafts, Save/Discard and
the shared toaster layout remain unchanged.

- [Static smoke run 42383946205](https://github.com/weaf/brepia_viewer/actions/runs/42383946205):
  **PASS**, **24/24** Playwright assertions (12 desktop + 12 mobile touch
  emulation), including the previous keyboard, 3D, file and export checks.
- [Independent CodeMirror integration run 42383940747](https://github.com/weaf/brepia_viewer/actions/runs/42383940747):
  **PASS**.
- New acceptance check:
  `upload confirmation does not obscure editor toolbar`. It verifies
  the toast is hidden when the dialog opens and the Find button is the
  frontmost clickable element at its center.
- Screenshot evidence in the `static-viewer-smoke` artifact:
  `mobile-editor-toolbar-after-import.png` and
  `desktop-editor-toolbar-after-import.png`. Both screenshots have
  been reviewed: the toast no longer covers the toolbar, the editor
  fills its existing space and no visual regression is apparent.

Physical Android/iOS keyboard behavior remains **unverified**. PR #10
continues as draft. No merge, release or live-site change is authorized.

## Phase 3.2 – Unicode, keyboard completion, simulated IME (2026-11-07)

Code under test: `df74f869f01d3bbc3c84289aa36f27f1ae5f5a71`.
[Static Playwright run 42373648374](https://github.com/weaf/brepia_viewer/actions/runs/42373648374):
**PASS**, 11/11 desktop and 11/11 mobile-touch Chromium checks, including
the prior two-file, source-save, 3D and parameter regression. CI run
[42373648329](https://github.com/weaf/brepia_viewer/actions/runs/42373648329)
also passed.

The additional checks verify:

- Unicode entry of `åäö ÅÄÖ`, an insertion immediately before the final
  character, Backspace and no duplicated characters.
- A **synthetic** `compositionstart` → Unicode insertion →
  `compositionend` sequence, without lost or duplicated committed text.
- `cube(` automatically yields `cube()`, and the caret remains between the
  brackets; an explicit `sphere` completion is accepted by Enter after the
  CodeMirror interaction-delay safety window.
- Discard restores the original `main.scad` after each test.

Evidence in GitHub artifact `static-viewer-smoke` includes
`desktop-unicode-editor.png`, `mobile-unicode-editor.png` and
`multifile-results.json`. The screenshots were inspected: the text and
insertion caret are visible, but the upload-success toast temporarily overlays
the toolbar at the beginning of the mobile capture; therefore this screenshot
**does not** establish full mobile-toolbar visual acceptance. The overlay
can be assessed separately; it is not an editor input failure.

**Still not verified:** a real Android/iOS virtual keyboard (Gboard, Samsung
Keyboard, iOS keyboard), native IME candidate selection / composition, keyboard
viewport resizing or owner sign-off. Chromium touch emulation and synthetic
composition events cannot prove those behaviors. No merge or deploy.

### Physical-device owner acceptance checklist

Using the existing development checkout and `./start.sh` (do not test or
overwrite the live gallery), import a disposable two-file fixture and open the
source editor on a real mobile device.

1. Type `mått = 10; // åäö ÅÄÖ` using the device keyboard and replace a
   character in the middle of the comment; confirm cursor and characters
   remain correct without doubling.
2. Use the keyboard's native composition/candidate suggestions (for instance,
   Swedish predictive input or another installed IME); confirm candidate
   acceptance does not insert duplicate text or move the cursor.
3. Type `cube(` and a number between the paired brackets; use explicit
   completion on `sph` and confirm Enter accepts the suggestion once.
4. Switch between `main.scad` and `lib/geometry.scad` with an unsaved
   draft, then Discard the active file and Save the other; verify reopening.
5. With the on-screen keyboard open, check that the caret remains visible,
   the compact toolbar can still be reached, and the page does not overflow
   horizontally. Capture screenshots on both portrait and landscape if useful.

Record device, OS, keyboard/IME, browser version, test date, observed outcome,
and screenshots before marking physical keyboard acceptance as PASS.

## Phase 3.1 – multi-file and parameter acceptance (2026-11-07)

Tested commit: `24a773355c29f1d8fafdfc0133ae0742b217b071`.
The test fixtures are
`.github/fixtures/editor-twofiles/main.scad` and
`.github/fixtures/editor-twofiles/lib/geometry.scad`; test runner:
`.github/scripts/multifile-editor-smoke.mjs`.

- [PR static smoke run 42370899070](https://github.com/weaf/brepia_viewer/actions/runs/42370899070):
  **PASS**, 8/8 desktop + 8/8 mobile-touch emulation.
- [Integration run 42370893758](https://github.com/weaf/brepia_viewer/actions/runs/42370893758):
  **PASS**, same 16/16 multi-file assertions plus previous build/regression gates.
- Verified: real folder import; two separate drafts across switching; Discard
  isolation; Save one file without losing the other draft; reopening saved
  source; replace `use <lib/geometry.scad>` with `include <lib/geometry.scad>`;
  change parameter `width` 16 → 22 and confirm `width = 22;` appears in
  `main.scad`; visible 3D canvas and no horizontal page overflow.
- Screenshot evidence: `desktop-multifile-final.png`,
  `mobile-multifile-final.png`, import screenshots and
  `multifile-results.json` in the workflow artifact `static-viewer-smoke`.
  Visual inspection confirms the parameter panel and visible model at both
  viewport sizes.
- This is automated Chromium/mobile **touch emulation**, not a physical
  Android/iOS soft-keyboard or IME verification. No owner approval claimed.
- PR #10 remains a draft; main and the public GitHub Pages site are unchanged.

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

## Toolbar UI refinement

The isolated prototype now uses a **compact, icon-led toolbar**: direct Find,
one Insert menu (primitives, transformations, Boolean operations, and programming),
one Selection menu, one More tools menu, and an always-visible **Save** action.
Menus use native `details/summary`, semantic names, 44px targets, Escape/outside
dismissal, and do not shrink the editor when expanded. The additional snippets
are demonstration fixtures; production integration must reuse the real project
completion logic and preserve Save/Discard.

## Compact toolbar acceptance (2026-11-07)

* Code SHA: `74f31dd37172915f7bfa21d35e125fbf7b814493`.
* [GitHub Actions run 42365296855](https://github.com/weaf/brepia_viewer/actions/runs/42365296855):
  build PASS, **20/20** Chromium checks PASS (10 desktop, 10 emulated mobile).
* The updated smoke artifact contains `desktop-insert-menu.png`,
  `mobile-insert-menu.png`, `desktop.png`, `mobile.png`, and `results.json`.
* The open snippet menu overlays the editor without resizing the CodeMirror
  content area; actions have accessible labels, Escape dismissal, and touch-sized
  targets. A physical mobile keyboard has not been tested.
* Next: integrate only into the real React editor without changing the published
  GitHub Pages app until the existing project, storage, rendering, and export
  checks pass.

## Dense editor chrome refinement (2026-11-07)

The toolbar now includes the project-file selector and editor commands on one
row, removing the separate two-line title/header. Visual icons are 18px with
30px highlighted tiles, but actual pointer targets remain **44 × 44 CSS px**
on mobile; the compact shell is **48px high**. Save remains explicitly labeled.
At <=375px width the Selection menu moves into More so the toolbar does not wrap.
The prototype disclaimer is accessible inside More instead of permanently
occupying code space. The editor status is a narrow footer.

Research used:
* [Microsoft Fluent toolbar](https://fluent2.microsoft.design/components/web/react/core/toolbar/usage): one row, labeled overflow items, grouped actions.
* [Apple HIG buttons](https://developer.apple.com/design/human-interface-guidelines/buttons): 44pt hit targets.
* [W3C WCAG 2.2 SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum): 24px AA floor, which is not a recommended touch size.
* [Material icons](https://m1.material.io/style/icons.html): 20px dense glyphs, 40px targeting.
* [Nielsen Norman Group](https://www.nngroup.com/articles/contextual-menus-guidelines/): keep primary commands visible; secondary actions in menus.

Acceptance: GitHub Actions smoke at 1440×900, 390×844 and 320×700 verifies
toolbar one-row sizing, accessibility labels, menu behavior, code editing and
absence of horizontal page overflow. Physical iOS/Android keyboard remains unverified.

### Final density refinement

The file selector now keeps a compact custom chevron instead of a full-width
native select arrow. At 320–375px Save is an icon-only 44px hit target with an
explicit accessible name; at 390px+ the Save label remains visible. Mouse/fine
pointer desktops use 38px action targets and a 42px toolbar, while touch inputs
retain the larger 44px control targets. This intentionally differentiates the
visual treatment from hit area size.

## Dense-toolbar verified acceptance

* Evaluated code commit: `cb9d0fbd584d4440ec5961f13e49e1007f2b0133`.
* [GitHub Actions smoke run 42368262154](https://github.com/weaf/brepia_viewer/actions/runs/42368262154):
  Vite build **PASS**, Chromium **30/30 PASS** (10 desktop 1440 × 900,
  10 mobile 390 × 844, 10 narrow mobile 320 × 700).
* Evidence artifact: `codemirror-prototype-smoke`, containing
  `desktop.png`, `mobile.png`, `narrow-mobile.png`,
  the three `*-insert-menu.png` screenshots, and `results.json`.
* The 320px profile uses `isMobile: true`, `hasTouch: true` and validates
  `(pointer: coarse)`; merely reducing a desktop viewport is insufficient.
* Manual screenshot review confirms `main.scad` is readable at 320px, Save
  is icon-only on narrow touch screens, and the editor begins immediately
  below the compact toolbar. No unintended horizontal scroll is observed.
* Remaining: physical mobile IME behavior and integration with Brepia's
  persisted project, parameters, rendering and export have NOT been tested.
* Published `main` remains untouched.

## Scope

* CodeMirror 6, line numbers, bracket pairing, base multi-cursor/search/undo/folding
  capabilities, dark theme and compact touch controls.
* A first OpenSCAD-oriented syntax mode using CodeMirror's **legacy C-like mode**.
  This is intentionally **not a full OpenSCAD grammar**.
* Sample built-in keyword/module suggestions and sample project-file completions.
* Sample 2-file switching, with in-memory per-file draft and Save/Discard behavior.
* A grouped snippet library with primitives, transforms, Booleans, color, extrusions, programming and parameters, including wrapping the selected source.
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
