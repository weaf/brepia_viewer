using System.Text.Json;
using Brepia.Grasshopper.Components;
using Brepia.Grasshopper.Runtime;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Special;
using Grasshopper.Kernel.Types;

namespace Brepia.Grasshopper.Packaging;

public static class BrepiaGrasshopperReconciliationExtractor
{
    private const string Kind = "brepia-grasshopper-reconciliation";
    private const int SchemaVersion = 1;
    private const int MaxExternalObjects = 2_048;
    private const int MaxExternalConnections = 8_192;

    private sealed record ParameterObservation(
        string Id,
        Guid ExpectedControlInstanceGuid,
        string ValueStatus,
        double? Value,
        string SourceOwnership,
        Guid? SourceObjectGuid);

    private sealed record ExternalObjectEvidence(
        Guid InstanceGuid,
        Guid ComponentGuid,
        string? Name,
        string? Nickname);

    private sealed record ExternalConnectionEvidence(
        Guid? FromObjectGuid,
        Guid FromParamGuid,
        Guid? ToObjectGuid,
        Guid ToParamGuid);

    public static string Extract(
        GH_Document document,
        Guid? componentInstanceGuid = null)
    {
        ArgumentNullException.ThrowIfNull(document);

        var candidates = document.Objects
            .OfType<BrepiaProjectComponent>()
            .Where(component => component.Contract is not null)
            .Where(component => componentInstanceGuid is null || component.InstanceGuid == componentInstanceGuid)
            .ToArray();
        if (candidates.Length != 1)
        {
            throw new InvalidDataException(
                componentInstanceGuid is null
                    ? $"Expected exactly one Brepia Project component with an embedded contract, found {candidates.Length}."
                    : $"Expected exactly one Brepia Project component {componentInstanceGuid:D} with an embedded contract, found {candidates.Length}.");
        }

        var component = candidates[0];
        var contract = component.Contract!;
        var plan = BrepiaGrasshopperPackagePlan.Create(contract);
        if (component.Params.Input.Count != contract.Parameters.Count + 1)
        {
            throw new InvalidDataException(
                "Brepia component inputs do not match its embedded canonical contract.");
        }

        var objectByGuid = document.Objects.ToDictionary(item => item.InstanceGuid);
        var ownerByParamGuid = BuildParameterOwnerMap(document);
        var observations = new List<ParameterObservation>(contract.Parameters.Count);
        for (var index = 0; index < contract.Parameters.Count; index += 1)
        {
            var parameter = contract.Parameters[index];
            var expectedControl = plan.Controls.Single(control => control.InputId == parameter.Id);
            var input = component.Params.Input[index];
            var source = input.SourceCount == 1 ? input.Sources[0] : null;
            var sourceObjectGuid = source is null
                ? null
                : ResolveOwnerGuid(source, ownerByParamGuid);
            var value = source is null
                ? null
                : TryReadNumericSource(source, sourceObjectGuid, objectByGuid);

            if (value is not null)
            {
                ValidateCanonicalValue(value.Value, parameter.Id, parameter.Min, parameter.Max);
            }

            observations.Add(new ParameterObservation(
                parameter.Id,
                expectedControl.InstanceGuid,
                value is null ? "unresolved" : "resolved",
                value,
                sourceObjectGuid is null
                    ? "unconnected-or-unknown"
                    : sourceObjectGuid == expectedControl.InstanceGuid
                        ? "generated-brepia-control"
                        : "external-grasshopper-source",
                sourceObjectGuid));
        }

        var placementInput = component.Params.Input[^1];
        var placementSource = placementInput.SourceCount == 1
            ? ResolveOwnerGuid(placementInput.Sources[0], ownerByParamGuid)
            : null;

        var brepiaOwnedObjectGuids = new HashSet<Guid>(
            plan.Controls.Select(control => control.InstanceGuid))
        {
            component.InstanceGuid,
        };
        var externalObjects = document.Objects
            .Where(item => !brepiaOwnedObjectGuids.Contains(item.InstanceGuid))
            .Select(item => new ExternalObjectEvidence(
                item.InstanceGuid,
                item.ComponentGuid,
                string.IsNullOrWhiteSpace(item.Name) ? null : item.Name,
                string.IsNullOrWhiteSpace(item.NickName) ? null : item.NickName))
            .ToArray();
        if (externalObjects.Length > MaxExternalObjects)
        {
            throw new InvalidDataException(
                $"Grasshopper reconciliation external object evidence exceeds {MaxExternalObjects} objects.");
        }

        var externalConnections = CaptureExternalConnections(
            document,
            ownerByParamGuid,
            brepiaOwnedObjectGuids);
        if (externalConnections.Count > MaxExternalConnections)
        {
            throw new InvalidDataException(
                $"Grasshopper reconciliation external connection evidence exceeds {MaxExternalConnections} connections.");
        }

        using var contractDocument = JsonDocument.Parse(contract.NormalizedJson);
        var payload = new
        {
            kind = Kind,
            schemaVersion = SchemaVersion,
            model = new
            {
                projectId = contract.ProjectId,
                projectName = contract.ProjectName,
                projectSchemaVersion = contract.ProjectSchemaVersion,
                sourceRevisionId = contract.SourceRevisionId,
            },
            contract = contractDocument.RootElement.Clone(),
            componentIdentity = new
            {
                expectedInstanceGuid = plan.Component.InstanceGuid.ToString("D"),
                observedInstanceGuid = component.InstanceGuid.ToString("D"),
                recognition = component.InstanceGuid == plan.Component.InstanceGuid
                    ? "exact-generated-instance"
                    : "contract-recognized-instance",
            },
            parameters = observations.Select(observation => new
            {
                id = observation.Id,
                expectedControlInstanceGuid = observation.ExpectedControlInstanceGuid.ToString("D"),
                valueStatus = observation.ValueStatus,
                value = observation.Value,
                sourceOwnership = observation.SourceOwnership,
                sourceObjectGuid = observation.SourceObjectGuid?.ToString("D"),
            }),
            placement = placementSource is null
                ? (object)new
                {
                    inputId = BrepiaGrasshopperContract.PlacementInputId,
                    mode = "project-placement",
                }
                : new
                {
                    inputId = BrepiaGrasshopperContract.PlacementInputId,
                    mode = "grasshopper-source",
                    sourceObjectGuid = placementSource.Value.ToString("D"),
                },
            externalEvidence = new
            {
                authority = "evidence-only",
                completeness = "document-scan",
                objects = externalObjects.Select(item => new
                {
                    instanceGuid = item.InstanceGuid.ToString("D"),
                    componentGuid = item.ComponentGuid.ToString("D"),
                    name = item.Name,
                    nickname = item.Nickname,
                }),
                connections = externalConnections.Select(connection => new
                {
                    fromObjectGuid = connection.FromObjectGuid?.ToString("D"),
                    fromParamGuid = connection.FromParamGuid.ToString("D"),
                    toObjectGuid = connection.ToObjectGuid?.ToString("D"),
                    toParamGuid = connection.ToParamGuid.ToString("D"),
                }),
            },
        };

        return JsonSerializer.Serialize(
            payload,
            new JsonSerializerOptions
            {
                WriteIndented = true,
                DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
            }) + "\n";
    }

    private static Dictionary<Guid, Guid> BuildParameterOwnerMap(GH_Document document)
    {
        var map = new Dictionary<Guid, Guid>();
        foreach (var item in document.Objects)
        {
            switch (item)
            {
                case IGH_Component component:
                    foreach (var parameter in component.Params.Input.Concat(component.Params.Output))
                    {
                        map[parameter.InstanceGuid] = item.InstanceGuid;
                    }
                    break;
                case IGH_Param parameter:
                    map[parameter.InstanceGuid] = item.InstanceGuid;
                    break;
            }
        }
        return map;
    }

    private static Guid? ResolveOwnerGuid(
        IGH_Param parameter,
        IReadOnlyDictionary<Guid, Guid> ownerByParamGuid) =>
        ownerByParamGuid.TryGetValue(parameter.InstanceGuid, out var ownerGuid)
            ? ownerGuid
            : null;

    private static double? TryReadNumericSource(
        IGH_Param source,
        Guid? sourceObjectGuid,
        IReadOnlyDictionary<Guid, IGH_DocumentObject> objectByGuid)
    {
        if (sourceObjectGuid is not null &&
            objectByGuid.TryGetValue(sourceObjectGuid.Value, out var sourceObject))
        {
            if (sourceObject is GH_NumberSlider slider)
            {
                return (double)slider.Slider.Value;
            }
            if (sourceObject is Param_Number numberParameter)
            {
                var persistent = numberParameter.PersistentData
                    .AllData(true)
                    .OfType<GH_Number>()
                    .ToArray();
                if (persistent.Length == 1) return persistent[0].Value;
            }
        }

        var volatileNumbers = source.VolatileData
            .AllData(true)
            .OfType<GH_Number>()
            .ToArray();
        return volatileNumbers.Length == 1 ? volatileNumbers[0].Value : null;
    }

    private static void ValidateCanonicalValue(
        double value,
        string inputId,
        double? min,
        double? max)
    {
        if (!double.IsFinite(value) ||
            (min is not null && value < min) ||
            (max is not null && value > max))
        {
            throw new InvalidDataException(
                $"Recovered Grasshopper value for Brepia parameter {inputId} violates its canonical bounds.");
        }
    }

    private static IReadOnlyList<ExternalConnectionEvidence> CaptureExternalConnections(
        GH_Document document,
        IReadOnlyDictionary<Guid, Guid> ownerByParamGuid,
        IReadOnlySet<Guid> brepiaOwnedObjectGuids)
    {
        var result = new List<ExternalConnectionEvidence>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in document.Objects)
        {
            foreach (var target in EnumerateInputParameters(item))
            {
                var targetOwnerGuid = ResolveOwnerGuid(target, ownerByParamGuid);
                foreach (var source in target.Sources)
                {
                    var sourceOwnerGuid = ResolveOwnerGuid(source, ownerByParamGuid);
                    if (sourceOwnerGuid is not null &&
                        targetOwnerGuid is not null &&
                        brepiaOwnedObjectGuids.Contains(sourceOwnerGuid.Value) &&
                        brepiaOwnedObjectGuids.Contains(targetOwnerGuid.Value))
                    {
                        continue;
                    }

                    var key = $"{sourceOwnerGuid:D}:{source.InstanceGuid:D}->{targetOwnerGuid:D}:{target.InstanceGuid:D}";
                    if (!seen.Add(key)) continue;
                    result.Add(new ExternalConnectionEvidence(
                        sourceOwnerGuid,
                        source.InstanceGuid,
                        targetOwnerGuid,
                        target.InstanceGuid));
                }
            }
        }
        return result;
    }

    private static IEnumerable<IGH_Param> EnumerateInputParameters(
        IGH_DocumentObject item) =>
        item switch
        {
            IGH_Component component => component.Params.Input,
            IGH_Param parameter => new[] { parameter },
            _ => Array.Empty<IGH_Param>(),
        };
}
