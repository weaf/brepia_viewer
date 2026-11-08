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
- Export STL, standard 3MF, and Orca Color 3MF models (Single Object or Parts), alongside other supported OpenSCAD formats.

Local models are stored in this browser, not uploaded to a Brepia account. Clearing browser data or using another browser or device will not carry those local copies over. Moving between `weaf.github.io` and `viewer.notydesign.se` also changes the storage origin; models saved under one address are not automatically transferred to the other.

## Orca Color 3MF export

In the **Export** menu, expand **Orca Color** and choose:

- **Single Object** — export the original colored OpenSCAD geometry as one 3MF object, without attempting to separate components. This is useful for a combined mesh or when you do not want automatic part detection.
- **Parts** — attempt to separate disconnected mesh shells into individually selectable 3MF parts. Uniformly colored parts get part-level filament assignments to improve color preservation after Orca's **Split to Objects**. Multicolor surfaces retain triangle painting where supported.

The **Parts** exporter uses the same color data and underlying color exporter as **Single Object**. It falls back to a single colored object when no safe split can be inferred, the model is too complex, or the part count exceeds its limit. It never splits a solid solely on triangle colors.

Some isolated meshes can have **[OPEN MESH]** in their part names. These parts remain selectable and may retain a filament assignment, but they are **not certified watertight or printable**. Inspect/repair them in Snapmaker Orca or OrcaSlicer before slicing. Cutting or splitting a multicolor shell may still remove face painting in some slicer versions.

Both modes preserve all RGB model colors in the standards-based 3MF color group, regardless of a printer's physical nozzle count. When the palette has at most **16 virtual filament slots**, compatible Orca paint and provisional material settings are included. With more than 16 colors, the RGB data is still exported, but automatic Orca filament painting is not guaranteed. A four-nozzle printer such as Snapmaker U1 still requires mapping the desired colors to available physical filaments before printing.

The ordinary **.3MF** and **.STL** exports remain separate. The Orca modes preserve authored millimeter coordinates and do not bake in the 3D viewer's camera rotation or centering. The supplied `Generic PLA` assignments are placeholders, not verification of loaded spools or material profiles. Always check the actual filament mapping, mesh warnings, generated slice and toolpaths in your slicer. CLI import/slicing behavior may differ from GUI import.

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
