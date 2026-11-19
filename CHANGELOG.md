# Changelog

## 0.5.0 - 2026-11-19 (Part Move, mobile fullscreen and OpenSCAD tools)

- Select and move individual model parts directly in 3D using touch or mouse. Switch between Selected Part and Whole Model, choose X/Y/Z and reset positions.
- Expand the 3D viewer on mobile. Move now has its own toolbar icon and compact, horizontal X/Y/Z buttons.
- Create parametric chains with individual segment settings; preview or export SCAD, and import/export chain JSON.
- Save named parameter variants and import/export OpenSCAD Customizer JSON presets.
- Import public OpenSCAD files, folders and GitHub repositories from URL; browse models grouped by folder.
- Measure distances and angles, with snapping on 3D geometry.
- Better OpenSCAD editor navigation, parameter handling and preserved camera zoom.
- Additional preview diagnostics and optional Fast STL preview under Experimental.

Move changes the 3D preview only; it does not rewrite the SCAD source or change model exports.

## 0.4.0 - 2026-11-08 (Orca Color 3MF and Viewer improvements)

- Add **Export → Orca Color → Single Object / Parts** with full RGB model colors and Orca-compatible color and filament metadata.
- Export separate selectable 3MF parts when possible, keeping part-level filament assignments; label meshes that still need checking or repair.
- Keep the original single-object color export and the standard STL/3MF export options.
- Add Undo and Redo in the OpenSCAD editor menu and code templates for text, arrows and manual dimensions.
- Improve mobile editor controls, search metadata, public model browsing and browser-based exports.

**Slicer note:** Part topology, filament mapping and actual slicing should still be checked in Snapmaker Orca or OrcaSlicer; open meshes are not automatically repaired.

## 0.3.0 - 2026-11-07 (CodeMirror 6 OpenSCAD editor and mobile UX)

- Replace the previous source textbox with the integrated CodeMirror 6 OpenSCAD editor.
- Add syntax highlighting, line numbers, search/replace, autocomplete, multi-cursor selection and accessible editor controls.
- Add 57 searchable OpenSCAD insert templates across nine categories, with compact icon labels.
- Preserve per-file source drafts, project dependencies, Save/Discard, parameter customizer, OpenSCAD WebAssembly rendering and STL export.
- Keep the viewer-visible, separately scrollable parameter layout, with Scroll on / Scroll locked labels.

