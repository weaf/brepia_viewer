using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Brepia.Grasshopper.Runtime;

public sealed record BrepiaParameterDefinition(
    string Id,
    string Label,
    string Unit,
    double Default,
    double? Min,
    double? Max,
    double? Step,
    string? Description);

public sealed record BrepiaExactArtifactExpectation(
    string Role,
    string NodeId,
    string FileName);

public sealed class BrepiaGrasshopperContract
{
    public const string ContractKind = "brepia-grasshopper-contract";
    public const int ContractSchemaVersion = 1;
    public const int MaxContractBytes = 2_097_152;
    public const string PlacementInputId = "placement";

    private static readonly (string Role, string Field, string FileName)[] OptionalExactRoles =
    [
        ("footprint", "footprintNodeId", "brepia-footprint.step"),
        ("clearanceEnvelope", "clearanceEnvelopeNodeId", "brepia-clearance-envelope.step"),
        ("maintenanceEnvelope", "maintenanceEnvelopeNodeId", "brepia-maintenance-envelope.step"),
    ];

    private readonly JsonObject _source;

    private BrepiaGrasshopperContract(
        string projectId,
        string projectName,
        int projectSchemaVersion,
        string sourceRevisionId,
        JsonObject source,
        IReadOnlyList<BrepiaParameterDefinition> parameters,
        IReadOnlyList<BrepiaExactArtifactExpectation> exactArtifacts,
        string normalizedJson)
    {
        ProjectId = projectId;
        ProjectName = projectName;
        ProjectSchemaVersion = projectSchemaVersion;
        SourceRevisionId = sourceRevisionId;
        _source = source;
        Parameters = parameters;
        ExactArtifacts = exactArtifacts;
        NormalizedJson = normalizedJson;
    }

    public string ProjectId { get; }
    public string ProjectName { get; }
    public int ProjectSchemaVersion { get; }
    public string SourceRevisionId { get; }
    public IReadOnlyList<BrepiaParameterDefinition> Parameters { get; }
    public IReadOnlyList<BrepiaExactArtifactExpectation> ExactArtifacts { get; }
    public string NormalizedJson { get; }

    public JsonObject CloneSource() => (JsonObject)_source.DeepClone();

    public static BrepiaGrasshopperContract Parse(string json)
    {
        if (Encoding.UTF8.GetByteCount(json) > MaxContractBytes)
        {
            throw new InvalidDataException(
                $"Grasshopper contract exceeds {MaxContractBytes} bytes.");
        }

        JsonObject root;
        try
        {
            root = JsonNode.Parse(json) as JsonObject
                ?? throw new InvalidDataException("Grasshopper contract must be a JSON object.");
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Grasshopper contract is not valid JSON.", error);
        }

        if (RequireString(root, "kind") != ContractKind)
        {
            throw new InvalidDataException($"Grasshopper contract kind must be {ContractKind}.");
        }
        if (RequireInt(root, "schemaVersion") != ContractSchemaVersion)
        {
            throw new InvalidDataException(
                $"Unsupported Grasshopper contract schema version. Expected {ContractSchemaVersion}.");
        }

        var model = RequireObject(root, "model");
        var projectId = RequireNonEmptyString(model, "projectId");
        var projectName = RequireNonEmptyString(model, "projectName");
        var projectSchemaVersion = RequireInt(model, "projectSchemaVersion");
        var sourceRevisionId = RequireNonEmptyString(model, "sourceRevisionId");
        if (sourceRevisionId.Length > 160)
        {
            throw new InvalidDataException(
                "Grasshopper contract sourceRevisionId must be at most 160 characters.");
        }

        var source = (JsonObject)RequireObject(root, "source").DeepClone();
        if (RequireNonEmptyString(source, "id") != projectId ||
            RequireNonEmptyString(source, "name") != projectName ||
            RequireInt(source, "schemaVersion") != projectSchemaVersion)
        {
            throw new InvalidDataException(
                "Grasshopper contract model identity does not match its canonical BRep source.");
        }

        var resultNodeId = RequireNonEmptyString(source, "resultNodeId");
        var parameters = ParseParameters(source);
        var exactArtifacts = BuildExactArtifacts(source, resultNodeId);
        var normalized = BuildNormalizedRoot(
            projectId,
            projectName,
            projectSchemaVersion,
            sourceRevisionId,
            source,
            parameters);

        return new BrepiaGrasshopperContract(
            projectId,
            projectName,
            projectSchemaVersion,
            sourceRevisionId,
            source,
            parameters,
            exactArtifacts,
            normalized.ToJsonString(new JsonSerializerOptions { WriteIndented = false }));
    }

    private static IReadOnlyList<BrepiaParameterDefinition> ParseParameters(JsonObject source)
    {
        var array = source["parameters"] as JsonArray
            ?? throw new InvalidDataException("BRep source parameters must be an array.");
        var result = new List<BrepiaParameterDefinition>(array.Count);
        var ids = new HashSet<string>(StringComparer.Ordinal);

        foreach (var item in array)
        {
            var parameter = item as JsonObject
                ?? throw new InvalidDataException("Every BRep parameter must be an object.");
            var id = RequireNonEmptyString(parameter, "id");
            if (!ids.Add(id))
            {
                throw new InvalidDataException($"Duplicate BRep parameter id: {id}.");
            }

            var label = RequireNonEmptyString(parameter, "label");
            var unit = RequireNonEmptyString(parameter, "unit");
            if (unit is not ("mm" or "deg" or "none"))
            {
                throw new InvalidDataException($"Unsupported BRep parameter unit for {id}: {unit}.");
            }

            var defaultValue = RequireFiniteDouble(parameter, "default");
            var min = OptionalFiniteDouble(parameter, "min");
            var max = OptionalFiniteDouble(parameter, "max");
            var step = OptionalFiniteDouble(parameter, "step");
            var description = OptionalString(parameter, "description");

            if (min is not null && max is not null && min > max)
            {
                throw new InvalidDataException($"BRep parameter {id} has min greater than max.");
            }
            if (min is not null && defaultValue < min || max is not null && defaultValue > max)
            {
                throw new InvalidDataException($"BRep parameter {id} default is outside its bounds.");
            }
            if (step is not null && step <= 0)
            {
                throw new InvalidDataException($"BRep parameter {id} step must be positive.");
            }

            result.Add(new BrepiaParameterDefinition(
                id,
                label,
                unit,
                defaultValue,
                min,
                max,
                step,
                description));
        }

        return result;
    }

    private static IReadOnlyList<BrepiaExactArtifactExpectation> BuildExactArtifacts(
        JsonObject source,
        string resultNodeId)
    {
        var result = new List<BrepiaExactArtifactExpectation>
        {
            new("result", resultNodeId, "brepia-primary.step"),
        };

        if (source["projectObject"] is not JsonObject projectObject)
        {
            return result;
        }

        foreach (var (role, field, fileName) in OptionalExactRoles)
        {
            if (projectObject[field] is null)
            {
                continue;
            }
            result.Add(new BrepiaExactArtifactExpectation(
                role,
                RequireNonEmptyString(projectObject, field),
                fileName));
        }

        return result;
    }

    private static JsonObject BuildNormalizedRoot(
        string projectId,
        string projectName,
        int projectSchemaVersion,
        string sourceRevisionId,
        JsonObject source,
        IReadOnlyList<BrepiaParameterDefinition> parameters)
    {
        var inputs = new JsonArray();
        foreach (var parameter in parameters)
        {
            var input = new JsonObject
            {
                ["id"] = parameter.Id,
                ["label"] = parameter.Label,
                ["type"] = "number",
                ["access"] = "item",
                ["unit"] = parameter.Unit,
                ["default"] = parameter.Default,
            };
            if (parameter.Min is not null) input["min"] = parameter.Min.Value;
            if (parameter.Max is not null) input["max"] = parameter.Max.Value;
            if (parameter.Step is not null) input["step"] = parameter.Step.Value;
            if (!string.IsNullOrWhiteSpace(parameter.Description))
            {
                input["description"] = parameter.Description;
            }
            input["fallback"] = "project-default";
            inputs.Add(input);
        }

        inputs.Add(new JsonObject
        {
            ["id"] = PlacementInputId,
            ["label"] = "Plane",
            ["type"] = "plane",
            ["access"] = "item",
            ["description"] =
                "Target insertion plane. When unconnected, Brepia resolves the project placement under the current parameter values.",
            ["fallback"] = "project-placement",
        });

        return new JsonObject
        {
            ["kind"] = ContractKind,
            ["schemaVersion"] = ContractSchemaVersion,
            ["model"] = new JsonObject
            {
                ["projectId"] = projectId,
                ["projectName"] = projectName,
                ["projectSchemaVersion"] = projectSchemaVersion,
                ["sourceRevisionId"] = sourceRevisionId,
            },
            ["source"] = source.DeepClone(),
            ["interface"] = new JsonObject
            {
                ["inputs"] = inputs,
                ["outputs"] = BuildStandardOutputs(),
            },
            ["placement"] = new JsonObject
            {
                ["inputId"] = PlacementInputId,
                ["unconnected"] = "resolved-project-placement",
                ["connected"] = "replace-project-placement",
                ["sourceGeometrySpace"] = "component-local",
                ["application"] = "transform-all-project-outputs-to-target-plane",
                ["axisMeaning"] = "orientation-only",
            },
            ["diagnostics"] = new JsonObject
            {
                ["mode"] = "grasshopper-runtime-messages",
                ["warningSeverity"] = "warning",
                ["errorSeverity"] = "error",
            },
        };
    }

    private static JsonArray BuildStandardOutputs() =>
    [
        BrepOutput("result", "Result", false, "primary-result"),
        BrepOutput("footprint", "Footprint", true, "footprint"),
        BrepOutput("clearanceEnvelope", "Clearance", true, "clearance-envelope"),
        BrepOutput("maintenanceEnvelope", "Maintenance", true, "maintenance-envelope"),
        PointOutput("connectionPoints", "Connections", "connection"),
        PointOutput("mountingPoints", "Mounting", "mounting"),
        PointOutput("cablePoints", "Cable", "cable"),
        new JsonObject
        {
            ["id"] = "metadata",
            ["label"] = "Metadata",
            ["type"] = "project-metadata",
            ["access"] = "item",
            ["optional"] = false,
        },
    ];

    private static JsonObject BrepOutput(string id, string label, bool optional, string semantic) =>
        new()
        {
            ["id"] = id,
            ["label"] = label,
            ["type"] = "brep",
            ["access"] = "item",
            ["optional"] = optional,
            ["semantic"] = semantic,
        };

    private static JsonObject PointOutput(string id, string label, string pointKind) =>
        new()
        {
            ["id"] = id,
            ["label"] = label,
            ["type"] = "semantic-point",
            ["access"] = "list",
            ["pointKind"] = pointKind,
            ["optional"] = false,
        };

    private static JsonObject RequireObject(JsonObject parent, string property) =>
        parent[property] as JsonObject
        ?? throw new InvalidDataException($"Grasshopper contract {property} must be an object.");

    private static string RequireString(JsonObject parent, string property)
    {
        if (parent[property] is JsonValue value && value.TryGetValue<string>(out var text))
        {
            return text;
        }
        throw new InvalidDataException($"Grasshopper contract {property} must be text.");
    }

    private static string RequireNonEmptyString(JsonObject parent, string property)
    {
        var value = RequireString(parent, property).Trim();
        return value.Length > 0
            ? value
            : throw new InvalidDataException($"Grasshopper contract {property} must be non-empty text.");
    }

    private static string? OptionalString(JsonObject parent, string property)
    {
        if (parent[property] is null) return null;
        return RequireString(parent, property);
    }

    private static int RequireInt(JsonObject parent, string property)
    {
        if (parent[property] is JsonValue value && value.TryGetValue<int>(out var number))
        {
            return number;
        }
        throw new InvalidDataException($"Grasshopper contract {property} must be an integer.");
    }

    private static double RequireFiniteDouble(JsonObject parent, string property)
    {
        if (parent[property] is JsonValue value && value.TryGetValue<double>(out var number) && double.IsFinite(number))
        {
            return number;
        }
        throw new InvalidDataException($"Grasshopper contract {property} must be a finite number.");
    }

    private static double? OptionalFiniteDouble(JsonObject parent, string property)
    {
        if (parent[property] is null) return null;
        return RequireFiniteDouble(parent, property);
    }
}
