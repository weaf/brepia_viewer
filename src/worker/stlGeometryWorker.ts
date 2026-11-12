import {
  prepareStlGeometry,
  transferableStlGeometryBuffers,
} from '../utils/preparedStlGeometry';

// Separate worker per preview; the caller terminates obsolete tasks.
// Typed array backing buffers are transferred, never cloned.
self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer }>) => {
  try {
    const { prepared, timings } = prepareStlGeometry(event.data.buffer);
    self.postMessage(
      { ok: true, prepared, timings },
      transferableStlGeometryBuffers(prepared),
    );
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
