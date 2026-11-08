# Changelog

## Unreleased - Orca 3MF integration and repository maintenance

- Publish **Export → Orca Color → Single Object / Parts** as separate choices in the production Viewer.
- Preserve all model RGB colors independently of physical nozzle count; include Orca paint metadata for up to 16 virtual filament slots.
- Improve multipart 3MF export for spatially isolated printable-design components, retaining per-part filament colors and labeling open meshes requiring slicer validation.
- Verify Megabot and Chain Ring in browser export tests, and record Snapmaker Orca CLI import limitations without claiming unverified GUI slicing.
- Retire superseded one-off preview and CodeMirror integration workflows from `main`; keep live CI, GitHub Pages and desktop/mobile smoke checks.
- Remove preview-only geometric diagnostics from the production smoke harness; retain unit-level Orca export regression coverage.


## Unreleased - Editor history controls

- Add Undo and Redo to the editor's existing More (...) menu using native CodeMirror history.
- Disable unavailable actions, preserve keyboard shortcuts, and cover text and snippet changes in mobile/desktop smoke tests.

## Unreleased - OpenSCAD annotations

- Add a Noteringar category to the existing editor code-template menu: extruded 3D text, arrow, double arrow and editable dimension label/lines.
- The dimension value is a manually edited OpenSCAD parameter, not an automatic model measurement.
- Verify generated text and annotation geometry as STL, including web-browser WebAssembly text export on mobile and desktop.
- Increase the snippet palette from 57 to 60 commands while keeping the compact mobile toolbar.

## Unreleased - Search and AI discoverability

- Add crawlable product information, improved titles and descriptions, canonical URLs and social sharing metadata.
- Add SoftwareApplication JSON-LD, sitemap, robots directives, an optional AI information guide, and social preview artwork.
- Publish an indexed About page explaining OpenSCAD editing, WebAssembly rendering and browser-local storage.
- Add a static SEO validation gate to the GitHub Pages deployment.

## 0.3.0 - 2026-11-07 (CodeMirror 6 OpenSCAD editor and mobile UX)

- Replace the previous source textbox with the integrated CodeMirror 6 OpenSCAD editor.
- Add syntax highlighting, line numbers, search/replace, autocomplete, multi-cursor selection and accessible editor controls.
- Add 57 searchable OpenSCAD insert templates across nine categories, with compact icon labels.
- Preserve per-file source drafts, project dependencies, Save/Discard, parameter customizer, OpenSCAD WebAssembly rendering and STL export.
- Keep the viewer-visible, separately scrollable parameter layout, with Scroll on / Scroll locked labels.
- Update desktop/mobile editor ergonomics; retain GitHub Pages as the production host.
- The OpenSCAD-only simplification and removed legacy subsystems listed below are included in this release.

### OpenSCAD-only simplification (included in 0.3.0)

- Removed the legacy Brepia AI, chat, BREP, Rhino/Grasshopper, Supabase, and build123d subsystems.
- Removed remaining Supabase auth/API stubs, unused Creative model definitions, and Supabase/React Query dependencies; legal information routes no longer depend on a removed backend.
- Removed STEP export completely from both server and static builds.
- Kept the browser-side OpenSCAD editor, local models, model gallery, WebAssembly preview, and supported OpenSCAD export formats.
- Retained the optional Node server and GitHub Pages deployment with the same OpenSCAD feature set.
- Removed unused legacy template images, watermark and social media icons, obsolete Git-hook packages, and stale Tailwind source globs.


## 0.2.0 — 2026-11-06 (public hosting and dual distribution)

- Publish a free, fully static Brepia Viewer at [viewer.notydesign.se](https://viewer.notydesign.se/) using GitHub Pages and a Cloudflare-managed domain.
- Retain the independent Node/Nitro server build with its conditional server-side STEP export; static hosting keeps OpenSCAD WebAssembly, gallery, local IndexedDB storage and browser-based STL export while hiding STEP.
- Provide an accessible GitHub source-repository shortcut in the gallery and model editor, on mobile and desktop.
- Update GitHub Actions to Node 24-compatible versions; patch vulnerable dependencies, including Zod 4, and maintain the high/critical runtime audit gate.
- Strengthen mobile and desktop release checks for 3D rendering, the exported STL, WebAssembly loading and the GitHub link; remove obsolete static-hosting experiment workflow triggers.
- Keep source, code history, models and existing local server configuration intact.

**Note:** Browser-local models are stored per origin/device and are not automatically copied between the GitHub project URL and the custom-domain URL. STEP remains a server-only export.


## 0.1.0 — 2026-10-16 (first independent Viewer release)

- Independent Brepia Viewer application focused on browser-local OpenSCAD models, gallery, editing and preview.
- New model-source configuration, simplified navigation, export paths and build checks.
- Released as an independent product with separate GitHub repository and release lifecycle.

## Original Brepia 2.0.0 history (before separation)

- Historical upstream baseline; not a Brepia Viewer release.
