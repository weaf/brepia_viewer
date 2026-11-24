<div align="center">
  <img src="./public/brepia-logo.svg" alt="Brepia Viewer" width="420" />
</div>

# Brepia Viewer

Brepia Viewer is a web-based OpenSCAD editor and 3D viewer.

[Open Brepia Viewer](https://viewer.notydesign.se/)

Browse OpenSCAD models or open your own `.scad` files and project folders. Edit the code, adjust parameters, and preview the result in 3D. OpenSCAD runs in your browser, and your imported models and edits are saved locally in that browser.

## Features

- Model gallery with designs from public GitHub repositories.
- OpenSCAD editor with syntax highlighting, autocomplete, search and code templates.
- Live parameter controls and 3D model preview.
- Import and save local OpenSCAD projects.
- Export to STL, 3MF, OFF, AMF, WRL and other OpenSCAD formats.

## Orca Color

- **Single Object:** Exports the model with its colors as one 3MF object.
- **Parts:** Exports separate 3MF parts where possible, keeping their color assignments.

Check part geometry and filament assignments in OrcaSlicer or Snapmaker Orca before printing.

## Share model links

Brepia Viewer can open a model directly from a shareable link. Example:

```text
https://viewer.notydesign.se/?model=https%3A%2F%2Fexample.org%2Fmodels%2Fbox.scad
```

When a GitHub folder contains a **standard OpenSCAD Customizer JSON** (with `fileFormatVersion: "1"` and `parameterSets`), Viewer automatically loads its named variants into **Presets** alongside the selected `.scad` model. This applies to imported GitHub folders, GitHub deep links and curated GitHub library models. No separate `Import JSON` step is needed. Viewer prefers `model.json` next to `model.scad`; if there is only one JSON file in that same folder, it uses that instead. When multiple unrelated JSON files are present, Viewer does not guess. Invalid or oversized JSON is reported without preventing the SCAD model from opening. Model defaults are not changed until a preset is selected; local saved variant changes are preserved when a library model refreshes.

The `model` parameter accepts a direct HTTPS `.scad` file hosted with CORS enabled, or a public GitHub repository, folder or `.scad` file link. A GitHub `blob` link identifies the entrypoint and opens it with its project dependencies; a repository containing multiple models may ask the visitor to choose an entrypoint first. External models are imported as **local browser copies**: the link grants no write access to the source repository.

For curated library models, the editor's **Share** button copies a stable library-model link:

```text
https://viewer.notydesign.se/?library=parametric-designs&file=Box%2FBox.scad
```

The library ID and path identify the model in the JSON registry. Share links always open the model as it exists in that library, with local browser changes preserved where applicable. Only models publicly accessible to the visitor can be fetched.

## Model platform links (experimental)

Share a page link from **Printables, Thingiverse, MakerWorld or Snapmaker Space** via `?model=`:

```text
https://viewer.notydesign.se/?model=https%3A%2F%2Fwww.printables.com%2Fmodel%2F3161-3d-benchy
```

The Viewer recognizes each platform and clearly distinguishes public downloads from provider-restricted model files.

- **Printables:** The browser can list and open publicly available STL/3MF files. An optional, fixed-endpoint [Cloudflare metadata bridge](platform-bridge/README.md) avoids browser CORS restrictions on Printables' undocumented GraphQL API. It is **not deployed by this PR**. Until `VITE_PRINTABLES_BRIDGE_ORIGIN` points to an owner-approved Worker, Viewer keeps the original direct-browser behavior (which may fail CORS). Public file delivery still depends on the provider's direct HTTPS link and CORS policy.
- **Thingiverse:** Model pages are recognized, but its official API needs a developer token. Viewer does not store or ask for a token in a public browser session. Open the original model page to download a supported file.
- **MakerWorld:** Model pages are recognized. Provider downloads ordinarily require login and authorized file access. No session scraping or credential bypass is attempted.
- **Snapmaker Space:** Model pages are recognized and link to their original download page. Its public file-download API has not been verified.

**Direct public STL/3MF HTTPS file links** can also be passed to `?model=` when the file host permits CORS. The local Upload model button accepts SCAD, STL and 3MF. A mesh file is wrapped in an OpenSCAD `import("model.stl");` project so it can be displayed and transformed; **it does not recover the original parametric design**. Supported 3MF geometry is converted locally to STL for preview, without preserving materials, colors, print profiles, or separate plates. A complex or sliced-only 3MF may fail with an explicit error. An individual asset must fit the existing 16 MiB limit (3MF conversion is capped at 8 MiB compressed).

All imported files are stored locally in the browser and remain subject to the original creator's license. No credentials, protected-file scraping or binary download proxy is included. The optional Printables Worker only exposes fixed, public metadata endpoints and is not deployed or connected to the production Viewer without a separate owner decision.

## Contribute a model library

All public GitHub model sources shown in the built-in gallery are listed in [`src/lib/modelRepositories.json`](src/lib/modelRepositories.json). To propose another source, fork the project, add a single JSON entry and submit a pull request. **No TypeScript changes are required.**

```json
{
  "id": "your-library",
  "label": "Your models",
  "owner": "github-user",
  "repository": "public-openscad-models",
  "branch": "main",
  "path": "models"
}
```

The registry is a JSON **array**; add the object alongside existing entries. `id` must be unique and stable. `path` is relative to repository root, or `""` to include all folders. Only public GitHub repositories are supported as curated libraries. No URLs, commands, credentials, scripts, external API hosts, or custom ports are accepted in this registry. A maintainer reviews each PR and CI runs validation, tests, lint and a production build. PR approval is a curation and safety decision, not a guarantee that user-supplied SCAD geometry is harmless; do not add private or untrusted model sources.

Use the **Library** filter above the model gallery to display a specific source without hiding other sources permanently.

## Run locally

Requires [Node.js](https://nodejs.org/) 20.19+ or 22.12+ and npm 10+.

```bash
git clone https://github.com/weaf/brepia_viewer.git
cd brepia_viewer
npm ci
./start.sh
```

Open the local address shown in the terminal (usually `http://localhost:8005/`). For development with live reload, run `npm run dev` instead of `./start.sh`.

Brepia Viewer is open source under [GPL-3.0](LICENSE). See [Third-party notices](THIRD_PARTY_NOTICES.md) for credits.
