import generatedOpenScad from './openscad.js';
import openscadWasmUrl from './openscad.wasm?url';
import type { InitOptions, OpenSCAD } from './openscad.d.js';

/**
 * Keep the generated Emscripten module unchanged, but make the runtime WASM
 * location deterministic. The default resolver is relative to the generated
 * worker chunk, which is build-layout dependent.
 */
export default function openScadRuntime(
  options: InitOptions = { noInitialRun: true },
): Promise<OpenSCAD> {
  const upstreamLocateFile = options.locateFile;

  return generatedOpenScad({
    ...options,
    locateFile: (filename, prefix) => {
      if (filename === 'openscad.wasm' || filename.endsWith('/openscad.wasm')) {
        return openscadWasmUrl;
      }
      return upstreamLocateFile?.(filename, prefix) ?? `${prefix}${filename}`;
    },
  });
}
