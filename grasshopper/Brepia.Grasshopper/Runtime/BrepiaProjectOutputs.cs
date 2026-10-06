using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Rhino.Geometry;

namespace Brepia.Grasshopper.Runtime;

public sealed record BrepiaSemanticPoint(
    string Id,
    string Kind,
    Point3d Position,
    Vector3d? Direction,
    string? Label);

public sealed record BrepiaTransformedProjectOutputs(
    IReadOnlyDictionary<string, Brep> BrepsByRole,
    IReadOnlyList<BrepiaSemanticPoint> SemanticPoints,
    string MetadataJson,
    IReadOnlyList<string> Warnings);

public static class BrepiaProjectOutputs
{
    private const double AxisTolerance = 1e-12;

    public static BrepiaTransformedProjectOutputs Transform(
        BrepiaImportedExactArtifacts imported,
        BrepiaGrasshopperContract contract,
        Plane? suppliedPlane)
    {
        var targetPlane = suppliedPlane is Plane connected
            ? NormalizePlane(connected, "Grasshopper Plane input")
            : ParsePlacementPlane(imported.PlacementJson);
        var transform = Rhino.Geometry.Transform.PlaneToPlane(Plane.WorldXY, targetPlane);

        var transformedBreps = new Dictionary<string, Brep>(StringComparer.Ordinal);
        try
        {
            foreach (var (role, sourceBrep) in imported.BrepsByRole)
            {
                var brep = sourceBrep.DuplicateBrep();
                if (!brep.Transform(transform))
                {
                    brep.Dispose();
                    throw new InvalidDataException(
                        $"Rhino could not place exact Brepia role {role} on the target Plane.");
                }
                transformedBreps[role] = brep;
            }

            var points = ParseSemanticPoints(imported.ProjectObjectJson)
                .Select(point => TransformPoint(point, transform))
                .ToArray();
            var metadataJson = BuildMetadataEnvelope(contract, imported.MetadataJson, points);

            return new BrepiaTransformedProjectOutputs(
                transformedBreps,
                points,
                metadataJson,
                imported.Warnings);
        }
        catch
        {
            foreach (var brep in transformedBreps.Values) brep.Dispose();
            throw;
        }
    }

    private static Plane ParsePlacementPlane(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            throw new InvalidDataException("Brepia evaluator response is missing project placement.");
        }

        JsonObject placement;
        try
        {
            placement = JsonNode.Parse(json) as JsonObject
                ?? throw new InvalidDataException("Brepia placement must be a JSON object.");
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Brepia placement is invalid JSON.", error);
        }

        var origin = ReadPoint(placement, "origin");
        var xAxis = ReadVector(placement, "xAxis");
        var yAxis = ReadVector(placement, "yAxis");
        return NormalizePlane(new Plane(origin, xAxis, yAxis), "resolved Brepia project placement");
    }

    private static Plane NormalizePlane(Plane plane, string source)
    {
        if (!plane.IsValid)
        {
            throw new InvalidDataException($"{source} is not a valid Plane.");
        }

        var xAxis = plane.XAxis;
        var yAxis = plane.YAxis;
        if (!xAxis.Unitize() || xAxis.SquareLength <= AxisTolerance)
        {
            throw new InvalidDataException($"{source} has an invalid X axis.");
        }

        yAxis -= Vector3d.Multiply(yAxis, xAxis) * xAxis;
        if (!yAxis.Unitize() || yAxis.SquareLength <= AxisTolerance)
        {
            throw new InvalidDataException($"{source} has collinear or invalid axes.");
        }

        var normalized = new Plane(plane.Origin, xAxis, yAxis);
        if (!normalized.IsValid)
        {
            throw new InvalidDataException($"{source} could not be normalized without scale.");
        }
        return normalized;
    }

    private static IReadOnlyList<BrepiaSemanticPoint> ParseSemanticPoints(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Array.Empty<BrepiaSemanticPoint>();

        JsonObject projectObject;
        try
        {
            projectObject = JsonNode.Parse(json) as JsonObject
                ?? throw new InvalidDataException("brepia.projectObject must be a JSON object.");
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("brepia.projectObject is invalid JSON.", error);
        }

        var array = projectObject["points"] as JsonArray
            ?? throw new InvalidDataException("brepia.projectObject points must be an array.");
        var points = new List<BrepiaSemanticPoint>(array.Count);
        var ids = new HashSet<string>(StringComparer.Ordinal);

        foreach (var node in array)
        {
            var point = node as JsonObject
                ?? throw new InvalidDataException("Every Brepia semantic point must be an object.");
            var id = RequireNonEmptyString(point, "id");
            if (!ids.Add(id))
            {
                throw new InvalidDataException($"Duplicate Brepia semantic point id: {id}.");
            }
            var kind = RequireNonEmptyString(point, "kind");
            if (kind is not ("connection" or "mounting" or "cable"))
            {
                throw new InvalidDataException($"Unsupported Brepia semantic point kind: {kind}.");
            }

            points.Add(new BrepiaSemanticPoint(
                id,
                kind,
                ReadPoint(point, "position"),
                point["direction"] is null ? null : ReadVector(point, "direction"),
                OptionalString(point, "label")));
        }

        return points;
    }

    private static BrepiaSemanticPoint TransformPoint(
        BrepiaSemanticPoint point,
        Rhino.Geometry.Transform transform)
    {
        var position = point.Position;
        position.Transform(transform);

        Vector3d? direction = point.Direction;
        if (direction is Vector3d sourceDirection)
        {
            sourceDirection.Transform(transform);
            direction = sourceDirection;
        }

        return point with { Position = position, Direction = direction };
    }

    private static string BuildMetadataEnvelope(
        BrepiaGrasshopperContract contract,
        string? metadataJson,
        IReadOnlyList<BrepiaSemanticPoint> points)
    {
        JsonNode? metadata = null;
        if (!string.IsNullOrWhiteSpace(metadataJson))
        {
            try
            {
                metadata = JsonNode.Parse(metadataJson);
            }
            catch (JsonException error)
            {
                throw new InvalidDataException("brepia.metadata is invalid JSON.", error);
            }
            if (metadata is not null and not JsonObject)
            {
                throw new InvalidDataException("brepia.metadata must be a JSON object when present.");
            }
        }

        var semanticPoints = new JsonArray();
        foreach (var point in points)
        {
            var item = new JsonObject
            {
                ["id"] = point.Id,
                ["kind"] = point.Kind,
                ["position"] = VectorArray(point.Position.X, point.Position.Y, point.Position.Z),
            };
            if (point.Direction is Vector3d direction)
            {
                item["direction"] = VectorArray(direction.X, direction.Y, direction.Z);
            }
            if (!string.IsNullOrWhiteSpace(point.Label)) item["label"] = point.Label;
            semanticPoints.Add(item);
        }

        var exactRoles = new JsonArray();
        foreach (var artifact in contract.ExactArtifacts)
        {
            exactRoles.Add(new JsonObject
            {
                ["role"] = artifact.Role,
                ["nodeId"] = artifact.NodeId,
            });
        }

        var envelope = new JsonObject
        {
            ["projectId"] = contract.ProjectId,
            ["projectName"] = contract.ProjectName,
            ["projectSchemaVersion"] = contract.ProjectSchemaVersion,
            ["sourceRevisionId"] = contract.SourceRevisionId,
            ["exactRoles"] = exactRoles,
            ["semanticPoints"] = semanticPoints,
            ["metadata"] = metadata?.DeepClone(),
        };
        return envelope.ToJsonString(new JsonSerializerOptions { WriteIndented = false });
    }

    private static JsonArray VectorArray(double x, double y, double z) =>
        new(x, y, z);

    private static Point3d ReadPoint(JsonObject parent, string property)
    {
        var values = ReadVectorValues(parent, property);
        return new Point3d(values[0], values[1], values[2]);
    }

    private static Vector3d ReadVector(JsonObject parent, string property)
    {
        var values = ReadVectorValues(parent, property);
        return new Vector3d(values[0], values[1], values[2]);
    }

    private static double[] ReadVectorValues(JsonObject parent, string property)
    {
        var array = parent[property] as JsonArray;
        if (array is null || array.Count != 3)
        {
            throw new InvalidDataException($"Brepia {property} must contain exactly three numbers.");
        }

        var values = new double[3];
        for (var index = 0; index < 3; index += 1)
        {
            if (array[index] is not JsonValue value ||
                !value.TryGetValue<double>(out var number) ||
                !double.IsFinite(number))
            {
                throw new InvalidDataException(
                    $"Brepia {property}[{index.ToString(CultureInfo.InvariantCulture)}] must be finite.");
            }
            values[index] = number;
        }
        return values;
    }

    private static string RequireNonEmptyString(JsonObject parent, string property)
    {
        if (parent[property] is JsonValue value &&
            value.TryGetValue<string>(out var text) &&
            !string.IsNullOrWhiteSpace(text))
        {
            return text.Trim();
        }
        throw new InvalidDataException($"Brepia semantic point {property} must be non-empty text.");
    }

    private static string? OptionalString(JsonObject parent, string property)
    {
        if (parent[property] is null) return null;
        if (parent[property] is JsonValue value && value.TryGetValue<string>(out var text))
        {
            return text;
        }
        throw new InvalidDataException($"Brepia semantic point {property} must be text.");
    }
}
