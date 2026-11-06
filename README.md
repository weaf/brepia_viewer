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

</div>

Browse parametric OpenSCAD designs, preview them in 3D, adjust exposed parameters, and edit project source files—all in your browser. No account is needed to browse the gallery or work with local models.

## What you can do

- Browse built-in `.scad` models from configured public GitHub repositories.
- Preview models in 3D and adjust parameters declared in their OpenSCAD source.
- Edit OpenSCAD project files and supported project dependencies in the browser.
- Upload a `.scad` file or a project folder containing source files and supported assets.
- Save uploaded models and edits in browser storage, then return to them later on the same browser and device.
- Download a model preview as an STL file.

Local models are stored in this browser, not uploaded to a Brepia account. Clearing browser data or using another browser or device will not carry those local copies over.

## Model sources

Built-in models are listed in [`src/lib/modelRepositories.ts`](src/lib/modelRepositories.ts). Add a source by setting its stable `id`, display `label`, GitHub `owner`, `repository`, and `branch`; set `path` to a folder within the repository, or use an empty string for the repository root. Each source must contain public GitHub content that can be read through the GitHub API and raw-content URLs.

## Deployment modes

One repository provides **two builds**; the local server and the free static site
use the same model gallery, editor, browser-side OpenSCAD WebAssembly and IndexedDB.

| Mode | Command | Public URL / output | STEP export |
| --- | --- | --- | --- |
| Node/Nitro server (default) | `./start.sh` | `http://localhost:8005/` | Available when its server-side provider is configured |
| Static GitHub Pages | `STATIC_VIEWER=1 VITE_STATIC_VIEWER=1 STATIC_VIEWER_BASE=/ npm run build` | `.output/public/` deployed at `https://viewer.notydesign.se/` | Intentionally hidden |

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
the server-only STEP API is not shipped as an active feature of the static site.
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
