# Native BRep runner dependency inventory

- `build123d==0.11.1`: Apache-2.0 (upstream project license).
- `cadquery-ocp-novtk==7.9.3.1.1`: OCCT bindings without the VTK runtime.
- OpenCascade Technology, brought in through build123d/OCP: LGPL-2.1 with the OCCT exception.
- `rhino3dm==8.32.1`: MIT (upstream rhino3dm license). rhino3dm is based on McNeel openNURBS; retain the upstream rhino3dm/openNURBS notices when distributing a built image.

The image pins these dependencies with the `BUILD123D_VERSION`,
`CADQUERY_OCP_NOVTK_VERSION` and `RHINO3DM_VERSION` build arguments. The
runner has no network at execution time. Before distributing a built image,
retain the upstream license notices required by these dependencies.
