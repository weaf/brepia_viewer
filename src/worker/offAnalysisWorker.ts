import { parseColoredOff } from '../utils/offParser';
import { inspectParsedColoredOff } from '../utils/offColorInspector';
import { extractFeatureEdgeTopology } from '../lib/featureEdgeTopology';
import { prepareColoredOffMesh, transferableOffMeshBuffers } from '../utils/preparedOffMesh';

// Experimental OFF analysis stays isolated from main-thread Three.js objects.
// Old responses are still supported for worker regression tests and fallback.
self.onmessage = (event: MessageEvent<{ text: string; prepareBuffers?: boolean }>) => {
  try {
    const start = performance.now();
    const parsed = parseColoredOff(event.data.text);
    const parsedAt = performance.now();
    const inspection = inspectParsedColoredOff(parsed);
    const edges = parsed.faces.length <= 40_000
      ? extractFeatureEdgeTopology(parsed).edges
      : [];
    const inspectedAt = performance.now();

    if (event.data.prepareBuffers) {
      const prepared = prepareColoredOffMesh(parsed);
      const preparedAt = performance.now();
      self.postMessage(
        {
          ok: true,
          prepared,
          inspection,
          edges,
          timings: {
            parseMs: parsedAt - start,
            inspectionMs: inspectedAt - parsedAt,
            bufferMs: preparedAt - inspectedAt,
            totalMs: preparedAt - start,
          },
        },
        transferableOffMeshBuffers(prepared),
      );
      return;
    }

    self.postMessage({ ok: true, parsed, inspection, edges });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
