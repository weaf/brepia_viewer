using System.Drawing;
using Brepia.Grasshopper.Components;
using Brepia.Grasshopper.Runtime;
using GH_IO.Serialization;
using Grasshopper.GUI.Base;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Special;
using Grasshopper.Kernel.Types;

namespace Brepia.Grasshopper.Packaging;

public sealed record BrepiaGrasshopperPackageResult(
    string OutputPath,
    long ByteLength,
    string ProjectId,
    string SourceRevisionId,
    Guid ComponentInstanceId,
    int GeneratedControlCount);

public static class BrepiaGrasshopperDocumentPackager
{
    private const string DefinitionArchiveName = "Definition";
    private const int MaxGeneratedSnapPoints = 4_096;

    private sealed record GeneratedControl(
        IGH_DocumentObject DocumentObject,
        IGH_Param OutputParameter);

    public static BrepiaGrasshopperPackageResult Write(
        string contractJson,
        string outputPath)
    {
        var contract = BrepiaGrasshopperContract.Parse(contractJson);
        return WritePlan(BrepiaGrasshopperPackagePlan.Create(contract), outputPath);
    }

    public static BrepiaGrasshopperPackageResult WritePackagePlan(
        string packagePlanJson,
        string outputPath) =>
        WritePlan(BrepiaGrasshopperPackagePlan.Parse(packagePlanJson), outputPath);

    private static BrepiaGrasshopperPackageResult WritePlan(
        BrepiaGrasshopperPackagePlan plan,
        string outputPath)
    {
        var fullOutputPath = Path.GetFullPath(outputPath);
        if (!string.Equals(
                Path.GetExtension(fullOutputPath),
                GH_Archive.GrasshopperBinaryExtension,
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException(
                $"Grasshopper package output must use the {GH_Archive.GrasshopperBinaryExtension} extension.");
        }

        var directory = Path.GetDirectoryName(fullOutputPath);
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new InvalidDataException("Grasshopper package output directory is invalid.");
        }
        Directory.CreateDirectory(directory);

        var component = CreateProjectComponent(plan);
        var generatedControls = plan.Controls
            .Select(CreateControl)
            .ToArray();

        var document = new GH_Document();
        foreach (var control in generatedControls)
        {
            if (!document.AddObject(control.DocumentObject, update: false))
            {
                throw new InvalidDataException(
                    $"Could not add generated Grasshopper control {control.DocumentObject.InstanceGuid} to the document.");
            }
        }
        if (!document.AddObject(component, update: false))
        {
            throw new InvalidDataException("Could not add the Brepia component to the Grasshopper document.");
        }

        WireControls(plan, component, generatedControls);
        EnsurePlacementUnconnected(plan, component);

        var archive = new GH_Archive();
        if (!archive.AppendObject(document, DefinitionArchiveName))
        {
            throw new InvalidDataException("Could not serialize the Grasshopper document archive.");
        }

        // Avoid GH_Archive.WriteToFile/ReadFromFile. Those convenience APIs pull
        // desktop UI dependencies; the archive codec plus ordinary file I/O is
        // a narrower Rhino-hosted boundary.
        var binary = archive.Serialize_Binary();
        if (binary.Length == 0)
        {
            throw new IOException("Grasshopper document archive serialized to zero bytes.");
        }
        File.WriteAllBytes(fullOutputPath, binary);

        ValidateArchive(binary, plan);

        var fileInfo = new FileInfo(fullOutputPath);
        if (!fileInfo.Exists || fileInfo.Length <= 0)
        {
            throw new IOException("Grasshopper document archive is empty after serialization.");
        }

        return new BrepiaGrasshopperPackageResult(
            fullOutputPath,
            fileInfo.Length,
            plan.Contract.ProjectId,
            plan.Contract.SourceRevisionId,
            plan.Component.InstanceGuid,
            generatedControls.Length);
    }

    private static BrepiaProjectComponent CreateProjectComponent(
        BrepiaGrasshopperPackagePlan plan)
    {
        var component = new BrepiaProjectComponent();
        component.LoadContractJson(plan.Contract.NormalizedJson);
        component.NewInstanceGuid(plan.Component.InstanceGuid);
        component.NickName = plan.Component.NickName;
        component.CreateAttributes();
        component.Attributes.Pivot = new PointF(
            plan.Component.Pivot.X,
            plan.Component.Pivot.Y);
        return component;
    }

    private static GeneratedControl CreateControl(
        BrepiaGrasshopperNumberControlPlan plan) =>
        plan.Presentation switch
        {
            "slider" => CreateSlider(plan),
            "number" => CreateNumberParameter(plan),
            _ => throw new InvalidDataException(
                $"Unsupported generated Grasshopper control presentation: {plan.Presentation}."),
        };

    private static GeneratedControl CreateSlider(
        BrepiaGrasshopperNumberControlPlan plan)
    {
        if (plan.Min is null || plan.Max is null || plan.Min >= plan.Max)
        {
            throw new InvalidDataException(
                $"Generated slider {plan.InputId} requires a finite increasing canonical range.");
        }

        var slider = new GH_NumberSlider();
        slider.CreateAttributes();
        slider.NewInstanceGuid(plan.InstanceGuid);
        slider.NickName = plan.Label;
        slider.Slider.Type = GH_SliderAccuracy.Float;
        slider.Slider.DecimalPlaces = RequiredDecimalPlaces(plan);
        slider.Slider.Minimum = ToDecimal(plan.Min.Value, plan.InputId, "min");
        slider.Slider.Maximum = ToDecimal(plan.Max.Value, plan.InputId, "max");
        slider.Slider.Value = ToDecimal(plan.Default, plan.InputId, "default");
        slider.Slider.FixDomain();
        slider.Slider.FixValue();
        ConfigureStepSnapping(slider, plan);
        ApplyCanvasBounds(slider, plan.Bounds);
        return new GeneratedControl(slider, slider);
    }

    private static GeneratedControl CreateNumberParameter(
        BrepiaGrasshopperNumberControlPlan plan)
    {
        var parameter = new Param_Number
        {
            Name = plan.Label,
            NickName = plan.Label,
            Description = BuildControlDescription(plan),
            Access = GH_ParamAccess.item,
            Optional = false,
        };
        parameter.SetPersistentData(new GH_Number(plan.Default));
        parameter.NewInstanceGuid(plan.InstanceGuid);
        parameter.CreateAttributes();
        ApplyCanvasBounds(parameter, plan.Bounds);
        return new GeneratedControl(parameter, parameter);
    }

    private static string BuildControlDescription(
        BrepiaGrasshopperNumberControlPlan plan) =>
        string.Join(
            Environment.NewLine,
            new string?[]
            {
                "Generated Brepia numeric input.",
                $"Brepia parameter id: {plan.InputId}",
                $"Unit: {plan.Unit}",
                plan.Min is null ? null : $"Min: {plan.Min}",
                plan.Max is null ? null : $"Max: {plan.Max}",
                plan.Step is null ? null : $"Step: {plan.Step}",
            }.Where(line => line is not null));

    private static void ApplyCanvasBounds(
        IGH_DocumentObject documentObject,
        BrepiaGrasshopperCanvasBounds bounds)
    {
        documentObject.Attributes.Pivot = new PointF(bounds.X, bounds.Y);
        documentObject.Attributes.Bounds = new RectangleF(
            bounds.X,
            bounds.Y,
            bounds.Width,
            bounds.Height);
    }

    private static void ConfigureStepSnapping(
        GH_NumberSlider slider,
        BrepiaGrasshopperNumberControlPlan plan)
    {
        if (plan.Step is null || plan.Min is null || plan.Max is null)
        {
            return;
        }

        var step = ToDecimal(plan.Step.Value, plan.InputId, "step");
        var min = ToDecimal(plan.Min.Value, plan.InputId, "min");
        var max = ToDecimal(plan.Max.Value, plan.InputId, "max");
        if (step <= 0 || max <= min)
        {
            throw new InvalidDataException(
                $"Generated slider {plan.InputId} has invalid step/range semantics.");
        }

        var intervalCount = decimal.Floor((max - min) / step);
        if (intervalCount + 1 > MaxGeneratedSnapPoints)
        {
            // Keep the canonical step in the embedded contract and control
            // description rather than fabricating a coarser Grasshopper step.
            return;
        }

        var snapValues = new HashSet<decimal>();
        for (var index = 0; index <= (int)intervalCount; index += 1)
        {
            snapValues.Add(min + index * step);
        }
        snapValues.Add(max);
        snapValues.Add(ToDecimal(plan.Default, plan.InputId, "default"));

        slider.Slider.SetSnapRanges(
            snapValues
                .OrderBy(value => value)
                .Select(value => new SliderSnapRange(value)));
        slider.Slider.SnapDistance = step / 2m;
    }

    private static int RequiredDecimalPlaces(
        BrepiaGrasshopperNumberControlPlan plan)
    {
        var values = new[] { plan.Default, plan.Min, plan.Max, plan.Step };
        var maxScale = 0;
        foreach (var value in values)
        {
            if (value is null) continue;
            var decimalValue = ToDecimal(value.Value, plan.InputId, "numeric value");
            var scale = (decimal.GetBits(decimalValue)[3] >> 16) & 0x7f;
            maxScale = Math.Max(maxScale, Math.Min(scale, 12));
        }
        return maxScale;
    }

    private static decimal ToDecimal(
        double value,
        string inputId,
        string field)
    {
        try
        {
            return (decimal)value;
        }
        catch (OverflowException error)
        {
            throw new InvalidDataException(
                $"Brepia parameter {inputId} {field} cannot be represented by a Grasshopper Number Slider.",
                error);
        }
    }

    private static void WireControls(
        BrepiaGrasshopperPackagePlan plan,
        BrepiaProjectComponent component,
        IReadOnlyList<GeneratedControl> generatedControls)
    {
        var controlsById = generatedControls.ToDictionary(
            control => control.DocumentObject.InstanceGuid);

        foreach (var connection in plan.Connections)
        {
            if (connection.ToObjectGuid != component.InstanceGuid)
            {
                throw new InvalidDataException(
                    $"Generated Grasshopper wire targets unknown component {connection.ToObjectGuid}.");
            }
            if (!controlsById.TryGetValue(connection.FromObjectGuid, out var source))
            {
                throw new InvalidDataException(
                    $"Generated Grasshopper wire references unknown control {connection.FromObjectGuid}.");
            }

            var target = ResolveComponentInputById(
                plan.Contract,
                component,
                connection.ToInputId);
            if (target.SourceCount != 0)
            {
                throw new InvalidDataException(
                    $"Generated Brepia input {connection.ToInputId} unexpectedly already has a source.");
            }
            target.AddSource(source.OutputParameter);
        }
    }

    private static IGH_Param ResolveComponentInputById(
        BrepiaGrasshopperContract contract,
        BrepiaProjectComponent component,
        string inputId)
    {
        if (component.Params.Input.Count != contract.Parameters.Count + 1)
        {
            throw new InvalidDataException(
                "Brepia component inputs do not match the canonical package contract.");
        }

        for (var index = 0; index < contract.Parameters.Count; index += 1)
        {
            if (string.Equals(contract.Parameters[index].Id, inputId, StringComparison.Ordinal))
            {
                return component.Params.Input[index];
            }
        }
        throw new InvalidDataException(
            $"Generated Grasshopper wire references unknown Brepia input id {inputId}.");
    }

    private static void EnsurePlacementUnconnected(
        BrepiaGrasshopperPackagePlan plan,
        BrepiaProjectComponent component)
    {
        if (!string.Equals(
                plan.PlacementInputId,
                BrepiaGrasshopperContract.PlacementInputId,
                StringComparison.Ordinal) ||
            component.Params.Input.Count != plan.Contract.Parameters.Count + 1 ||
            component.Params.Input[^1].SourceCount != 0)
        {
            throw new InvalidDataException(
                "Generated Grasshopper package must leave the Brepia placement Plane unconnected.");
        }
    }

    private static void ValidateArchive(
        byte[] binary,
        BrepiaGrasshopperPackagePlan plan)
    {
        var archive = new GH_Archive();
        if (!archive.Deserialize_Binary(binary))
        {
            throw new InvalidDataException("Grasshopper archive could not be read back after serialization.");
        }

        var xml = archive.Serialize_Xml();
        if (!xml.Contains("brepia.contract.v1", StringComparison.Ordinal) ||
            !xml.Contains(plan.Contract.ProjectId, StringComparison.Ordinal) ||
            !xml.Contains(plan.Contract.SourceRevisionId, StringComparison.Ordinal) ||
            !xml.Contains(plan.Component.InstanceGuid.ToString("D"), StringComparison.OrdinalIgnoreCase) ||
            plan.Controls.Any(control =>
                !xml.Contains(control.InstanceGuid.ToString("D"), StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidDataException(
                "Grasshopper archive read-back is missing Brepia contract, component or generated-control identity data.");
        }
    }
}
