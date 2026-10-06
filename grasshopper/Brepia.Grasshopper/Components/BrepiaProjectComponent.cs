using System.Text.Json;
using Brepia.Grasshopper.Runtime;
using GH_IO.Serialization;
using Grasshopper.GUI;
using Grasshopper.GUI.Canvas;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Attributes;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Rhino.Geometry;

namespace Brepia.Grasshopper.Components;

public sealed class BrepiaProjectComponent : GH_Component
{
    private const string ContractArchiveKey = "brepia.contract.v1";
    private const string InputIdsArchiveKey = "brepia.inputParameterIds.v1";
    private static readonly HttpClient SharedHttpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(120),
    };

    private BrepiaGrasshopperContract? _contract;
    private string? _contractLoadError;
    private IReadOnlyList<string> _inputParameterIds = Array.Empty<string>();

    public BrepiaProjectComponent()
        : base(
            "Brepia Project",
            "Brepia",
            "A Brepia-authored parametric project object. Double-click to load or replace its embedded Brepia contract.",
            "Brepia",
            "Project")
    {
    }

    public override Guid ComponentGuid =>
        new("56F4B72D-8972-4899-9522-0CDA8F59BB71");

    protected override System.Drawing.Bitmap? Icon => null;

    public BrepiaGrasshopperContract? Contract => _contract;

    public override void CreateAttributes()
    {
        m_attributes = new BrepiaProjectComponentAttributes(this);
    }

    public void LoadContractJson(string json)
    {
        var next = BrepiaGrasshopperContract.Parse(json);
        RecordUndoEvent("Load Brepia contract");
        ApplyContract(next);
        ExpireSolution(recompute: true);
    }

    internal void LoadContractFromDialog()
    {
        var dialog = new Rhino.UI.OpenFileDialog
        {
            Title = _contract is null ? "Load Brepia Grasshopper contract" : "Replace Brepia Grasshopper contract",
            Filter = "Brepia Grasshopper contract (*.brepia-grasshopper.json)|*.brepia-grasshopper.json|JSON files (*.json)|*.json||",
            MultiSelect = false,
        };
        if (!dialog.ShowOpenDialog()) return;

        try
        {
            LoadContractJson(File.ReadAllText(dialog.FileName));
        }
        catch (Exception error)
        {
            _contractLoadError = $"Could not load Brepia contract: {error.Message}";
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, _contractLoadError);
            ExpireSolution(recompute: false);
        }
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        // Inputs are reconstructed from the embedded canonical contract.
        // A newly placed component intentionally has no model-specific ports
        // until the user explicitly loads a Brepia contract.
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddBrepParameter("Result", "R", "Primary exact Brepia BRep.", GH_ParamAccess.item);
        pManager.AddBrepParameter("Footprint", "F", "Optional exact footprint BRep.", GH_ParamAccess.item);
        pManager.AddBrepParameter("Clearance", "C", "Optional exact clearance-envelope BRep.", GH_ParamAccess.item);
        pManager.AddBrepParameter("Maintenance", "M", "Optional exact maintenance-envelope BRep.", GH_ParamAccess.item);
        pManager.AddPointParameter("Connections", "CP", "Semantic connection points.", GH_ParamAccess.list);
        pManager.AddPointParameter("Mounting", "MP", "Semantic mounting points.", GH_ParamAccess.list);
        pManager.AddPointParameter("Cable", "CaP", "Semantic cable points.", GH_ParamAccess.list);
        pManager.AddTextParameter(
            "Metadata",
            "Meta",
            "Brepia project/revision identity, metadata, exact-role identity and transformed semantic-point identity as JSON.",
            GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        if (_contractLoadError is not null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, _contractLoadError);
            return;
        }
        if (_contract is null)
        {
            AddRuntimeMessage(
                GH_RuntimeMessageLevel.Remark,
                "No Brepia contract is embedded. Double-click this component to load a *.brepia-grasshopper.json contract.");
            return;
        }

        var expectedInputIds = ExpectedInputIds(_contract);
        if (!_inputParameterIds.SequenceEqual(expectedInputIds, StringComparer.Ordinal) ||
            Params.Input.Count != expectedInputIds.Count)
        {
            AddRuntimeMessage(
                GH_RuntimeMessageLevel.Error,
                "Brepia component inputs do not match the embedded canonical contract. Reload the contract.");
            return;
        }

        try
        {
            var values = new Dictionary<string, double>(StringComparer.Ordinal);
            for (var index = 0; index < _contract.Parameters.Count; index += 1)
            {
                var parameter = _contract.Parameters[index];
                var value = parameter.Default;
                if (!DA.GetData(index, ref value))
                {
                    AddRuntimeMessage(
                        GH_RuntimeMessageLevel.Error,
                        $"Missing value for Brepia parameter {parameter.Label} ({parameter.Id}).");
                    return;
                }
                values[parameter.Id] = value;
            }

            Plane? suppliedPlane = null;
            var planeIndex = _contract.Parameters.Count;
            var plane = Plane.Unset;
            if (DA.GetData(planeIndex, ref plane)) suppliedPlane = plane;

            var connection = BrepiaEvaluatorEnvironment.Resolve();
            var runtime = new BrepiaSolveRuntime(SharedHttpClient);
            var imported = runtime
                .SolveAsync(connection, _contract, values)
                .GetAwaiter()
                .GetResult();

            BrepiaTransformedProjectOutputs transformed;
            try
            {
                transformed = BrepiaProjectOutputs.Transform(imported, _contract, suppliedPlane);
            }
            finally
            {
                foreach (var brep in imported.BrepsByRole.Values) brep.Dispose();
            }

            foreach (var warning in transformed.Warnings)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, warning);
            }

            DA.SetData(0, RequiredRole(transformed.BrepsByRole, "result"));
            DA.SetData(1, OptionalRole(transformed.BrepsByRole, "footprint"));
            DA.SetData(2, OptionalRole(transformed.BrepsByRole, "clearanceEnvelope"));
            DA.SetData(3, OptionalRole(transformed.BrepsByRole, "maintenanceEnvelope"));
            DA.SetDataList(
                4,
                transformed.SemanticPoints
                    .Where(point => point.Kind == "connection")
                    .Select(point => point.Position));
            DA.SetDataList(
                5,
                transformed.SemanticPoints
                    .Where(point => point.Kind == "mounting")
                    .Select(point => point.Position));
            DA.SetDataList(
                6,
                transformed.SemanticPoints
                    .Where(point => point.Kind == "cable")
                    .Select(point => point.Position));
            DA.SetData(7, transformed.MetadataJson);
        }
        catch (Exception error)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, error.Message);
        }
    }

    public override bool Write(GH_IWriter writer)
    {
        if (_contract is not null)
        {
            writer.SetString(ContractArchiveKey, _contract.NormalizedJson);
            writer.SetString(InputIdsArchiveKey, JsonSerializer.Serialize(_inputParameterIds));
        }
        return base.Write(writer);
    }

    public override bool Read(GH_IReader reader)
    {
        var baseResult = base.Read(reader);
        _contract = null;
        _contractLoadError = null;
        _inputParameterIds = Array.Empty<string>();

        if (!reader.ItemExists(ContractArchiveKey)) return baseResult;

        try
        {
            var contract = BrepiaGrasshopperContract.Parse(reader.GetString(ContractArchiveKey));
            var persistedIds = reader.ItemExists(InputIdsArchiveKey)
                ? ParseInputIds(reader.GetString(InputIdsArchiveKey))
                : Array.Empty<string>();
            _inputParameterIds = persistedIds;
            ApplyContract(contract);
        }
        catch (Exception error)
        {
            _contractLoadError = $"Embedded Brepia contract is invalid: {error.Message}";
        }
        return baseResult;
    }

    private void ApplyContract(BrepiaGrasshopperContract contract)
    {
        _contract = contract;
        _contractLoadError = null;
        NickName = contract.ProjectName;
        RebuildInputs(contract);
    }

    private void RebuildInputs(BrepiaGrasshopperContract contract)
    {
        var expectedIds = ExpectedInputIds(contract);
        if (InputsAlreadyMatch(contract, expectedIds))
        {
            ConfigureExistingInputs(contract);
            _inputParameterIds = expectedIds;
            Params.OnParametersChanged();
            return;
        }

        var reusable = new Dictionary<string, IGH_Param>(StringComparer.Ordinal);
        if (_inputParameterIds.Count == Params.Input.Count)
        {
            for (var index = 0; index < _inputParameterIds.Count; index += 1)
            {
                var id = _inputParameterIds[index];
                var parameter = Params.Input[index];
                var compatible = id == BrepiaGrasshopperContract.PlacementInputId
                    ? parameter is Param_Plane
                    : parameter is Param_Number;
                if (compatible && expectedIds.Contains(id, StringComparer.Ordinal))
                {
                    reusable[id] = parameter;
                }
            }
        }

        foreach (var parameter in Params.Input.ToArray())
        {
            var preserveSources = reusable.Values.Contains(parameter);
            Params.UnregisterInputParameter(parameter, isolate: !preserveSources);
        }

        foreach (var definition in contract.Parameters)
        {
            Param_Number parameter;
            if (reusable.TryGetValue(definition.Id, out var existing) && existing is Param_Number number)
            {
                parameter = number;
            }
            else
            {
                parameter = new Param_Number();
                parameter.SetPersistentData(new GH_Number(definition.Default));
            }
            ConfigureNumberParameter(parameter, definition);
            Params.RegisterInputParam(parameter);
        }

        Param_Plane planeParameter;
        if (reusable.TryGetValue(BrepiaGrasshopperContract.PlacementInputId, out var existingPlane) &&
            existingPlane is Param_Plane existingParamPlane)
        {
            planeParameter = existingParamPlane;
        }
        else
        {
            planeParameter = new Param_Plane();
        }
        ConfigurePlaneParameter(planeParameter);
        Params.RegisterInputParam(planeParameter);

        _inputParameterIds = expectedIds;
        Params.OnParametersChanged();
    }

    private bool InputsAlreadyMatch(
        BrepiaGrasshopperContract contract,
        IReadOnlyList<string> expectedIds)
    {
        if (!_inputParameterIds.SequenceEqual(expectedIds, StringComparer.Ordinal) ||
            Params.Input.Count != expectedIds.Count)
        {
            return false;
        }

        for (var index = 0; index < contract.Parameters.Count; index += 1)
        {
            if (Params.Input[index] is not Param_Number) return false;
        }
        return Params.Input[^1] is Param_Plane;
    }

    private void ConfigureExistingInputs(BrepiaGrasshopperContract contract)
    {
        for (var index = 0; index < contract.Parameters.Count; index += 1)
        {
            ConfigureNumberParameter((Param_Number)Params.Input[index], contract.Parameters[index]);
        }
        ConfigurePlaneParameter((Param_Plane)Params.Input[^1]);
    }

    private static void ConfigureNumberParameter(
        Param_Number parameter,
        BrepiaParameterDefinition definition)
    {
        parameter.Name = definition.Label;
        parameter.NickName = definition.Label;
        parameter.Description = string.Join(
            Environment.NewLine,
            definition.Description ?? "Published Brepia numeric parameter.",
            $"Brepia parameter id: {definition.Id}",
            $"Unit: {definition.Unit}",
            definition.Min is null ? null : $"Min: {definition.Min}",
            definition.Max is null ? null : $"Max: {definition.Max}",
            definition.Step is null ? null : $"Step: {definition.Step}")
            .Replace($"{Environment.NewLine}{Environment.NewLine}", Environment.NewLine);
        parameter.Access = GH_ParamAccess.item;
        parameter.Optional = false;
    }

    private static void ConfigurePlaneParameter(Param_Plane parameter)
    {
        parameter.Name = "Plane";
        parameter.NickName = "Plane";
        parameter.Description =
            "Optional target insertion Plane. When no Plane data is supplied, the resolved Brepia project placement is used. Axis magnitudes never scale geometry.\nBrepia parameter id: placement";
        parameter.Access = GH_ParamAccess.item;
        parameter.Optional = true;
    }

    private static IReadOnlyList<string> ExpectedInputIds(BrepiaGrasshopperContract contract) =>
        contract.Parameters
            .Select(parameter => parameter.Id)
            .Append(BrepiaGrasshopperContract.PlacementInputId)
            .ToArray();

    private static IReadOnlyList<string> ParseInputIds(string json)
    {
        string[]? ids;
        try
        {
            ids = JsonSerializer.Deserialize<string[]>(json);
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Embedded Brepia input identity list is invalid JSON.", error);
        }
        if (ids is null || ids.Any(string.IsNullOrWhiteSpace) ||
            ids.Distinct(StringComparer.Ordinal).Count() != ids.Length)
        {
            throw new InvalidDataException("Embedded Brepia input identity list is invalid.");
        }
        return ids;
    }

    private static Brep RequiredRole(
        IReadOnlyDictionary<string, Brep> roles,
        string role) =>
        roles.TryGetValue(role, out var brep)
            ? brep
            : throw new InvalidDataException($"Brepia solve is missing required exact role {role}.");

    private static Brep? OptionalRole(
        IReadOnlyDictionary<string, Brep> roles,
        string role) =>
        roles.TryGetValue(role, out var brep) ? brep : null;
}

internal sealed class BrepiaProjectComponentAttributes : GH_ComponentAttributes
{
    private readonly BrepiaProjectComponent _component;

    public BrepiaProjectComponentAttributes(BrepiaProjectComponent component)
        : base(component)
    {
        _component = component;
    }

    public override GH_ObjectResponse RespondToMouseDoubleClick(
        GH_Canvas sender,
        GH_CanvasMouseEvent e)
    {
        _component.LoadContractFromDialog();
        return GH_ObjectResponse.Handled;
    }
}
