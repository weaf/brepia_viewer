using System.Text.Json;
using Brepia.Grasshopper.Packaging;

var planMode = args.Length == 3 && string.Equals(args[0], "--plan", StringComparison.Ordinal);
if ((!planMode && args.Length != 2) ||
    (planMode && args.Length != 3))
{
    Console.Error.WriteLine(
        "Usage: Brepia.Grasshopper.Packager [--plan] <contract-or-plan.json> <output.gh>");
    return 2;
}

try
{
    var inputPath = args[planMode ? 1 : 0];
    var outputPath = args[planMode ? 2 : 1];
    var inputJson = File.ReadAllText(inputPath);
    var result = planMode
        ? BrepiaGrasshopperDocumentPackager.WritePackagePlan(inputJson, outputPath)
        : BrepiaGrasshopperDocumentPackager.Write(inputJson, outputPath);
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        kind = "brepia-grasshopper-package-result",
        schemaVersion = 1,
        result.ProjectId,
        result.SourceRevisionId,
        componentInstanceId = result.ComponentInstanceId,
        result.GeneratedControlCount,
        result.ByteLength,
        result.OutputPath,
    }));
    return 0;
}
catch (Exception error)
{
    Console.Error.WriteLine(error.ToString());
    return 1;
}
