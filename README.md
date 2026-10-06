<div align="center">
  <img src="./public/brepia-logo.svg" alt="Brepia" width="420" />
</div>

<h1 align="center">Brepia</h1>

<p align="center">
  <strong>Open-source browser workspace for parametric and native BRep 3D design</strong><br />
  <sub>by Noty</sub>
</p>

<div align="center">

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat)](https://www.gnu.org/licenses/gpl-3.0)

</div>

Brepia combines editable OpenSCAD projects, native BRep projects, a live 3D viewer, model history, CAD exchange and optional AI-assisted workflows in one application.

## Capabilities

### Parametric design

- Create, import and revise OpenSCAD models and multi-file projects.
- Edit model parameters and inspect or edit project source files.
- Preserve supported project-local dependencies and relative assets.

### Native BRep

- Create and revise parameterized native BRep projects with project history.
- Export exact primary-result STEP and Rhino/openNURBS `.3dm` interoperability files.
- Round-trip supported Grasshopper workflows with the bundled Brepia Grasshopper integration.

### Creative 3D and AI

- Use text prompts or reference images in supported Creative 3D workflows.
- Connect local or hosted model providers, including OpenAI-compatible endpoints.
- Use OpenCode- or Codex-backed workflows when configured.

### Viewer and export

- Inspect models in the browser-based 3D viewer.
- Export STL, SCAD, DXF, STEP and 3DM files.
- Use GLB output when supported by the selected Creative 3D backend.

## Getting started

### Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm `>=10`
- Podman (the included launcher is configured for Podman by default)

### Install and run

```bash
git clone https://github.com/weaf/brepia.git
cd brepia
./setup.sh
./start.sh
```

Open the URL printed by the launcher. Keep `.env.local` private.

For automated or minimal provisioning, the setup script also supports:

```bash
./setup.sh --non-interactive --minimal
```

## Optional AI services

Brepia starts without local AI services. The guided setup can optionally install supported local tooling such as llama.cpp, llama-swap, OpenCode and Codex. Hosted providers can be configured through `.env.local`.

## Configuration

Use `.env.local.template` as the reference for supported settings, then keep local credentials and provider configuration in `.env.local`.

## Attribution

Brepia retains code, design and architectural lineage from the open-source CADAM project by Adam-CAD. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the upstream provenance notice and third-party information.

## License

Brepia is distributed under the **GNU General Public License v3.0**. See [`LICENSE`](LICENSE).
