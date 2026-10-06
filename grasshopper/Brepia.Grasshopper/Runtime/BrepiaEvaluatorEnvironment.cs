namespace Brepia.Grasshopper.Runtime;

public static class BrepiaEvaluatorEnvironment
{
    public const string BaseUrlVariable = "BREPIA_GRASSHOPPER_BASE_URL";
    public const string TokenVariable = "BREPIA_GRASSHOPPER_TOKEN";

    public static BrepiaEvaluatorConnection Resolve()
    {
        var baseUrl = Environment.GetEnvironmentVariable(BaseUrlVariable)?.Trim();
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            throw new InvalidOperationException(
                $"Brepia evaluator is not configured. Set {BaseUrlVariable} to the Brepia base URL.");
        }
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("http" or "https"))
        {
            throw new InvalidOperationException(
                $"{BaseUrlVariable} must be an absolute http/https URL.");
        }

        var normalized = uri.AbsoluteUri.EndsWith("/", StringComparison.Ordinal)
            ? uri
            : new Uri($"{uri.AbsoluteUri}/", UriKind.Absolute);
        var token = Environment.GetEnvironmentVariable(TokenVariable)?.Trim();
        return new BrepiaEvaluatorConnection(
            normalized,
            string.IsNullOrWhiteSpace(token) ? null : token);
    }

    public static string Describe()
    {
        var baseUrl = Environment.GetEnvironmentVariable(BaseUrlVariable)?.Trim();
        var token = Environment.GetEnvironmentVariable(TokenVariable)?.Trim();
        return string.Join(
            Environment.NewLine,
            "Brepia Grasshopper evaluator configuration",
            $"{BaseUrlVariable}: {(string.IsNullOrWhiteSpace(baseUrl) ? "<not set>" : baseUrl)}",
            $"{TokenVariable}: {(string.IsNullOrWhiteSpace(token) ? "<not set>" : "<set>")}",
            "The bearer token is read from the process environment and is never persisted in the Grasshopper document.");
    }
}
