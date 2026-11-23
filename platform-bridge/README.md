# Printables metadata bridge (optional, not deployed)

This is a **fixed-endpoint Cloudflare Worker** for the experimental model-platform import in Brepia Viewer. It is not a URL proxy or a downloader. It never handles user accounts, cookies, API tokens or the STL/3MF bytes.

## What it does

The Viewer may call only two public GET routes (numbers are Printables model IDs):

- `GET /v1/printables/3161/files`: list public STL/3MF entries for a model.
- `GET /v1/printables/3161/files/12345/download`: verify the file belongs to that public model and request Printables' own public download link. The browser downloads from Printables directly.

The Worker sends **hardcoded** read-only GraphQL operations and a fixed download-link operation to `https://api.printables.com/graphql/`. No user-provided upstream URL is accepted. It limits upstream response sizes, filters models to the Viewer's existing 16 MiB asset cap, validates output file hosts, and refuses unrecognized request origins. It requires no provider credentials.

**Important:** The upstream Printables GraphQL service is not an officially supported integration API. Its schema, download permissions or use policy can change. The public file link can expire and may require that the end user's browser permits cross-origin download. A proxy cannot bypass those conditions. If that happens, Viewer should show the original Printables page for manual download.

## Validate without deploying

```bash
node --test platform-bridge/worker.nodecheck.mjs
npm run check
```

The PR's static browser smoke uses `https://bridge.example.test` as a *mocked* Worker endpoint and verifies the end-to-end URL → file list → selected file → rendered mesh. It is **not** evidence of access to a real Cloudflare or Printables endpoint. A separate live browser probe previously recorded `Failed to fetch` when accessing Printables directly.

## Deployment gate (requires explicit owner approval)

1. Inspect `platform-bridge/worker.mjs` and the tests. Confirm Printables' current API use is permitted for the intended deployment and that no protected content is requested.
2. Provision a test Worker in the owner's Cloudflare account, outside the Viewer production route. Copy `wrangler.example.jsonc` to `wrangler.jsonc`, choose a unique rate-limit namespace ID and a **test-only** route. Review spending limits and WAF rules. The example deliberately has `workers_dev: false` and **no route**, so it is not an exposed service by default. Configure and deploy only with owner permission.
3. Verify the Worker's CORS response to the intended Viewer Origin, valid and invalid model IDs, 429 handling and real public file enumeration. Do not introduce generic URL forwarding, cookies, credentials or scraping.
4. Set `VITE_PRINTABLES_BRIDGE_ORIGIN=https://YOUR-APPROVED-API-ORIGIN` **at Viewer build time**, rebuild the static Viewer, and test an actual model and file download in desktop and Android browsers. The Viewer never uses the Worker unless this variable is explicitly set.
5. Only after PASS: authorize main integration and Pages deployment. Roll back by removing the build variable and redeploying the previous static Viewer. Worker can then be disabled independently.

`ALLOWED_ORIGINS` configures which **browser Origin** headers receive CORS responses. This is not authentication; non-browser clients can spoof an Origin. Retain the fixed routes, a Cloudflare rate-limit binding and any operational abuse controls. The Worker is deliberately not a general CORS bypass. It should not relay binary model files.
