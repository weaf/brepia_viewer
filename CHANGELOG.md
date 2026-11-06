# Changelog

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
