"""Constrained build123d evaluator. Input is normalized Brepia JSON, never user Python."""
import json
import math
import sys
from pathlib import Path

import rhino3dm
from build123d import Axis, Box, Circle, Compound, Cylinder, Face, JernArc, Line, Location, Plane, Polygon, Rectangle, Wire, export_step, extrude, revolve, sweep

PROVIDER = {"id": "build123d-occt", "providerVersion": "0.3.0", "kernelVersion": "build123d-0.11.1/OCCT-7.9.3.1"}
THREEDM_VERSION = 8
THREEDM_EXACT_STEP_NAME = "brepia-primary.step"
THREEDM_EXACT_STEP_NAMES = {
    "result": THREEDM_EXACT_STEP_NAME,
    "footprint": "brepia-footprint.step",
    "clearanceEnvelope": "brepia-clearance-envelope.step",
    "maintenanceEnvelope": "brepia-maintenance-envelope.step",
}
PROJECT_OBJECT_ROLE_FIELDS = (
    ("footprint", "footprintNodeId"),
    ("clearanceEnvelope", "clearanceEnvelopeNodeId"),
    ("maintenanceEnvelope", "maintenanceEnvelopeNodeId"),
)
SCALAR_MAX_ABS_VALUE = 1_000_000_000
SCALAR_MAX_DEPTH = 12


def checked_scalar(value, label):
    value = float(value)
    if not math.isfinite(value) or abs(value) > SCALAR_MAX_ABS_VALUE:
        raise ValueError(
            f"invalid_parameter_value: {label} must be finite with absolute value <= {SCALAR_MAX_ABS_VALUE}"
        )
    return 0.0 if value == 0.0 else value


def scalar(value, parameters, depth=0):
    if depth > SCALAR_MAX_DEPTH:
        raise ValueError(f"invalid_parameter_value: scalar expression exceeds maximum depth {SCALAR_MAX_DEPTH}")
    if not isinstance(value, dict):
        return checked_scalar(value, "scalar literal")
    if "parameter" in value:
        parameter = value["parameter"]
        if parameter not in parameters:
            raise ValueError(f"invalid_parameter_value: missing scalar parameter {parameter}")
        return checked_scalar(parameters[parameter], f"scalar parameter {parameter}")

    op = value.get("op")
    args = value.get("args")
    if op == "neg" and isinstance(args, list) and len(args) == 1:
        return checked_scalar(-scalar(args[0], parameters, depth + 1), "scalar neg result")
    if op not in {"add", "sub", "mul", "div"} or not isinstance(args, list) or len(args) != 2:
        raise ValueError("invalid_parameter_value: malformed canonical scalar expression")

    left = scalar(args[0], parameters, depth + 1)
    right = scalar(args[1], parameters, depth + 1)
    if op == "add":
        result = left + right
    elif op == "sub":
        result = left - right
    elif op == "mul":
        result = left * right
    else:
        if right == 0.0:
            raise ValueError("invalid_parameter_value: scalar expression divides by zero")
        result = left / right
    return checked_scalar(result, f"scalar {op} result")


def positive_scalar(value, parameters, label):
    result = scalar(value, parameters)
    if result <= 0.0:
        raise ValueError(f"invalid_parameter_value: {label} must resolve to a positive millimetre value")
    return result


def vector(value, parameters):
    return tuple(scalar(item, parameters) for item in value)


def cross(left, right):
    return (
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    )


def resolved_placement(placement, parameters):
    origin = vector(placement["origin"], parameters)
    x_axis = vector(placement["xAxis"], parameters)
    y_axis = vector(placement["yAxis"], parameters)
    return {"origin": origin, "xAxis": x_axis, "yAxis": y_axis, "zAxis": cross(x_axis, y_axis)}


def resolved_point(point, parameters):
    result = {
        "id": point["id"],
        "kind": point["kind"],
        "position": vector(point["position"], parameters),
    }
    if "direction" in point:
        result["direction"] = vector(point["direction"], parameters)
    if "label" in point:
        result["label"] = point["label"]
    return result


def bounds(shape):
    box = shape.bounding_box()
    return {"min": [box.min.X, box.min.Y, box.min.Z], "max": [box.max.X, box.max.Y, box.max.Z]}


def aggregate_bounds(bodies):
    return {
        "min": [min(body["bounds"]["min"][axis] for body in bodies) for axis in range(3)],
        "max": [max(body["bounds"]["max"][axis] for body in bodies) for axis in range(3)],
    }


def mesh(shape, body_id):
    vertices, triangles = shape.tessellate(0.25)
    positions = [coordinate for vertex in vertices for coordinate in (vertex.X, vertex.Y, vertex.Z)]
    indices = [index for triangle in triangles for index in triangle]
    # build123d tessellation does not guarantee normals. Browser consumers can
    # compute them; this bounded neutral payload explicitly represents that.
    return {"bodyId": body_id, "positions": positions, "normals": [0.0] * len(positions), "indices": indices}


def axis_edges(shape, axis):
    wanted = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[axis]
    selected = []
    for edge in shape.edges():
        tangent = edge.tangent_at(0.5)
        length = (tangent.X ** 2 + tangent.Y ** 2 + tangent.Z ** 2) ** 0.5
        if length and abs(abs(tangent.X / length) - wanted[0]) < 1e-6 and abs(abs(tangent.Y / length) - wanted[1]) < 1e-6 and abs(abs(tangent.Z / length) - wanted[2]) < 1e-6:
            selected.append(edge)
    if not selected:
        raise ValueError(f"ambiguous_selection: no edges parallel to {axis}")
    return selected


def result_solids(value):
    if value is None:
        return []
    if hasattr(value, "solids"):
        return list(value.solids())
    solids = []
    for item in value:
        if hasattr(item, "solids"):
            solids.extend(item.solids())
    return solids


def require_single_boolean_solid(value, kind, node_id):
    solids = result_solids(value)
    if len(solids) != 1:
        raise ValueError(
            f"unsupported_result_cardinality: BRep {kind} {node_id} produced {len(solids)} solids; exactly one is required"
        )
    return solids[0]


def require_single_positive_volume_solid(value, kind, node_id):
    solids = result_solids(value)
    if len(solids) != 1:
        raise ValueError(
            f"unsupported_result_cardinality: BRep {kind} {node_id} produced {len(solids)} solids; exactly one is required"
        )
    solid = solids[0]
    volume = float(solid.volume)
    if not math.isfinite(volume) or volume <= 0.0:
        raise ValueError(
            f"invalid_geometry: BRep {kind} {node_id} must produce one positive-volume solid"
        )
    return solid


def profile_sketch(profile, parameters, label):
    profile_kind = profile["type"]
    if profile_kind == "rectangle":
        return Rectangle(
            positive_scalar(profile["width"], parameters, f"{label} width"),
            positive_scalar(profile["height"], parameters, f"{label} height"),
        )
    if profile_kind == "circle":
        return Circle(
            positive_scalar(profile["radius"], parameters, f"{label} radius")
        )
    if profile_kind == "closedPolyline":
        points = [
            (scalar(point["u"], parameters), scalar(point["v"], parameters))
            for point in profile["points"]
        ]
        return Polygon(*points)
    raise ValueError(f"unsupported_operation: {label} profile {profile_kind}")


def extrude_profile_shape(node, parameters):
    profile = node["profile"]
    node_id = node["id"]
    outer_sketch = profile_sketch(profile, parameters, f"BRep extrude {node_id} profile")
    holes = profile.get("holes") or []

    if holes:
        outer_wire = outer_sketch.wire()
        hole_wires = []
        for index, hole in enumerate(holes):
            offset_u = scalar(hole["offsetU"], parameters)
            offset_v = scalar(hole["offsetV"], parameters)
            hole_wire = profile_sketch(
                hole["loop"],
                parameters,
                f"BRep extrude {node_id} hole {index} profile",
            ).wire()
            hole_wires.append(
                hole_wire.moved(Location((offset_u, offset_v, 0.0)))
            )
        region = Face(outer_wire, hole_wires)
    else:
        # Preserve the established M4 single-loop path byte-for-byte in geometry
        # semantics; only multi-loop profiles require an explicit planar Face.
        region = outer_sketch

    plane = {
        "x": Plane.YZ,
        "y": Plane.ZX,
        "z": Plane.XY,
    }[node["axis"]]
    depth = positive_scalar(node["depth"], parameters, f"BRep extrude {node_id} depth")
    part = extrude(plane * region, amount=depth / 2.0, both=True)
    if holes:
        return require_single_positive_volume_solid(part, "extrude", node_id)
    return require_single_boolean_solid(part, "extrude", node_id)


def revolve_profile_shape(node, parameters):
    profile = node["profile"]
    node_id = node["id"]
    if profile.get("holes"):
        raise ValueError(
            f"unsupported_operation: BRep revolve {node_id} does not support profile holes"
        )
    if profile["type"] != "closedPolyline":
        raise ValueError(
            f"unsupported_operation: BRep revolve {node_id} currently requires a closedPolyline profile"
        )

    points = [
        (scalar(point["u"], parameters), scalar(point["v"], parameters))
        for point in profile["points"]
    ]
    if any(v < 0.0 for _, v in points):
        raise ValueError(
            f"invalid_parameter_value: BRep revolve {node_id} profile must keep radial v >= 0 and must not cross the rotation axis"
        )
    if any(v == 0.0 for _, v in points):
        has_axis_segment = any(
            points[index][1] == 0.0 and points[(index + 1) % len(points)][1] == 0.0
            for index in range(len(points))
        )
        if not has_axis_segment:
            raise ValueError(
                f"invalid_parameter_value: BRep revolve {node_id} profile may touch the rotation axis only through a non-zero-length boundary segment on v = 0"
            )

    sketch = Polygon(*points)
    frames = {
        # Plane(o, x_dir=U, z_dir=N) derives y_dir=V, preserving the locked
        # right-handed canonical profile frame U axial / V radial.
        "x": ((1.0, 0.0, 0.0), (0.0, 0.0, 1.0)),
        "y": ((0.0, 1.0, 0.0), (1.0, 0.0, 0.0)),
        "z": ((0.0, 0.0, 1.0), (0.0, 1.0, 0.0)),
    }
    directions = {
        "x": (1.0, 0.0, 0.0),
        "y": (0.0, 1.0, 0.0),
        "z": (0.0, 0.0, 1.0),
    }
    x_dir, z_dir = frames[node["axis"]]
    profile_plane = Plane(origin=(0.0, 0.0, 0.0), x_dir=x_dir, z_dir=z_dir)
    rotation_axis = Axis((0.0, 0.0, 0.0), directions[node["axis"]])
    part = revolve(
        profile_plane * sketch,
        axis=rotation_axis,
        revolution_arc=360.0,
    )
    return require_single_positive_volume_solid(part, "revolve", node_id)


def sweep_shape(node, parameters):
    node_id = node["id"]
    path = node["path"]
    if node["profile"]["type"] != "circle":
        raise ValueError(
            f"unsupported_operation: BRep sweep {node_id} requires a circle profile"
        )
    if path["type"] != "planarElbow90":
        raise ValueError(
            f"unsupported_operation: BRep sweep {node_id} requires planarElbow90 path"
        )

    profile_radius = positive_scalar(
        node["profile"]["radius"], parameters, f"BRep sweep {node_id} profile radius"
    )
    first_leg = positive_scalar(
        path["firstLegLength"], parameters, f"BRep sweep {node_id} firstLegLength"
    )
    second_leg = positive_scalar(
        path["secondLegLength"], parameters, f"BRep sweep {node_id} secondLegLength"
    )
    bend_radius = positive_scalar(
        path["bendRadius"], parameters, f"BRep sweep {node_id} bendRadius"
    )
    if profile_radius >= bend_radius:
        raise ValueError(
            f"invalid_parameter_value: BRep sweep {node_id} profile radius must resolve smaller than bendRadius"
        )

    first = Line((0.0, 0.0), (first_leg, 0.0))
    bend = JernArc(
        (first_leg, 0.0),
        (1.0, 0.0),
        bend_radius,
        90.0,
    )
    second_start = (first_leg + bend_radius, bend_radius)
    second = Line(
        second_start,
        (second_start[0], second_start[1] + second_leg),
    )
    local_path = Wire([first.edges()[0], bend.edges()[0], second.edges()[0]])

    plane_normal_axis = path["planeNormalAxis"]
    path_plane = {
        "x": Plane.YZ,
        "y": Plane.ZX,
        "z": Plane.XY,
    }[plane_normal_axis]
    section_plane = {
        "x": Plane.ZX,
        "y": Plane.XY,
        "z": Plane.YZ,
    }[plane_normal_axis]
    rail = path_plane * local_path
    section = section_plane * Circle(profile_radius)
    part = sweep(section, path=rail)
    return require_single_positive_volume_solid(part, "sweep", node_id)


def compact_json(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def set_user_strings(attributes, values):
    for key, value in values.items():
        if value is None:
            continue
        attributes.SetUserString(key, value if isinstance(value, str) else compact_json(value))


def rhino_mesh(viewer_mesh):
    target = rhino3dm.Mesh()
    positions = viewer_mesh["positions"]
    indices = viewer_mesh["indices"]
    for index in range(0, len(positions), 3):
        target.Vertices.Add(positions[index], positions[index + 1], positions[index + 2])
    for index in range(0, len(indices), 3):
        target.Faces.AddFace(indices[index], indices[index + 1], indices[index + 2])
    return target


def exact_role_node_ids(project):
    definition = project.get("projectObject") or {}
    roles = {"result": project["resultNodeId"]}
    for role, field in PROJECT_OBJECT_ROLE_FIELDS:
        node_id = definition.get(field)
        if node_id:
            roles[role] = node_id
    return roles


def exact_artifact_entries(project):
    role_node_ids = exact_role_node_ids(project)
    return [
        {
            "role": role,
            "nodeId": role_node_ids[role],
            "format": "step",
            "representation": "exact-brep",
            "contentType": "model/step",
            "fileName": THREEDM_EXACT_STEP_NAMES[role],
        }
        for role in THREEDM_EXACT_STEP_NAMES
        if role in role_node_ids
    ]


def validate_exact_step_file(path, role):
    if not path.is_file():
        raise ValueError(f"3dm_export_failed: missing exact STEP for {role}")
    with path.open("rb") as stream:
        if b"ISO-10303-21" not in stream.read(128):
            raise ValueError(f"3dm_export_failed: invalid exact STEP for {role}")


def add_3dm_body(model, project, body, roles):
    attributes = rhino3dm.ObjectAttributes()
    attributes.Name = body["id"]
    instance = body.get("instance")
    set_user_strings(
        attributes,
        {
            "brepia.projectId": project["id"],
            "brepia.bodyId": body["id"],
            "brepia.nodeId": body["nodeId"],
            "brepia.instanceIndex": instance.get("index") if instance else None,
            "brepia.sourceNodeId": instance.get("sourceNodeId") if instance else None,
            "brepia.roles": roles,
            "brepia.representation": "tessellated-mesh",
        },
    )
    model.Objects.AddMesh(rhino_mesh(body["viewerMesh"]), attributes)


def write_3dm(project, result, exact_step_paths, three_dm_path):
    model = rhino3dm.File3dm()
    model.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Millimeters

    placement = result["projectObject"]["placement"]
    metadata = result["projectObject"].get("metadata")
    role_node_ids = exact_role_node_ids(project)
    optional_role_node_ids = {
        role: node_id for role, node_id in role_node_ids.items() if role != "result"
    }
    semantic_contract = {
        "roles": optional_role_node_ids,
        "points": result["projectObject"]["points"],
    }
    exact_artifacts = exact_artifact_entries(project)
    document_strings = {
        "brepia.schemaVersion": str(project["schemaVersion"]),
        "brepia.projectId": project["id"],
        "brepia.resultNodeId": project["resultNodeId"],
        "brepia.resultKind": result["resultKind"],
        "brepia.provider": compact_json(PROVIDER),
        "brepia.units": project["units"],
        "brepia.geometryRepresentation": "tessellated-mesh",
        "brepia.exactPrimaryArtifact": f"embedded:{THREEDM_EXACT_STEP_NAME}",
        "brepia.exactBrepArtifacts": compact_json(exact_artifacts),
        "brepia.placement": compact_json(placement),
        "brepia.projectObject": compact_json(semantic_contract),
        "brepia.warnings": compact_json(result["warnings"]),
    }
    if metadata is not None:
        document_strings["brepia.metadata"] = compact_json(metadata)
    for key, value in document_strings.items():
        model.Strings[key] = value

    auxiliary_by_node = {}
    for role, node_id in optional_role_node_ids.items():
        body = result["projectObject"]["geometry"].get(role)
        if body:
            entry = auxiliary_by_node.setdefault(node_id, {"body": body, "roles": []})
            entry["roles"].append(role)

    if result["resultKind"] == "single":
        primary = result["bodies"][0]
        combined_roles = ["result"]
        auxiliary = auxiliary_by_node.pop(primary["nodeId"], None)
        if auxiliary:
            combined_roles.extend(auxiliary["roles"])
        add_3dm_body(model, project, primary, combined_roles)
    else:
        for body in result["bodies"]:
            add_3dm_body(model, project, body, ["result"])

    for auxiliary in auxiliary_by_node.values():
        add_3dm_body(model, project, auxiliary["body"], auxiliary["roles"])

    for point in result["projectObject"]["points"]:
        attributes = rhino3dm.ObjectAttributes()
        attributes.Name = point["id"]
        set_user_strings(
            attributes,
            {
                "brepia.projectId": project["id"],
                "brepia.pointId": point["id"],
                "brepia.kind": point["kind"],
                "brepia.label": point.get("label"),
                "brepia.direction": point.get("direction"),
            },
        )
        x, y, z = point["position"]
        model.Objects.AddPoint(x, y, z, attributes)

    for artifact in exact_artifacts:
        role = artifact["role"]
        step_path = exact_step_paths.get(role)
        if step_path is None:
            raise ValueError(f"3dm_export_failed: exact STEP path missing for {role}")
        validate_exact_step_file(step_path, role)
        embedded = rhino3dm.EmbeddedFile.Read(str(step_path))
        if embedded is None:
            raise ValueError(f"3dm_export_failed: could not embed exact STEP for {role}")
        embedded.Filename = artifact["fileName"]
        model.EmbeddedFiles.Add(embedded)

    if not model.Write(str(three_dm_path), THREEDM_VERSION):
        raise ValueError("3dm_export_failed: rhino3dm could not write model.3dm")

    check = rhino3dm.File3dm.Read(str(three_dm_path))
    if check is None:
        raise ValueError("3dm_export_failed: rhino3dm could not re-open model.3dm")
    if check.Settings.ModelUnitSystem != rhino3dm.UnitSystem.Millimeters:
        raise ValueError("3dm_export_failed: model units are not millimetres")
    if check.Strings["brepia.projectId"] != project["id"]:
        raise ValueError("3dm_export_failed: project identity did not round trip")
    if check.Strings["brepia.resultKind"] != result["resultKind"]:
        raise ValueError("3dm_export_failed: result kind did not round trip")
    if check.Strings["brepia.placement"] != compact_json(placement):
        raise ValueError("3dm_export_failed: placement did not round trip")
    if check.Strings["brepia.exactBrepArtifacts"] != compact_json(exact_artifacts):
        raise ValueError("3dm_export_failed: exact artifact manifest did not round trip")
    if check.Strings["brepia.warnings"] != compact_json(result["warnings"]):
        raise ValueError("3dm_export_failed: warnings did not round trip")

    expected_names = {artifact["fileName"] for artifact in exact_artifacts}
    embedded_by_name = {item.Filename: item for item in check.EmbeddedFiles}
    if set(embedded_by_name) != expected_names:
        raise ValueError("3dm_export_failed: exact STEP embedding did not round trip")

    for artifact in exact_artifacts:
        role = artifact["role"]
        embedded_check = embedded_by_name[artifact["fileName"]]
        extracted_step = three_dm_path.parent / f"verify-{artifact['fileName']}"
        if not embedded_check.Write(str(extracted_step)):
            raise ValueError(f"3dm_export_failed: embedded STEP for {role} could not be extracted")
        try:
            validate_exact_step_file(extracted_step, role)
        finally:
            extracted_step.unlink(missing_ok=True)


def evaluate(request):
    project = request["project"]
    parameters = request["parameterValues"]
    shapes = {}
    instance_sets = {}
    body_payloads = {}
    nodes = {node["id"]: node for node in project["nodes"]}

    def evaluate_node(node_id):
        if node_id in shapes:
            return shapes[node_id]
        node = nodes[node_id]
        kind = node["type"]
        if kind in {"linearPattern", "rectangularPattern", "circularPattern"}:
            raise ValueError(
                f"unsupported_result_cardinality: BRep node {node_id} is an instance set where a single shape is required"
            )
        if kind == "box": shape = Box(scalar(node["width"], parameters), scalar(node["depth"], parameters), scalar(node["height"], parameters))
        elif kind == "cylinder": shape = Cylinder(scalar(node["radius"], parameters), scalar(node["height"], parameters))
        elif kind == "extrude": shape = extrude_profile_shape(node, parameters)
        elif kind == "revolve": shape = revolve_profile_shape(node, parameters)
        elif kind == "sweep": shape = sweep_shape(node, parameters)
        elif kind == "transform":
            shape = evaluate_node(node["input"])
            translation = vector(node.get("translate", [0, 0, 0]), parameters)
            rotation = vector(node.get("rotateDeg", [0, 0, 0]), parameters)
            shape = shape.moved(Location(translation, rotation))
        elif kind == "mirror":
            input_shape = evaluate_node(node["input"])
            mirror_plane = {
                "x": Plane.YZ,
                "y": Plane.ZX,
                "z": Plane.XY,
            }[node["normalAxis"]].offset(scalar(node["offset"], parameters))
            shape = input_shape.mirror(mirror_plane)
        elif kind == "subtract":
            shape = evaluate_node(node["base"])
            for tool_id in node["tools"]:
                for tool_shape in evaluate_node_instances(tool_id):
                    shape = shape - tool_shape
        elif kind == "union":
            inputs = [evaluate_node(input_id) for input_id in node["inputs"]]
            shape = require_single_boolean_solid(inputs[0].fuse(*inputs[1:]), kind, node_id)
        elif kind == "intersect":
            inputs = [evaluate_node(input_id) for input_id in node["inputs"]]
            shape = require_single_boolean_solid(inputs[0].intersect(*inputs[1:]), kind, node_id)
        elif kind == "fillet":
            input_shape = evaluate_node(node["input"])
            shape = input_shape.fillet(scalar(node["radius"], parameters), axis_edges(input_shape, node["selector"]["axis"]))
        elif kind == "select":
            selector = parameters.get(node["selector"]["parameter"])
            if selector not in (0, 1, 0.0, 1.0):
                raise ValueError(
                    f"invalid_parameter_value: BRep select {node_id} selector must resolve strictly to 0 or 1"
                )
            shape = evaluate_node(node["on"] if selector == 1 else node["off"])
        else: raise ValueError(f"unsupported_operation: {kind}")
        shapes[node_id] = shape
        return shape

    def evaluate_node_instances(node_id):
        node = nodes[node_id]
        kind = node["type"]
        if kind not in {"linearPattern", "rectangularPattern", "circularPattern"}:
            return [evaluate_node(node_id)]
        if node_id in instance_sets:
            return instance_sets[node_id]

        input_shape = evaluate_node(node["input"])
        directions = {
            "x": (1.0, 0.0, 0.0),
            "y": (0.0, 1.0, 0.0),
            "z": (0.0, 0.0, 1.0),
        }
        instances = []

        if kind == "linearPattern":
            spacing = scalar(node["spacing"], parameters)
            if spacing == 0.0:
                raise ValueError(
                    f"invalid_parameter_value: BRep linearPattern {node_id} spacing must resolve to a non-zero millimetre value"
                )
            direction = directions[node["axis"]]
            for index in range(node["count"]):
                distance = index * spacing
                translation = tuple(component * distance for component in direction)
                instances.append(input_shape.moved(Location(translation)))
        elif kind == "rectangularPattern":
            spacing_a = scalar(node["spacingA"], parameters)
            spacing_b = scalar(node["spacingB"], parameters)
            if spacing_a == 0.0:
                raise ValueError(
                    f"invalid_parameter_value: BRep rectangularPattern {node_id} spacingA must resolve to a non-zero millimetre value"
                )
            if spacing_b == 0.0:
                raise ValueError(
                    f"invalid_parameter_value: BRep rectangularPattern {node_id} spacingB must resolve to a non-zero millimetre value"
                )
            direction_a = directions[node["axisA"]]
            direction_b = directions[node["axisB"]]
            for a in range(node["countA"]):
                for b in range(node["countB"]):
                    translation = tuple(
                        direction_a[axis] * a * spacing_a + direction_b[axis] * b * spacing_b
                        for axis in range(3)
                    )
                    instances.append(input_shape.moved(Location(translation)))
        else:
            angle_step_deg = scalar(node["angleStepDeg"], parameters)
            if angle_step_deg == 0.0:
                raise ValueError(
                    f"invalid_parameter_value: BRep circularPattern {node_id} angleStepDeg must resolve to a non-zero degree value"
                )
            if abs(angle_step_deg) * node["count"] > 360.0:
                raise ValueError(
                    f"invalid_parameter_value: BRep circularPattern {node_id} abs(angleStepDeg) * count must not exceed 360 degrees"
                )
            center = vector(node["center"], parameters)
            rotation_axis = Axis(center, directions[node["axis"]])
            for index in range(node["count"]):
                instances.append(input_shape.rotate(rotation_axis, index * angle_step_deg))

        instance_sets[node_id] = instances
        return instances

    def evaluated_body(node_id):
        if node_id in body_payloads:
            return body_payloads[node_id]
        shape = evaluate_node(node_id)
        payload = {
            "id": node_id,
            "nodeId": node_id,
            "bounds": bounds(shape),
            "viewerMesh": mesh(shape, node_id),
        }
        body_payloads[node_id] = payload
        return payload

    def evaluated_instance_bodies(node_id):
        node = nodes[node_id]
        instances = evaluate_node_instances(node_id)
        return [
            {
                "id": f"{node_id}::{index}",
                "nodeId": node_id,
                "instance": {"index": index, "sourceNodeId": node["input"]},
                "bounds": bounds(shape),
                "viewerMesh": mesh(shape, f"{node_id}::{index}"),
            }
            for index, shape in enumerate(instances)
        ]

    result_id = project["resultNodeId"]
    result_node = nodes[result_id]
    if result_node["type"] in {"linearPattern", "rectangularPattern", "circularPattern"}:
        result_instances = evaluate_node_instances(result_id)
        primary_bodies = evaluated_instance_bodies(result_id)
        result_shape = Compound(children=result_instances)
        result_kind = "instanceSet"
    else:
        result_shape = evaluate_node(result_id)
        primary_bodies = [evaluated_body(result_id)]
        result_kind = "single"

    role_shapes = {"result": result_shape}

    definition = project.get("projectObject") or {}
    geometry = {}
    for role, field in PROJECT_OBJECT_ROLE_FIELDS:
        node_id = definition.get(field)
        if node_id:
            role_shapes[role] = evaluate_node(node_id)
            geometry[role] = evaluated_body(node_id)

    project_object = {
        "placement": resolved_placement(project["placement"], parameters),
        "geometry": geometry,
        "points": [resolved_point(point, parameters) for point in definition.get("points", [])],
    }
    if "metadata" in project:
        project_object["metadata"] = project["metadata"]

    return result_shape, {
        "status": "success",
        "provider": PROVIDER,
        "projectId": project["id"],
        "resultNodeId": result_id,
        "resultKind": result_kind,
        "bodies": primary_bodies,
        "bounds": aggregate_bounds(primary_bodies),
        "projectObject": project_object,
        "warnings": [],
        "exactExport": {"format": "step", "available": True},
    }, role_shapes


if __name__ == "__main__":
    try:
        request = json.loads(Path(sys.argv[1]).read_text())
        output = Path(sys.argv[2]); output.mkdir(parents=True, exist_ok=True)
        shape, result, role_shapes = evaluate(request)
        step_path = output / "model.step"
        export_step(shape, step_path)
        exact_step_paths = {"result": step_path}
        for role, role_shape in role_shapes.items():
            if role == "result":
                continue
            role_step_path = output / THREEDM_EXACT_STEP_NAMES[role]
            export_step(role_shape, role_step_path)
            exact_step_paths[role] = role_step_path
        write_3dm(request["project"], result, exact_step_paths, output / "model.3dm")
        (output / "result.json").write_text(json.dumps(result, separators=(",", ":")))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
