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

When a GitHub folder contains an **OpenSCAD Customizer JSON** with `fileFormatVersion: "1"` and `parameterSets`, Viewer automatically imports its named variants into **Presets** alongside the selected SCAD model. This works with GitHub folder imports, direct GitHub links and built-in GitHub library models. There is no need to upload the JSON separately. Viewer prefers `model.json` alongside `model.scad`, or uses the single JSON in the same folder when filenames differ. If several unrelated JSON files exist, Viewer does not guess. Invalid or oversized JSON is reported without preventing the SCAD model from loading. A preset is applied only when you select it; local edits are preserved on library refresh.

The `model` parameter accepts a direct HTTPS `.scad` file hosted with CORS enabled, or a public GitHub repository, folder or `.scad` file link. A GitHub `blob` link identifies the entrypoint and opens it with its project dependencies; a repository containing multiple models may ask the visitor to choose an entrypoint first. External models are imported as **local browser copies**: the link grants no write access to the source repository.

For curated library models, the editor's **Share** button copies a stable library-model link:

```text
https://viewer.notydesign.se/?library=parametric-designs&file=Box%2FBox.scad
```

The library ID and path identify the model in the JSON registry. Share links always open the model as it exists in that library, with local browser changes preserved where applicable. Only models publicly accessible to the visitor can be fetched.

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
