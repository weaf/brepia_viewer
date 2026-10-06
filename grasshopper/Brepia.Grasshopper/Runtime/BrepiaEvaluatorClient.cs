using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Brepia.Grasshopper.Runtime;

public sealed record BrepiaEvaluatorConnection(Uri BaseUri, string? BearerToken = null)
{
    public Uri ExportUri => new(BaseUri, "api/brep/export/step");
}

public sealed class BrepiaEvaluatorClient
{
    public const int MaxThreeDmBytes = 64 * 1024 * 1024;
    private const int MaxErrorBytes = 32 * 1024;
    private readonly HttpClient _httpClient;

    public BrepiaEvaluatorClient(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<byte[]> EvaluateThreeDmAsync(
        BrepiaEvaluatorConnection connection,
        BrepiaGrasshopperContract contract,
        IReadOnlyDictionary<string, double>? parameterValues,
        CancellationToken cancellationToken)
    {
        var values = NormalizeParameterValues(contract, parameterValues);
        var requestJson = new JsonObject
        {
            ["project"] = contract.CloneSource(),
            ["parameterValues"] = new JsonObject(
                values.Select(item =>
                    new KeyValuePair<string, JsonNode?>(item.Key, JsonValue.Create(item.Value)))),
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, connection.ExportUri)
        {
            Content = new StringContent(
                requestJson.ToJsonString(new JsonSerializerOptions { WriteIndented = false }),
                Encoding.UTF8,
                "application/json"),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("model/vnd.3dm"));
        if (!string.IsNullOrWhiteSpace(connection.BearerToken))
        {
            request.Headers.Authorization =
                new AuthenticationHeaderValue("Bearer", connection.BearerToken.Trim());
        }

        using var response = await _httpClient.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            var detail = await ReadBoundedTextAsync(
                response.Content,
                MaxErrorBytes,
                cancellationToken).ConfigureAwait(false);
            throw new InvalidOperationException(
                $"Brepia evaluator failed ({(int)response.StatusCode} {response.ReasonPhrase}): {detail}");
        }

        var mediaType = response.Content.Headers.ContentType?.MediaType;
        if (!string.Equals(mediaType, "model/vnd.3dm", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException(
                $"Brepia evaluator returned unexpected content type: {mediaType ?? "<missing>"}.");
        }

        if (response.Content.Headers.ContentLength is long declaredLength &&
            (declaredLength <= 0 || declaredLength > MaxThreeDmBytes))
        {
            throw new InvalidDataException(
                $"Brepia evaluator 3DM response has invalid size: {declaredLength} bytes.");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken)
            .ConfigureAwait(false);
        return await ReadBoundedBytesAsync(stream, MaxThreeDmBytes, cancellationToken)
            .ConfigureAwait(false);
    }

    public static IReadOnlyDictionary<string, double> NormalizeParameterValues(
        BrepiaGrasshopperContract contract,
        IReadOnlyDictionary<string, double>? supplied)
    {
        var known = contract.Parameters.ToDictionary(parameter => parameter.Id, StringComparer.Ordinal);
        if (supplied is not null)
        {
            foreach (var id in supplied.Keys)
            {
                if (!known.ContainsKey(id))
                {
                    throw new InvalidDataException($"Unknown Brepia parameter id: {id}.");
                }
            }
        }

        var result = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var parameter in contract.Parameters)
        {
            var value = supplied is not null && supplied.TryGetValue(parameter.Id, out var suppliedValue)
                ? suppliedValue
                : parameter.Default;
            if (!double.IsFinite(value))
            {
                throw new InvalidDataException(
                    $"Brepia parameter {parameter.Id} must be a finite number.");
            }
            if (parameter.Min is not null && value < parameter.Min ||
                parameter.Max is not null && value > parameter.Max)
            {
                throw new InvalidDataException(
                    $"Brepia parameter {parameter.Id} is outside its published bounds.");
            }
            result[parameter.Id] = value;
        }
        return result;
    }

    private static async Task<byte[]> ReadBoundedBytesAsync(
        Stream stream,
        int maxBytes,
        CancellationToken cancellationToken)
    {
        using var output = new MemoryStream();
        var buffer = new byte[64 * 1024];
        while (true)
        {
            var count = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (count == 0) break;
            if (output.Length + count > maxBytes)
            {
                throw new InvalidDataException(
                    $"Brepia evaluator 3DM response exceeds {maxBytes} bytes.");
            }
            output.Write(buffer, 0, count);
        }
        if (output.Length == 0)
        {
            throw new InvalidDataException("Brepia evaluator returned an empty 3DM response.");
        }
        return output.ToArray();
    }

    private static async Task<string> ReadBoundedTextAsync(
        HttpContent content,
        int maxBytes,
        CancellationToken cancellationToken)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken)
            .ConfigureAwait(false);
        var bytes = await ReadBoundedErrorBytesAsync(stream, maxBytes, cancellationToken)
            .ConfigureAwait(false);
        return Encoding.UTF8.GetString(bytes);
    }

    private static async Task<byte[]> ReadBoundedErrorBytesAsync(
        Stream stream,
        int maxBytes,
        CancellationToken cancellationToken)
    {
        using var output = new MemoryStream();
        var buffer = new byte[4096];
        while (output.Length < maxBytes)
        {
            var remaining = maxBytes - (int)output.Length;
            var count = await stream.ReadAsync(
                buffer.AsMemory(0, Math.Min(buffer.Length, remaining)),
                cancellationToken).ConfigureAwait(false);
            if (count == 0) break;
            output.Write(buffer, 0, count);
        }
        return output.ToArray();
    }
}
