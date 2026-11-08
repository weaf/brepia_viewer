<div align="center">
  <img src="./public/brepia-logo.svg" alt="Brepia Viewer" width="420" />
</div>

<h1 align="center">Brepia Viewer</h1>

<p align="center">
  <strong>A browser-based OpenSCAD model gallery, editor, and 3D viewer</strong><br />
  <sub>by Noty</sub>
</p>

<div align="center">

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat)](https://www.gnu.org/licenses/gpl-3.0)
[![Brepia Viewer v0.3.0](https://img.shields.io/badge/Version-v0.3.0-brightgreen.svg?style=flat)](https://github.com/weaf/brepia_viewer/releases/tag/v0.3.0)
[![GitHub Pages](https://img.shields.io/badge/Live-Viewer-0a7ec2.svg?style=flat)](https://viewer.notydesign.se/)
[![CI](https://github.com/weaf/brepia_viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/weaf/brepia_viewer/actions/workflows/ci.yml)

</div>

**[Open the public Viewer](https://viewer.notydesign.se/)** · [Browse the source code](https://github.com/weaf/brepia_viewer) · [Releases](https://github.com/weaf/brepia_viewer/releases)

Browse parametric OpenSCAD designs, preview them in 3D, adjust exposed parameters, and edit project source files—all in your browser. No account is needed to browse the gallery or work with local models.

## What you can do

- Browse built-in `.scad` models from configured public GitHub repositories.
- Preview models in 3D and adjust parameters declared in their OpenSCAD source.
- Edit OpenSCAD project files and supported project dependencies in the browser.
- Upload a `.scad` file or a project folder containing source files and supported assets.
- Save uploaded models and edits in browser storage, then return to them later on the same browser and device.
- Download a model preview as an STL file.

Local models are stored in this browser, not uploaded to a Brepia account. Clearing browser data or using another browser or device will not carry those local copies over. Moving between `weaf.github.io` and `viewer.notydesign.se` also changes the storage origin; models saved under one address are not automatically transferred to the other.

## Experimental Snapmaker Orca / OrcaSlicer color export

The development branch exposes **Export → Orca Color .3MF**. This produces a
3MF model containing both standards-based colors and slicer-specific per-face
paint/filament assignments, using the same OFF color data as the OpenSCAD
preview. It exports the source geometry in millimeters and does not bake in
the viewer's camera rotation or centering. Standard STL and 3MF options stay
unchanged.

Brepia stores **all OpenSCAD RGB model colors**, independently of the
physical nozzle or spool count of the selected printer. For palettes with up
to sixteen distinct entries, the file also contains Orca-compatible painted
virtual filament assignments, including models with more than four colors.
This does not give a four-nozzle printer more than four simultaneously
available actual filaments. Assign/remap colors to the physical slots in
OrcaSlicer or adjust the design to fit your printing workflow.

For models with **more than sixteen colors**, the export still succeeds and
keeps every per-triangle RGB color in the standard 3MF color group, but omits
Orca-specific paint and filament settings rather than silently assigning the
wrong physical extruders. OrcaSlicer may display those models as a single
filament because it does not reliably read standard per-triangle color groups
for automatic painting; those models require manual painting/mapping before
printing. Uncolored OpenSCAD surfaces use a neutral placeholder when paint
metadata is emitted; OpenSCAD's renderer-default yellow is not treated as
an additional user-selected color.

**Important:** Colors are only candidate filament identifiers. The
provisional `Generic PLA` slicer metadata does **not** identify the user's
real spools. After opening the 3MF in Snapmaker Orca or OrcaSlicer, verify
physical filament slot order and select the correct material profiles
(PLA, PETG, etc.) before slicing or printing. Transparent OpenSCAD colors
cannot become transparent when printed with opaque filament.

The dedicated import/slicing compatibility check against the actual
Snapmaker Orca version must pass before this export is treated as
production-ready. This feature is not yet released on the public Viewer.

## Search and AI discoverability

The production GitHub Pages build provides descriptive HTML metadata, a canonical URL, a crawlable About page, SoftwareApplication JSON-LD, an Open Graph image, [robots.txt](public/robots.txt), [sitemap.xml](public/sitemap.xml), and an optional [llms.txt](public/llms.txt). The sitemap is intended for search engine discovery. The llms.txt file is informational; it is not a Google ranking mechanism. Content stays accessible without an account, and locally imported models are never published as individual pages.

The Pages workflow validates these files and prerendered content using `node scripts/check-seo.mjs` before deployment. Google Search Console ownership verification and sitemap submission can be completed separately by the site owner to monitor actual indexing.

## Model sources

Built-in models are listed in [`src/lib/modelRepositories.ts`](src/lib/modelRepositories.ts). Add a source by setting its stable `id`, display `label`, GitHub `owner`, `repository`, and `branch`; set `path` to a folder within the repository, or use an empty string for the repository root. Each source must contain public GitHub content that can be read through the GitHub API and raw-content URLs.

## Deployment modes

Brepia Viewer is dedicated to **OpenSCAD only**. One codebase provides two deployment
methods: the free static GitHub Pages app and the optional local Node server.
Both run the same client-side OpenSCAD WebAssembly engine and use browser IndexedDB.

| Mode | Command | Public URL / output | OpenSCAD export |
| --- | --- | --- | --- |
| Node/Nitro server (default) | `./start.sh` | `http://localhost:8005/` | Same browser-side OpenSCAD exports |
| Static GitHub Pages | `STATIC_VIEWER=1 VITE_STATIC_VIEWER=1 STATIC_VIEWER_BASE=/ npm run build` | `.output/public/` deployed at `https://viewer.notydesign.se/` | Same browser-side OpenSCAD exports |

**Static hosting:** The GitHub Actions Pages workflow builds from `main`
and publishes the prerendered files at `https://viewer.notydesign.se/`.
The GitHub Pages **Custom domain** setting must be `viewer.notydesign.se`.
In Cloudflare DNS, create a **DNS-only CNAME** for `viewer` pointing to
`weaf.github.io` (no repository path); enable **Enforce HTTPS** on GitHub
once the certificate is ready. With the custom domain configured, the published
HTML, JavaScript, icons and OpenSCAD WebAssembly are built for `/`.
The original `weaf.github.io/brepia_viewer/` URL may redirect to the custom domain.
In GitHub repository **Settings → Pages**, select **GitHub Actions** as
the publishing source once. The normal CI pipeline and existing server launcher
remain independent of Pages. Models are processed in the visitor's browser;
no server-based CAD conversion API is required.
Models from public GitHub repositories require GitHub to be reachable.

For a Pages-compatible test build, run:

```bash
npm ci
STATIC_VIEWER=1 VITE_STATIC_VIEWER=1 STATIC_VIEWER_BASE=/ npm run build
STATIC_VIEWER_BASE=/ node .github/scripts/static-viewer-smoke.mjs
```

The smoke test serves the output at the **configured root or project subpath**, checks
desktop/mobile OpenSCAD rendering, and downloads an STL. No separate local
backend or container is required for this static mode.

## Run locally

### Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm `>=10`

### Install and start the development server

```bash
git clone https://github.com/weaf/brepia_viewer.git
cd brepia_viewer
npm ci
npm run dev
```

Open the local URL printed by Vite. The gallery uses the browser's IndexedDB for local models and fetches built-in catalogs and model files from their configured GitHub sources.

### Stable local launcher

Run the repository-owned launcher for the stable preview:

```bash
./start.sh
```

To use Vite hot-module reloading through the same launcher:

```bash
BREPIA_ENABLE_HMR=1 ./start.sh
```

The HMR server defaults to port 8005 and selects the next free port if that port is occupied. To choose a specific port, run `BREPIA_VIEWER_PORT=5483 BREPIA_ENABLE_HMR=1 ./start.sh`. The stable launcher can use `BREPIA_STABLE_PORT` to select its public port.

### Validate, build and preview

```bash
npm run check
npm run preview
```

## Project notes

- The OpenSCAD runtime runs in the browser using the bundled WebAssembly build.
- GitHub API rate limits or unavailable repositories can temporarily prevent refreshing the built-in catalog; cached catalog data may remain available in the browser.
- This repository is distributed under the **GNU General Public License v3.0**. See [`LICENSE`](LICENSE).
- Brepia retains code, design, and architectural lineage from the open-source CADAM project by Adam-CAD. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for attribution and third-party information.
