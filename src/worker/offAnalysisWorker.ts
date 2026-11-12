import { parseColoredOff } from '../utils/offParser';
import { inspectParsedColoredOff } from '../utils/offColorInspector';
import { extractFeatureEdgeTopology } from '../lib/featureEdgeTopology';

// Send structured-cloneable data only. Three.js objects remain on the UI thread.
// A dedicated worker per analysis is terminated when the source is superseded.
self.onmessage = (event: MessageEvent<{ text: string }>) => {
  try {
    const parsed = parseColoredOff(event.data.text);
    const inspection = inspectParsedColoredOff(parsed);
    const edges = parsed.faces.length <= 40_000
      ? extractFeatureEdgeTopology(parsed).edges
      : [];
    self.postMessage({ ok: true, parsed, inspection, edges });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
