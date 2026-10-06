The following JSON is the exact active native BRep source snapshot for this turn.

Treat it as source authority for any follow-up edit. Preserve the project ID and preserve existing parameter/node IDs whenever those semantic objects continue to exist. Also preserve existing `projectObject` role assignments and semantic point IDs unless the user intentionally changes or removes those project-object semantics. Return a complete next project through `build_brep_project`; do not return a patch, Python/build123d code, STEP, mesh data, raw topology indices, or runtime objects.

`resultNodeId` is the primary BRep result. Project-object footprint/clearance/maintenance roles are separate auxiliary semantics that reference existing node IDs, and semantic points are stable local connection/mounting/cable data. Do not silently reinterpret a project-object role as the primary result or vice versa.

If the requested change cannot be represented by the current canonical BRep schema, explain the limitation instead of inventing unsupported fields.

<current_brep_project>
{{projectJson}}
</current_brep_project>
