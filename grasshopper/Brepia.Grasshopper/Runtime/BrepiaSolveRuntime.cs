namespace Brepia.Grasshopper.Runtime;

public sealed class BrepiaSolveRuntime
{
    private readonly BrepiaEvaluatorClient _client;

    public BrepiaSolveRuntime(HttpClient httpClient)
    {
        _client = new BrepiaEvaluatorClient(httpClient);
    }

    public async Task<BrepiaImportedExactArtifacts> SolveAsync(
        BrepiaEvaluatorConnection connection,
        BrepiaGrasshopperContract contract,
        IReadOnlyDictionary<string, double>? parameterValues,
        CancellationToken cancellationToken = default)
    {
        var threeDm = await _client.EvaluateThreeDmAsync(
            connection,
            contract,
            parameterValues,
            cancellationToken).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        return BrepiaExactArtifactImporter.Import(threeDm, contract);
    }
}
