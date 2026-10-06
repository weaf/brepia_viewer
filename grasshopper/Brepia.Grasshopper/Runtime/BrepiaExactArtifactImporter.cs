using System.Text.Json;
using System.Text.Json.Nodes;
using Rhino;
using Rhino.DocObjects;
using Rhino.FileIO;
using Rhino.Geometry;

namespace Brepia.Grasshopper.Runtime;

public sealed record BrepiaImportedExactArtifacts(
    IReadOnlyDictionary<string, Brep> BrepsByRole,
    string? PlacementJson,
    string? ProjectObjectJson,
    string? MetadataJson,
    IReadOnlyList<string> Warnings);

public static class BrepiaExactArtifactImporter
{
    private const int MaxWarnings = 128;
    private const int MaxWarningChars = 4096;

    public static BrepiaImportedExactArtifacts Import(
        byte[] threeDmBytes,
        BrepiaGrasshopperContract contract)
    {
        var tempDirectory = Path.Combine(
            Path.GetTempPath(),
            $"brepia-gh-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDirectory);

        try
        {
            var threeDmPath = Path.Combine(tempDirectory, "brepia-runtime.3dm");
            File.WriteAllBytes(threeDmPath, threeDmBytes);

            using var model = File3dm.Read(threeDmPath)
                ?? throw new InvalidDataException("Rhino could not read the Brepia 3DM response.");

            RequireDocumentString(model, "brepia.projectId", contract.ProjectId);
            RequireDocumentString(
                model,
                "brepia.schemaVersion",
                contract.ProjectSchemaVersion.ToString(System.Globalization.CultureInfo.InvariantCulture));
            RequireDocumentString(
                model,
                "brepia.resultNodeId",
                contract.ExactArtifacts[0].NodeId);
            RequireDocumentString(model, "brepia.geometryRepresentation", "tessellated-mesh");

            var manifestJson = model.Strings.GetValue("brepia.exactBrepArtifacts")
                ?? throw new InvalidDataException(
                    "Brepia 3DM response is missing brepia.exactBrepArtifacts.");
            ValidateManifest(manifestJson, contract.ExactArtifacts);
            var warnings = ParseWarnings(model.Strings.GetValue("brepia.warnings"));

            var embeddedByName = new Dictionary<string, File3dmEmbeddedFile>(StringComparer.Ordinal);
            foreach (var embedded in model.EmbeddedFiles)
            {
                if (!embeddedByName.TryAdd(embedded.Filename, embedded))
                {
                    throw new InvalidDataException(
                        $"Brepia 3DM response contains duplicate embedded file {embedded.Filename}.");
                }
            }

            var expectedNames = contract.ExactArtifacts
                .Select(artifact => artifact.FileName)
                .ToHashSet(StringComparer.Ordinal);
            if (!embeddedByName.Keys.ToHashSet(StringComparer.Ordinal).SetEquals(expectedNames))
            {
                throw new InvalidDataException(
                    "Brepia 3DM embedded exact STEP set does not match the canonical contract roles.");
            }

            var imported = new Dictionary<string, Brep>(StringComparer.Ordinal);
            foreach (var expectation in contract.ExactArtifacts)
            {
                if (!embeddedByName.TryGetValue(expectation.FileName, out var embedded))
                {
                    throw new InvalidDataException(
                        $"Brepia 3DM response is missing exact STEP {expectation.FileName}.");
                }

                var stepPath = Path.Combine(tempDirectory, expectation.FileName);
                if (!embedded.SaveToFile(stepPath))
                {
                    throw new InvalidDataException(
                        $"Rhino could not extract exact STEP for role {expectation.Role}.");
                }
                ValidateStepHeader(stepPath, expectation.Role);
                imported[expectation.Role] = ImportSingleBrep(stepPath, expectation.Role);
            }

            return new BrepiaImportedExactArtifacts(
                imported,
                model.Strings.GetValue("brepia.placement"),
                model.Strings.GetValue("brepia.projectObject"),
                model.Strings.GetValue("brepia.metadata"),
                warnings);
        }
        finally
        {
            try
            {
                Directory.Delete(tempDirectory, recursive: true);
            }
            catch
            {
                // Temp cleanup must not hide a solve/import result or its primary failure.
            }
        }
    }

    private static Brep ImportSingleBrep(string stepPath, string role)
    {
        using var document = RhinoDoc.CreateHeadless(null)
            ?? throw new InvalidOperationException("Rhino could not create a headless document for STEP import.");
        var options = new FileStpReadOptions();
        if (!FileStp.Read(stepPath, document, options))
        {
            throw new InvalidDataException($"Rhino STEP import failed for Brepia role {role}.");
        }

        var breps = document.Objects
            .GetObjectList(ObjectType.Brep)
            .Select(item => item.Geometry)
            .OfType<Brep>()
            .Select(item => item.DuplicateBrep())
            .ToArray();

        if (breps.Length != 1)
        {
            foreach (var brep in breps) brep.Dispose();
            throw new InvalidDataException(
                $"Exact STEP for Brepia role {role} imported as {breps.Length} Breps; contract v1 requires exactly one.");
        }
        return breps[0];
    }

    private static IReadOnlyList<string> ParseWarnings(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Array.Empty<string>();

        JsonArray warnings;
        try
        {
            warnings = JsonNode.Parse(json) as JsonArray
                ?? throw new InvalidDataException("brepia.warnings must be a JSON array.");
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("brepia.warnings is invalid JSON.", error);
        }

        if (warnings.Count > MaxWarnings)
        {
            throw new InvalidDataException(
                $"Brepia evaluator returned more than {MaxWarnings} warnings.");
        }

        var result = new List<string>(warnings.Count);
        foreach (var node in warnings)
        {
            if (node is not JsonValue value ||
                !value.TryGetValue<string>(out var warning) ||
                warning.Length > MaxWarningChars)
            {
                throw new InvalidDataException(
                    $"Every Brepia warning must be text of at most {MaxWarningChars} characters.");
            }
            if (!string.IsNullOrWhiteSpace(warning)) result.Add(warning.Trim());
        }
        return result;
    }

    private static void ValidateManifest(
        string json,
        IReadOnlyList<BrepiaExactArtifactExpectation> expected)
    {
        JsonArray manifest;
        try
        {
            manifest = JsonNode.Parse(json) as JsonArray
                ?? throw new InvalidDataException("brepia.exactBrepArtifacts must be a JSON array.");
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("brepia.exactBrepArtifacts is invalid JSON.", error);
        }

        if (manifest.Count != expected.Count)
        {
            throw new InvalidDataException(
                "Brepia exact-artifact manifest count does not match the canonical contract.");
        }

        for (var index = 0; index < expected.Count; index += 1)
        {
            var actual = manifest[index] as JsonObject
                ?? throw new InvalidDataException("Every exact-artifact manifest entry must be an object.");
            var expectation = expected[index];
            RequireManifestString(actual, "role", expectation.Role);
            RequireManifestString(actual, "nodeId", expectation.NodeId);
            RequireManifestString(actual, "format", "step");
            RequireManifestString(actual, "representation", "exact-brep");
            RequireManifestString(actual, "contentType", "model/step");
            RequireManifestString(actual, "fileName", expectation.FileName);
        }
    }

    private static void RequireManifestString(JsonObject entry, string property, string expected)
    {
        if (entry[property] is not JsonValue value ||
            !value.TryGetValue<string>(out var actual) ||
            !string.Equals(actual, expected, StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                $"Brepia exact-artifact manifest {property} does not match the canonical contract.");
        }
    }

    private static void RequireDocumentString(File3dm model, string key, string expected)
    {
        var actual = model.Strings.GetValue(key);
        if (!string.Equals(actual, expected, StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                $"Brepia 3DM document string {key} does not match the canonical contract.");
        }
    }

    private static void ValidateStepHeader(string path, string role)
    {
        Span<byte> header = stackalloc byte[128];
        using var stream = File.OpenRead(path);
        var count = stream.Read(header);
        var text = System.Text.Encoding.ASCII.GetString(header[..count]);
        if (!text.Contains("ISO-10303-21", StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                $"Embedded artifact for Brepia role {role} is not an ISO-10303-21 STEP file.");
        }
    }
}
