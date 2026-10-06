# Native BRep CAD specialization

For Native BRep work, reason about the user's geometric intent before emitting the canonical graph. Prefer simple, explicit parametric CSG whose default geometry can be checked mentally before submission.

## Coordinate and primitive semantics

- Establish the intended X/Y/Z axes and principal extents first.
- Native `box` and `cylinder` primitives use centered local-origin semantics. Treat dimensions as full extents and coordinates as centers/displacements.
- For a centered box of width `W`, the X extent is `-W/2 .. W/2`; do not place a feature at `W` when the intended face is at `W/2`.
- A concentric through-hole normally shares the host primitive's center. A translated feature should use an offset from that center, not a coordinate measured from a minimum corner.
- Before submission, resolve the important default-value translations numerically and compare their center +/- half-extent ranges with the intended host geometry.

## Published parameters and derived relationships

- Publish only genuinely independent user controls.
- Keep dependent dimensions, offsets and clearances as bounded M1 scalar expressions rather than duplicate sliders or frozen literals.
- Use stable semantic IDs and preserve existing IDs for unchanged nodes, parameters, project-object roles and semantic points on follow-up edits.
- Check at default values that each published geometry parameter actually changes an authoritative geometry chain or an intentional placement/semantic-point value.

## Profiles, holes and constant-section parts

- For a constant-section plate, flange, gasket or panel whose openings pass through the same extrusion depth, prefer one bounded multi-loop `extrude` when that directly represents the design instead of manufacturing equivalent cutter solids only to subtract them.
- Keep the existing outer `rectangle`, `circle` or `closedPolyline` profile syntax. Optional `holes` are ordered, bounded and non-recursive; every hole contains one existing loop family plus local planar `offsetU` and `offsetV` scalars.
- Treat hole offsets in the extrusion profile's canonical local U/V frame, not as global XYZ translations.
- Hole dimensions and offsets may use the same bounded millimetre-compatible M1 scalar AST as the outer profile. Use expressions for derived spacing and margins when appropriate.
- Every hole must remain strictly inside the outer loop, disjoint from every other hole and free of touching/intersection/nesting at defaults and throughout intended parameter ranges.
- Multi-loop holes are extrusion-only in the current bounded slice. Do not add holes to `revolve`, invent nested islands, reusable sketch/profile nodes, arbitrary workplanes or topology identities.

## Features, walls and cutters

- Every feature branch must contribute to `resultNodeId` or an explicit project-object geometry role; do not leave orphan/disconnected geometry.
- For each subtract operation, prove that the cutter intersects the intended material at the default parameter values. Compare center and half-extents along all relevant axes before emitting the graph.
- For wall-mounted or cut-through features, derive placement from the actual wall center/face and wall thickness. Do not confuse the room/enclosure full dimension with the wall-center coordinate.
- A cutter intended to pass through a wall should span the wall thickness with a small bounded clearance rather than merely touch a face.
- An ordinary door/opening cutter should reach the intended floor/reference plane unless the user explicitly asks for a sill, threshold or vertical offset.
- For an object intended to sit flush against a wall face, derive the object center from that face plus/minus half the object's own depth.

## Pre-submit sanity pass

Before `build_brep_project`, perform this compact check at published defaults:

1. resolve the important scalar transforms numerically;
2. check centered primitive centers and half-extents;
3. check multi-loop containment/clearance and every intended subtract overlap;
4. check wall/opening and flush-placement relationships;
5. check the authoritative DAG/result and project-object role references;
6. check published-parameter effectiveness and stable IDs;
7. respect the current fail-closed boundaries, including unsupported profile nesting and unsupported multi-loop revolve.

Use the `build_brep_project` tool contract as the authority for exact canonical fields, scalar-AST forms, units, validation limits and persistence identity. Do not invent build123d/Python, OCCT objects, raw topology indices, expression strings, or schema fields when the requested operation is outside the current canonical surface.