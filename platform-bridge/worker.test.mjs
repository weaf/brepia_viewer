import test from "node:test";
import assert from "node:assert/strict";
import { handleBridgeRequest } from "./worker.mjs";

const ORIGIN = "https://viewer.notydesign.se";
const request = (path, method = "GET", origin = ORIGIN) =>
  new Request("https://bridge.example.test" + path, {
    method,
    headers: origin ? { Origin: origin } : {},
  });

function upstream(fields = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const body = JSON.parse(options.body);
    const payload = body.query.includes("ViewerDownload")
      ? { data: { getDownloadLink: { ok: true, output: {
        link: fields.downloadUrl ?? "https://files.printables.com/prints/model.stl",
      } } } }
      : { data: { print: { name: "Public model", stls: [
        { id: "25", name: "model.stl", fileSize: 1024 },
        { id: "26", name: "model.3mf", fileSize: 2048 },
        { id: "27", name: "../../escape.stl", fileSize: 30 },
        { id: "28", name: "large.stl", fileSize: 18_000_000 },
        { id: "29", name: "info.txt", fileSize: 100 },
      ] } } };
    return new Response(JSON.stringify(payload));
  };
  return { calls, fetcher };
}

test("lists curated public STL/3MF only, no caller-supplied GraphQL", async () => {
  const { calls, fetcher } = upstream();
  const res = await handleBridgeRequest(request("/v1/printables/3161/files"), { fetcher });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual((await res.json()).files.map(file => file.name), ["model.stl", "model.3mf"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.printables.com/graphql/");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(JSON.parse(calls[0].options.body).variables.id, "3161");
});

test("resolves a file only after checking its membership in the public listing", async () => {
  const { calls, fetcher } = upstream();
  const res = await handleBridgeRequest(request("/v1/printables/3161/files/25/download"), { fetcher });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    url: "https://files.printables.com/prints/model.stl",
    filename: "model.stl", format: "stl",
  });
  assert.equal(calls.length, 2);
  assert.match(JSON.parse(calls[1].options.body).query, /getDownloadLink/);
  const missing = await handleBridgeRequest(request("/v1/printables/3161/files/1234/download"), { fetcher });
  assert.equal(missing.status, 404);
  assert.equal(calls.length, 3); // no mutation when file is not listed
});

test("refuses arbitrary or unsafe destinations", async () => {
  const { fetcher } = upstream({ downloadUrl: "http://internal.example/secret" });
  const result = await handleBridgeRequest(request("/v1/printables/3161/files/25/download"), { fetcher });
  assert.equal(result.status, 502);
  assert.equal(JSON.stringify(await result.json()).includes("internal.example"), false);
});

test("disallows browser requests from other origins or missing origins", async () => {
  const { calls, fetcher } = upstream();
  for (const origin of ["https://evil.example", null]) {
    const result = await handleBridgeRequest(request("/v1/printables/3161/files", "GET", origin), { fetcher });
    assert.equal(result.status, 403);
  }
  assert.equal(calls.length, 0);
});

test("does not act as a generic URL proxy and only supports public GET", async () => {
  const { fetcher } = upstream();
  assert.equal((await handleBridgeRequest(request("/?url=http://internal"), { fetcher })).status, 400);
  assert.equal((await handleBridgeRequest(request("/v1/printables/3161/files?query=evil"), { fetcher })).status, 400);
  assert.equal((await handleBridgeRequest(request("/v1/printables/3161/files", "POST"), { fetcher })).status, 405);
  assert.equal((await handleBridgeRequest(request("/v1/thingiverse/3161/files"), { fetcher })).status, 404);
  assert.equal((await handleBridgeRequest(request("/v1/printables/x/files"), { fetcher })).status, 404);
  const preflight = await handleBridgeRequest(request("/v1/printables/3161/files", "OPTIONS"), { fetcher });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
});

test("rate limit binding and provider throttle do not expose upstream errors", async () => {
  const limit = { limit: async () => ({ success: false }) };
  const res = await handleBridgeRequest(request("/v1/printables/3161/files"), { rateLimiter: limit });
  assert.equal(res.status, 429);
  const up = await handleBridgeRequest(request("/v1/printables/3161/files"), {
    fetcher: async () => new Response("Too many", { status: 429 }),
  });
  assert.equal(up.status, 429);
});

test("bounds upstream JSON size even when content-length is missing", async () => {
  const body = JSON.stringify({ data: { print: { name: "x".repeat(200000), stls: [] } } });
  const res = await handleBridgeRequest(request("/v1/printables/3161/files"), {
    fetcher: async () => new Response(body, { headers: { "Content-Type": "application/json" } }),
  });
  assert.equal(res.status, 502);
});
