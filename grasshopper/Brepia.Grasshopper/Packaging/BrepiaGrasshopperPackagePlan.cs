using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Brepia.Grasshopper.Runtime;

namespace Brepia.Grasshopper.Packaging;

internal sealed record BrepiaGrasshopperCanvasPoint(float X, float Y);

internal sealed record BrepiaGrasshopperCanvasBounds(
    float X,
    float Y,
    float Width,
    float Height);

internal sealed record BrepiaGrasshopperNumberControlPlan(
    Guid InstanceGuid,
    string InputId,
    string Label,
    string Unit,
    double Default,
    double? Min,
    double? Max,
    double? Step,
    string Presentation,
    BrepiaGrasshopperCanvasBounds Bounds);

internal sealed record BrepiaGrasshopperProjectComponentPlan(
    Guid InstanceGuid,
    string NickName,
    BrepiaGrasshopperCanvasPoint Pivot);

internal sealed record BrepiaGrasshopperConnectionPlan(
    Guid FromObjectGuid,
    Guid ToObjectGuid,
    string ToInputId);

internal sealed class BrepiaGrasshopperPackagePlan
{
    private const string Kind = "brepia-grasshopper-package-plan";
    private const int SchemaVersion = 1;
    private const int MaxBytes = 4 * 1024 * 1024;
    private const float ControlX = 40;
    private const float ControlY = 80;
    private const float ControlYStep = 70;
    private const float ComponentX = 420;
    private const float ControlWidth = 280;
    private const float ControlHeight = 28;
    private const string InstanceGuidNamespace = "brepia-grasshopper-package-plan-v1";

    private BrepiaGrasshopperPackagePlan(
        BrepiaGrasshopperContract contract,
        BrepiaGrasshopperProjectComponentPlan component,
        IReadOnlyList<BrepiaGrasshopperNumberControlPlan> controls,
        IReadOnlyList<BrepiaGrasshopperConnectionPlan> connections)
    {
        Contract = contract;
        Component = component;
        Controls = controls;
        Connections = connections;
    }

    public BrepiaGrasshopperContract Contract { get; }
    public BrepiaGrasshopperProjectComponentPlan Component { get; }
    public IReadOnlyList<BrepiaGrasshopperNumberControlPlan> Controls { get; }
    public IReadOnlyList<BrepiaGrasshopperConnectionPlan> Connections { get; }
    public string PlacementInputId => BrepiaGrasshopperContract.PlacementInputId;

    public static BrepiaGrasshopperPackagePlan Parse(string json)
    {
        if (Encoding.UTF8.GetByteCount(json) > MaxBytes)
        {
            throw new InvalidDataException(
                $"Grasshopper package plan exceeds {MaxBytes} bytes.");
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(json);
        }
        catch (JsonException error)
        {
            throw new InvalidDataException(
                "Grasshopper package plan is not valid JSON.",
                error);
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                throw new InvalidDataException(
                    "Grasshopper package plan must be an object.");
            }
            if (!root.TryGetProperty("kind", out var kind) ||
                !string.Equals(kind.GetString(), Kind, StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    $"Grasshopper package plan kind must be {Kind}.");
            }
            if (!root.TryGetProperty("schemaVersion", out var schemaVersion) ||
                schemaVersion.ValueKind != JsonValueKind.Number ||
                !schemaVersion.TryGetInt32(out var version))
            {
                throw new InvalidDataException(
                    "Grasshopper package plan schemaVersion is required.");
            }
            if (version != SchemaVersion)
            {
                throw new InvalidDataException(
                    $"Unsupported Grasshopper package plan schema version: {version}.");
            }
            if (!root.TryGetProperty("contract", out var contractElement) ||
                contractElement.ValueKind != JsonValueKind.Object)
            {
                throw new InvalidDataException(
                    "Grasshopper package plan must embed its canonical Brepia contract.");
            }

            // The transported component/control/wire sections are derived data.
            // Rebuild them from the embedded trusted contract rather than
            // granting a remote plan independent model authority.
            var contract = BrepiaGrasshopperContract.Parse(contractElement.GetRawText());
            return Create(contract);
        }
    }

    public static BrepiaGrasshopperPackagePlan Create(BrepiaGrasshopperContract contract)
    {
        var componentGuid = StableGuid(contract.ProjectId, "brepia-project");
        var controls = contract.Parameters
            .Select((parameter, index) => new BrepiaGrasshopperNumberControlPlan(
                StableGuid(contract.ProjectId, "number-control", parameter.Id),
                parameter.Id,
                parameter.Label,
                parameter.Unit,
                parameter.Default,
                parameter.Min,
                parameter.Max,
                parameter.Step,
                parameter.Min is not null && parameter.Max is not null && parameter.Min < parameter.Max
                    ? "slider"
                    : "number",
                new BrepiaGrasshopperCanvasBounds(
                    ControlX,
                    ControlY + index * ControlYStep,
                    ControlWidth,
                    ControlHeight)))
            .ToArray();

        var componentY = controls.Length > 0
            ? ControlY + ((controls.Length - 1) * ControlYStep) / 2
            : ControlY;
        var component = new BrepiaGrasshopperProjectComponentPlan(
            componentGuid,
            contract.ProjectName,
            new BrepiaGrasshopperCanvasPoint(ComponentX, componentY));
        var connections = controls
            .Select(control => new BrepiaGrasshopperConnectionPlan(
                control.InstanceGuid,
                componentGuid,
                control.InputId))
            .ToArray();

        return new BrepiaGrasshopperPackagePlan(contract, component, controls, connections);
    }

    private static Guid StableGuid(params string[] parts)
    {
        var segments = new[] { InstanceGuidNamespace }
            .Concat(parts)
            .Select(Encoding.UTF8.GetBytes)
            .ToArray();
        var input = new byte[segments.Sum(segment => 4 + segment.Length)];
        var offset = 0;
        foreach (var segment in segments)
        {
            BinaryPrimitives.WriteUInt32BigEndian(
                input.AsSpan(offset, 4),
                checked((uint)segment.Length));
            offset += 4;
            segment.CopyTo(input, offset);
            offset += segment.Length;
        }

        var hash = SHA256.HashData(input);
        hash[6] = (byte)((hash[6] & 0x0f) | 0x80);
        hash[8] = (byte)((hash[8] & 0x3f) | 0x80);
        var hex = Convert.ToHexString(hash.AsSpan(0, 16)).ToLowerInvariant();
        return Guid.ParseExact(
            $"{hex[..8]}-{hex[8..12]}-{hex[12..16]}-{hex[16..20]}-{hex[20..32]}",
            "D");
    }
}
