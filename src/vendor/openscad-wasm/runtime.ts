import generatedOpenScad from './openscad.js';
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
        return `${import.meta.env.BASE_URL}assets/openscad.wasm`;
      }
      return upstreamLocateFile?.(filename, prefix) ?? `${prefix}${filename}`;
    },
  });
}
