import { C_CHAIN_SOURCE } from "./cSource";

export const CHAIN_SCHEMA = "brepia-chain/v1" as const;
export const SHAPES = ["Cube", "Cylinder", "Sphere", "Pyramid"] as const;
export const DECORATIONS = ["None", "Letter", "Snake Head", "Shark Head", "Dragon Head", "Octopus Head"] as const;
export const FITS = ["Firm", "Loose", "Very Loose"] as const;
export const PORTS = ["none", "male", "female"] as const;
export const FACES = ["front", "back", "left", "right", "top"] as const;
export const LETTERS = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ");
export type Shape = (typeof SHAPES)[number];
export type Decoration = (typeof DECORATIONS)[number];
export type Fit = (typeof FITS)[number];
export type Port = (typeof PORTS)[number];
export type Face = (typeof FACES)[number];
export type ChainLayout = "assembly" | "print" | "single";
export type ChainSegment = {
  shape: Shape;
  decoration: Decoration;
  letter: string;
  decorationPosition: "Top" | "Front";
  decorationScale: number;
  decorationHeight: number;
  fit: Fit;
  connections: Record<Face, Port>;
};
export type ChainConfig = {
  schema: typeof CHAIN_SCHEMA;
  count: number;
  defaults: ChainSegment;
  overrides: Record<string, Partial<Omit<ChainSegment, "connections">> & {connections?: Partial<Record<Face, Port>>}>;
};
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const member = <T extends readonly string[]>(values: T, value: unknown): value is T[number] =>
  typeof value === "string" && values.includes(value);
const q = (text: string) => JSON.stringify(text);
const inRange = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export function initialSegment(): ChainSegment {
  return {
    shape: "Cube", decoration: "None", letter: "A", decorationPosition: "Top",
    decorationScale: 1, decorationHeight: 1.1, fit: "Loose",
    connections: { front: "male", back: "female", left: "none", right: "none", top: "none" },
  };
}
export function createChain(count = 5): ChainConfig {
  return { schema: CHAIN_SCHEMA, count, defaults: initialSegment(), overrides: {} };
}
export function segmentAt(config: ChainConfig, index: number): ChainSegment {
  if (!Number.isInteger(index) || index < 0 || index >= config.count) throw new Error("Segment index is out of range.");
  const override = config.overrides[String(index)] ?? {};
  return { ...config.defaults, ...override, connections: { ...config.defaults.connections, ...override.connections } };
}
export function updateSegment(config: ChainConfig, index: number, patch: Partial<ChainSegment>): ChainConfig {
  const current = segmentAt(config, index);
  const next = { ...current, ...patch, connections: {...current.connections, ...patch.connections} };
  const overrides = { ...config.overrides, [index]: next };
  return validateChain({ ...config, overrides });
}
export function resetSegment(config: ChainConfig, index: number): ChainConfig {
  segmentAt(config, index);
  const overrides = { ...config.overrides };
  delete overrides[String(index)];
  return { ...config, overrides };
}
export function resizeChain(config: ChainConfig, count: number): ChainConfig {
  if (!Number.isInteger(count) || count < 1 || count > 150) throw new Error("Segment count must be 1–150.");
  return { ...config, count, overrides: Object.fromEntries(Object.entries(config.overrides).filter(([key]) => Number(key) < count)) };
}
function parseSegment(input: unknown, partial: boolean): Partial<ChainSegment> {
  if (!isObject(input)) throw new Error("Segment settings must be an object.");
  const keys = ["shape", "decoration", "letter", "decorationPosition", "decorationScale", "decorationHeight", "fit", "connections"];
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error("Unknown segment setting.");
  if (!partial && keys.some(key => !own(input, key))) throw new Error("Incomplete default segment.");
  const result: Partial<ChainSegment> = {};
  if (own(input, "shape")) { if (!member(SHAPES, input.shape)) throw new Error("Invalid body shape."); result.shape = input.shape; }
  if (own(input, "decoration")) { if (!member(DECORATIONS, input.decoration)) throw new Error("Invalid decoration."); result.decoration = input.decoration; }
  if (own(input, "letter")) { if (!member(LETTERS, input.letter)) throw new Error("Expected Swedish uppercase letter."); result.letter = input.letter as string; }
  if (own(input, "decorationPosition")) { if (!member(["Top", "Front"] as const, input.decorationPosition)) throw new Error("Invalid decoration position."); result.decorationPosition = input.decorationPosition; }
  if (own(input, "decorationScale")) { if (!inRange(input.decorationScale, 0.5, 2)) throw new Error("Decoration scale must be 0.5–2."); result.decorationScale = input.decorationScale as number; }
  if (own(input, "decorationHeight")) { if (!inRange(input.decorationHeight, 0.5, 6)) throw new Error("Decoration height must be 0.5–6 mm."); result.decorationHeight = input.decorationHeight as number; }
  if (own(input, "fit")) { if (!member(FITS, input.fit)) throw new Error("Invalid joint fit."); result.fit = input.fit; }
  if (own(input, "connections")) {
    if (!isObject(input.connections)) throw new Error("Connections must be an object.");
    const ports: Partial<Record<Face, Port>> = {};
    for (const [key, value] of Object.entries(input.connections)) {
      if (!member(FACES, key) || !member(PORTS, value)) throw new Error("Invalid connection face or type.");
      ports[key] = value;
    }
    if (!partial && FACES.some(key => !own(ports, key))) throw new Error("Incomplete default connections.");
    result.connections = ports as ChainSegment["connections"];
  }
  return result;
}
export function validateChain(value: unknown): ChainConfig {
  if (!isObject(value) || value.schema !== CHAIN_SCHEMA) throw new Error("Not a Brepia chain JSON v1 file.");
  if (!Number.isInteger(value.count) || !inRange(value.count, 1, 150)) throw new Error("Segment count must be 1–150.");
  if (!isObject(value.overrides)) throw new Error("Invalid segment overrides.");
  if (Object.keys(value.overrides).length > 150) throw new Error("Too many overrides.");
  const count = value.count as number;
  const defaults = parseSegment(value.defaults, false) as ChainSegment;
  const overrides: ChainConfig["overrides"] = Object.create(null);
  for (const [key, raw] of Object.entries(value.overrides)) {
    if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= count) throw new Error("Invalid segment number.");
    overrides[key] = parseSegment(raw, true);
  }
  return { schema: CHAIN_SCHEMA, count, defaults, overrides };
}
export function parseChainJson(input: string): ChainConfig {
  if (new TextEncoder().encode(input).byteLength > 1024 * 1024) throw new Error("Chain JSON exceeds 1 MB.");
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error("Invalid JSON file."); }
  return validateChain(value);
}
export function serializeChainJson(config: ChainConfig): string {
  return JSON.stringify(validateChain(config), null, 2) + "\n";
}
export function chainWarnings(config: ChainConfig): string[] {
  const issues: string[] = [];
  const links = Array.from({ length: config.count }, (_, i) => segmentAt(config, i));
  links.forEach((part, i) => {
    const number = i + 1;
    if (part.decoration !== "None" && part.connections[part.decorationPosition === "Top" ? "top" : "front"] !== "none")
      issues.push(`Segment ${number}: decoration overlaps its ${part.decorationPosition.toLowerCase()} connection.`);
    if (part.decoration !== "None" && part.decorationPosition === "Front" && i < links.length - 1)
      issues.push(`Segment ${number}: front decoration may collide with the next link; prefer Top.`);
    if (i + 1 < links.length) {
      const next = links[i+1];
      if (part.connections.front === "none" || next.connections.back === "none")
        issues.push(`Segments ${number}–${number+1}: disconnected front/back ports.`);
      else if (part.connections.front === next.connections.back)
        issues.push(`Segments ${number}–${number+1}: both ports are ${part.connections.front}; choose male/female.`);
    }
  });
  return issues;
}
const array = <T>(values: T[], encode: (value: T) => string): string => "[" + values.map(encode).join(",") + "]";
const ports = (part: ChainSegment) => array([part.connections.left, part.connections.front, part.connections.right, part.connections.back, part.connections.top], q);
const scadArray = (parts: ChainSegment[], select: (p: ChainSegment) => string | number) =>
  array(parts.map(select), v => typeof v === "string" ? q(v) : String(v));
export function generateCaChainScad(config: ChainConfig, sourceTemplate = C_CHAIN_SOURCE, layout: ChainLayout = "assembly", selected = 0): string {
  const safe = validateChain(config);
  if (!["assembly", "print", "single"].includes(layout)) throw new Error("Unsupported chain layout.");
  if (!Number.isInteger(selected) || selected < 0 || selected >= safe.count) throw new Error("Selected segment out of bounds.");
  const problems = chainWarnings(safe);
  if (problems.length) throw new Error(problems[0]);
  const parts = Array.from({length: safe.count}, (_, i) => segmentAt(safe, i));
  const source = sourceTemplate.replace(/\/\/ Top-level preview dispatcher:[\s\S]*$/, "").trimEnd();
  return `// Generated by Brepia Viewer chain generator, ${CHAIN_SCHEMA}
// Original C connector design by Notydesign, CC BY-NC-SA 4.0.
// Configuration stored separately as Brepia chain JSON; this SCAD is self-contained.
// Export mode: ${layout}, selected segment: ${selected + 1}
${source}

chain_shapes=${scadArray(parts,p=>p.shape)};
chain_decos=${scadArray(parts,p=>p.decoration)};
chain_letters=${scadArray(parts,p=>p.letter)};
chain_positions=${scadArray(parts,p=>p.decorationPosition)};
chain_scales=${scadArray(parts,p=>p.decorationScale)};
chain_heights=${scadArray(parts,p=>p.decorationHeight)};
chain_fits=${scadArray(parts,p=>p.fit)};
chain_ports=${array(parts, ports)};
chain_count=${safe.count};
chain_layout=${q(layout)};
chain_selected=${selected};
chain_pitch=2*joint_offset;
chain_print_pitch=39;

// Rounded head without any pre-modelled arms. The link itself is the body.
// Future tentacles can be attached through available link connection ports.
module chain_octopus_head() {
  scale([1.05,1,0.95]) sphere(r=3);
  for (s=[-1,1]) translate([2.2,s*1.5,0.4]) sphere(r=0.52);
}

module chain_decoration(i) {
  kind=chain_decos[i];
  pos=chain_positions[i];
  scl=chain_scales[i];
  height=chain_heights[i];
  shape=chain_shapes[i];
  if(kind!="None") {
    if(pos=="Top") {
      decoration_badge(shape,"Top");
      if(kind=="Letter")
        translate([0,0,roof_z(shape)+0.12])
          linear_extrude(height=height)
            scale([scl,scl]) text(chain_letters[i],size=4.7,font="DejaVu Sans:style=Bold",halign="center",valign="center");
      else
        translate([0,0,roof_z(shape)+height*0.18])
          scale([scl,scl,scl*height/1.1])
            if(kind=="Octopus Head") chain_octopus_head(); else animal_head(kind);
    } else {
      front_deco_land();
      decoration_badge(shape,"Front");
      if(kind=="Letter")
        translate([body_length/2+0.42,0,body_height/2])
          rotate([90,0,90])
            linear_extrude(height=height)
              scale([scl*0.7,scl*0.7]) text(chain_letters[i],size=4.7,font="DejaVu Sans:style=Bold",halign="center",valign="center");
      else
        translate([body_length/2-0.9,0,body_height/2])
          scale([scl,scl,scl*height/1.1])
            if(kind=="Octopus Head") chain_octopus_head(); else animal_head(kind);
    }
  }
}
module chain_link(i) {
  shape=chain_shapes[i];
  p=chain_ports[i];
  fit=chain_fits[i];
  union() {
    body_by_shape(shape);
    if(shape!="Cube") for(side=[0:3]) if(p[side]!="none") profile_land(side);
    for(side=[0:3]) if(p[side]!="none") placed_port(side,p[side],fit);
    if(p[4]!="none") placed_top(p[4],fit);
    chain_decoration(i);
  }
}
if(chain_layout=="single") {
  chain_link(chain_selected);
} else if(chain_layout=="print") {
  for(i=[0:chain_count-1])
    translate([(i%5)*chain_print_pitch,floor(i/5)*chain_print_pitch,0]) chain_link(i);
} else {
  for(i=[0:chain_count-1])
    translate([i*chain_pitch,0,0]) chain_link(i);
}
`;
}
