import { describe, expect, it, vi } from "vitest";
import { fetchScadSourceFromUrl } from "./scadUrlImport";

const validSource = 'module example(size=10) { cube(size); }\nexample();';
const fakeFetch = (response: Response) =>
  vi.fn(async () => response) as unknown as typeof fetch;

describe("fetchScadSourceFromUrl", () => {
  it("loads and validates a direct HTTPS .scad file", async () => {
    const fetcher = fakeFetch(new Response(validSource, { status: 200 }));
    const { filename, bytes } = await fetchScadSourceFromUrl(
      "https://example.org/models/test.scad?raw=1",
      fetcher,
    );
    expect(filename).toBe("test.scad");
    expect(new TextDecoder().decode(bytes)).toBe(validSource);
    expect(fetcher).toHaveBeenCalledWith(
      "https://example.org/models/test.scad?raw=1",
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        mode: "cors",
      }),
    );
  });

  it.each([
    "http://example.org/test.scad",
    "file:///tmp/test.scad",
    "https://user:secret@example.org/test.scad",
    "https://example.org/test.zip",
    "https://example.org/test.scad:8443",
    "not a url",
  ])("rejects unsafe or unsupported URL: %s", async (url) => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(fetchScadSourceFromUrl(url, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a remote HTML error page masquerading as source", async () => {
    const response = new Response("<html><body>not source</body></html>", {
      headers: { "content-type": "text/html" },
    });
    await expect(fetchScadSourceFromUrl(
      "https://example.org/part.scad", fakeFetch(response),
    )).rejects.toThrow(/HTML/);
  });

  it("rejects oversized declared bodies before reading", async () => {
    const response = new Response(validSource, {
      headers: { "content-length": "999999" },
    });
    await expect(fetchScadSourceFromUrl(
      "https://example.org/part.scad", fakeFetch(response),
    )).rejects.toThrow(/exceeds/);
  });

  it("rejects oversized streaming bodies", async () => {
    const response = new Response("a".repeat(256001));
    await expect(fetchScadSourceFromUrl(
      "https://example.org/part.scad", fakeFetch(response),
    )).rejects.toThrow(/exceeds/);
  });

  it("reuses local dependency checking", async () => {
    const response = new Response('include <missing.scad>;\ncube(10);');
    await expect(fetchScadSourceFromUrl(
      "https://example.org/part.scad", fakeFetch(response),
    )).rejects.toThrow();
  });

  it("reports cross-origin/connection failure", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(fetchScadSourceFromUrl(
      "https://example.org/part.scad", fetcher,
    )).rejects.toThrow(/CORS/);
  });
});
