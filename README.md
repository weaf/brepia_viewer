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
