import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadFile } from "@/utils/downloadUtils";
import {
  createChain, segmentAt, resetSegment, resizeChain, updateSegment,
  parseChainJson, serializeChainJson, generateCaChainScad, chainWarnings,
  SHAPES, DECORATIONS, FITS, FACES, PORTS, LETTERS,
  type ChainConfig, type ChainSegment, type ChainLayout, type Face, type Port,
} from "@/lib/chainGenerator/chainGenerator";

type Props = {
  onClose: () => void;
  onOpenPreview: (source: string) => Promise<void>;
};
const selectStyle = "h-11 min-w-0 w-full rounded-md border border-adam-neutral-600 bg-adam-neutral-900 px-2 text-sm text-adam-text-primary";
const fieldStyle = "flex min-w-0 flex-col gap-1 text-xs text-adam-neutral-300";
function Choose<T extends string>({label, value, values, onChange}: {
  label: string; value: T; values: readonly T[]; onChange: (value: T) => void;
}) {
  return <label className={fieldStyle}><span>{label}</span><select className={selectStyle} value={value} onChange={event => onChange(event.currentTarget.value as T)}>
    {values.map(v => <option key={v} value={v}>{v}</option>)}
  </select></label>;
}
export function ChainGeneratorPanel({onClose, onOpenPreview}: Props) {
  const [config, setConfig] = useState<ChainConfig>(() => createChain(5));
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<ChainLayout>("assembly");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = segmentAt(config, index);
  const warnings = chainWarnings(config);
  const change = (patch: Partial<ChainSegment>) => {
    try { setConfig(current => updateSegment(current, index, patch)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid segment."); }
  };
  const download = (format: "json" | "scad") => {
    try {
      const source = format === "json" ? serializeChainJson(config) : generateCaChainScad(config, undefined, layout, index);
      downloadFile({filename: "brepia-chain." + format, content: source, mimeType: format === "json" ? "application/json" : "text/plain"});
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Export failed."); }
  };
  const importJson = async (file: File) => {
    try {
      if (file.size > 1024*1024) throw new Error("Chain JSON exceeds 1 MB.");
      const parsed = parseChainJson(await file.text());
      setConfig(parsed); setIndex(0); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import chain JSON."); }
  };
  const preview = async () => {
    try {
      setBusy(true);
      setError("");
      await onOpenPreview(generateCaChainScad(config, undefined, layout, index));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Preview failed."); }
    finally { setBusy(false); }
  };
  return <section data-testid="chain-generator" aria-label="Chain generator" className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-adam-neutral-700 bg-adam-bg-secondary-dark text-adam-text-primary">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-adam-neutral-700 px-4 py-3">
      <div><h2 className="text-base font-semibold">Parametric chain generator</h2><p className="text-xs text-adam-neutral-400">Experimental · C snap-fit joints · client-side OpenSCAD</p></div>
      <Button type="button" variant="outline" className="h-11 shrink-0" onClick={onClose}>Close</Button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        <div className="min-w-0 space-y-4">
          <label className={fieldStyle}><span>Number of segments (1–150)</span>
            <Input type="number" min={1} max={150} step={1} className="h-11" value={config.count} onChange={event => {
              const count = Number(event.currentTarget.value);
              if (!Number.isInteger(count) || count < 1 || count > 150) return;
              setConfig(previous => resizeChain(previous,count));
              setIndex(old => Math.min(old,count-1));
            }}/>
          </label>
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Segments</h3>
              <span className="text-xs text-adam-neutral-400">Selected {index+1} / {config.count}</span>
            </div>
            <div className="grid max-h-44 grid-cols-6 gap-1 overflow-y-auto rounded-lg border border-adam-neutral-700 p-2 sm:grid-cols-10" role="group" aria-label="Choose segment">
              {Array.from({length: config.count}, (_, i) => <button key={i} type="button" onClick={() => setIndex(i)}
                aria-pressed={index===i}
                className={`h-10 rounded border text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue ${index===i ? "border-adam-blue bg-adam-blue/25 text-white" : config.overrides[i] ? "border-amber-500/50 bg-amber-500/10" : "border-adam-neutral-700 hover:bg-adam-neutral-800"}`}>
                {i+1}
              </button>)}
            </div>
            <p className="mt-1 text-xs text-adam-neutral-400">Amber segments contain individual changes.</p>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <label className={fieldStyle}><span>Jump to segment</span><Input type="number" min={1} max={config.count} value={index+1} className="h-11" onChange={e=>{
              const number = Number(e.currentTarget.value); if (Number.isInteger(number) && number>=1 && number<=config.count) setIndex(number-1);
            }}/></label>
            <Button type="button" variant="outline" className="h-11" onClick={() => setConfig(current => resetSegment(current,index))}>Reset segment</Button>
          </div>
          <h3 className="text-sm font-semibold">Segment {index+1} settings</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Choose label="Body Shape" value={selected.shape} values={SHAPES} onChange={shape => change({shape})}/>
            <Choose label="Decoration" value={selected.decoration} values={DECORATIONS} onChange={decoration => change({decoration})}/>
            <Choose label="Decoration position" value={selected.decorationPosition} values={["Top","Front"] as const} onChange={decorationPosition => change({decorationPosition})}/>
            {selected.decoration === "Letter" && <Choose label="Letter" value={selected.letter} values={LETTERS} onChange={letter => change({letter})}/>}
            {selected.decoration !== "None" && <>
              <label className={fieldStyle}><span>Decoration scale (0.5–2)</span><Input type="number" min={0.5} max={2} step={0.1} value={selected.decorationScale} className="h-11" onChange={e=>{const v=Number(e.currentTarget.value);if(v>=0.5&&v<=2)change({decorationScale:v});}}/></label>
              <label className={fieldStyle}><span>Decoration height (0.5–6 mm)</span><Input type="number" min={0.5} max={6} step={0.1} value={selected.decorationHeight} className="h-11" onChange={e=>{const v=Number(e.currentTarget.value);if(v>=0.5&&v<=6)change({decorationHeight:v});}}/></label>
            </>}
            <Choose label="Joint Fit" value={selected.fit} values={FITS} onChange={fit=>change({fit})}/>
          </div>
          <h3 className="text-sm font-semibold">Connections</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {FACES.map(face => <Choose key={face} label={face[0].toUpperCase()+face.slice(1)} value={selected.connections[face]} values={PORTS}
              onChange={(value: Port) => change({connections: {...selected.connections,[face]:value} as Record<Face,Port>})}/>)}
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <div className="rounded-lg border border-adam-neutral-700 p-3">
            <h3 className="mb-3 text-sm font-semibold">Preview & layout</h3>
            <Choose label="Layout" value={layout} values={["assembly","print","single"] as const} onChange={setLayout}/>
            <p className="mt-2 text-xs leading-relaxed text-adam-neutral-400">
              Assembly aligns the snap-fit joints. Print separates links on the build plate. Single previews the selected link.
              The 3D preview opens in the existing Viewer editor.
            </p>
            <Button className="mt-3 h-11 w-full" type="button" disabled={busy || warnings.length>0} onClick={()=>void preview()}>
              {busy ? "Opening…" : "Open 3D preview in Viewer"}
            </Button>
          </div>
          <div className="rounded-lg border border-adam-neutral-700 p-3">
            <h3 className="text-sm font-semibold">Geometry checks</h3>
            {warnings.length ? <div role="alert" className="mt-2 max-h-48 overflow-auto text-xs text-amber-300">
              {warnings.slice(0,30).map((warning,i)=><p className="mb-1" key={i}>{warning}</p>)}
              {warnings.length>30 && <p>…and {warnings.length-30} more conflicts.</p>}
            </div> : <p className="mt-2 text-xs text-adam-neutral-300">No port or decoration conflicts detected. Physical snap-fit tolerances are not verified.</p>}
          </div>
          <div className="rounded-lg border border-adam-neutral-700 p-3">
            <h3 className="text-sm font-semibold">Save or open chain</h3>
            <p className="my-2 text-xs text-adam-neutral-400">Chain JSON has its own versioned schema; OpenSCAD desktop presets remain separate.</p>
            <input ref={fileRef} type="file" className="hidden" accept=".json,application/json" aria-label="Open chain JSON" onChange={event=>{
              const file=event.currentTarget.files?.[0];event.currentTarget.value="";if(file)void importJson(file);
            }}/>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-11" onClick={()=>fileRef.current?.click()}>Open JSON</Button>
              <Button type="button" variant="outline" className="h-11" onClick={()=>download("json")}>Save JSON</Button>
              <Button type="button" variant="outline" className="h-11" disabled={warnings.length>0} onClick={()=>download("scad")}>Export SCAD</Button>
            </div>
          </div>
          {error && <div role="alert" className="rounded-lg border border-red-500/40 p-3 text-sm text-red-300">{error}</div>}
        </div>
      </div>
    </div>
  </section>;
}
