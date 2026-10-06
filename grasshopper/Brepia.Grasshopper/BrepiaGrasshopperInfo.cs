using Grasshopper.Kernel;

namespace Brepia.Grasshopper;

public sealed class BrepiaGrasshopperInfo : GH_AssemblyInfo
{
    public override string Name => "Brepia";
    public override string Description =>
        "AI-native Brepia parametric project interoperability for Rhino and Grasshopper.";
    public override Guid Id => new("60E7F96B-2E84-4DA9-B864-E2DF1B287C0B");
    public override string AuthorName => "Brepia";
    public override string AuthorContact => "https://github.com/weaf/brepia";
    public override System.Drawing.Bitmap? Icon => null;
}
