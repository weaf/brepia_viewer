import type { ParsedOff } from "@/utils/offParser";
import { connectedClosedShells } from "@/utils/orcaSplitSafeThreeMf";

type Delta = readonly [number, number, number];

const MAX_SHELL_FACES = 4500;
const MAX_SOURCE_CHARS = 350000;
const MAX_COORDINATE = 100000;
const BOUNDS_EPSILON = 0.022;

/**
 * Compare *solid volumes* with native OpenSCAD CSG rather than expecting
 * identical triangles from the Manifold tessellator.
 *
 * Only runs in the independent top-level call proof, after verifying that
 * precisely one closed shell moved by the requested offset.
 *
 * Each direction renders an OpenSCAD difference with an isolated distant
 * witness cube. That keeps STL+OFF available even for an EMPTY difference.
 * A successful proof must render JUST the witness cube in BOTH directions.
 * A loose bounding-box match is never enough for acceptance.
 */
export async function proveTranslatedShellsWithCsg(
  original: ParsedOff,
  moved: ParsedOff,
  partIndex: number,
  delta: Delta,
  compile: (source: string) => Promise<ParsedOff>,
  onFailure?: (reason: string) => void,
): Promise<boolean> {
  const reject = (reason: string) => {
    onFailure?.(reason);
    return false;
  };
  if (delta.some(v => !Number.isFinite(v) || Math.abs(v) > MAX_COORDINATE)) {
    return reject("csg-invalid-delta");
  }
  const beforeParts = connectedClosedShells(original);
  const afterParts = connectedClosedShells(moved);
  if (!beforeParts[partIndex] || beforeParts.length !== afterParts.length) {
    return reject("csg-part-count-changed:" + beforeParts.length + "->" + afterParts.length);
  }
  // Only the selected volume must be watertight. The rest of the scene may
  // contain pre-existing OFF seams; the independent writeback proof checks
  // the ENTIRE remainder exactly in separate before/after compilations.
  if (!beforeParts[partIndex].closed) {
    return reject("csg-selected-original-open:" + beforeParts[partIndex].openEdges);
  }
  const beforeIndices = beforeParts[partIndex].faceIndices;
  const beforeBounds = shellBounds(original, beforeIndices, delta);
  if (!beforeBounds) return reject("csg-unreadable-original");
  const candidates = afterParts.filter(shell => {
    const afterBounds = shellBounds(moved, shell.faceIndices, [0,0,0]);
    return afterBounds && afterBounds.every((v,i) =>
      Math.abs(v - beforeBounds[i]) <= BOUNDS_EPSILON);
  });
  if (candidates.length !== 1) return reject("csg-no-unique-moved-shell");
  const afterIndices = candidates[0].faceIndices;
  if (!candidates[0].closed) return reject("csg-selected-shell-open");
  const expected = polyhedronFromOff(original,beforeIndices,delta);
  const actual = polyhedronFromOff(moved,afterIndices,[0,0,0]);
  if (!expected || !actual) return reject("csg-shell-too-large-or-invalid");

  // A malformed or inward-facing polyhedron may silently render NOTHING.
  // Without this guard BOTH differences would appear empty and could
  // incorrectly approve a save. Each isolated input MUST be a real closed
  // solid with the correct bounds before their differences are computed.
  for (const [poly,reason] of [
    [expected,"csg-expected-solid-invalid"],
    [actual,"csg-actual-solid-invalid"],
  ] as const) {
    const standalone=await compile("!"+poly+"\n");
    const parts=connectedClosedShells(standalone);
    if (parts.length!==1 || !parts[0].closed ||
        standalone.faces.length===0) return reject(reason);
    const renderedBounds=shellBounds(standalone,parts[0].faceIndices,[0,0,0]);
    if (!renderedBounds ||
        renderedBounds.some((v,i)=>Math.abs(v-beforeBounds[i])>BOUNDS_EPSILON)) {
      return reject(reason+"-bounds");
    }
  }

  const witness: Delta = [
    Math.max(beforeBounds[3], beforeBounds[0]) + 100,
    Math.max(beforeBounds[4], beforeBounds[1]) + 100,
    Math.max(beforeBounds[5], beforeBounds[2]) + 100,
  ];
  if (witness.some(v => !Number.isFinite(v) || Math.abs(v) >= MAX_COORDINATE)) {
    return reject("csg-witness-out-of-range");
  }
  const witnessScad = "translate(["+witness.join(",")+"]) cube([1,1,1]);\n";
  for (const [first, second, name] of [
    [expected,actual,"csg-positive-difference"],
    [actual,expected,"csg-negative-difference"],
  ] as const) {
    const source = "!union() {\n"+witnessScad+
      "difference() {\n"+first+"\n"+second+"\n}\n}\n";
    if (source.length > MAX_SOURCE_CHARS) return reject("csg-difference-too-large");
    const result = await compile(source);
    if (!isWitnessOnly(result,witness)) {
      const shells=connectedClosedShells(result);
      const summary=shells.map(shell=>({
        faces:shell.faceIndices.length,
        closed:shell.closed,
        openEdges:shell.openEdges,
        bounds:shellBounds(result,shell.faceIndices,[0,0,0]),
      }));
      console.info("[Source Move] CSG proof residue", {
        gate:name,totalFaces:result.faces.length,totalVertices:result.vertices.length,
        expectedWitness:witness,shells:summary,
      });
      return reject(name);
    }
  }
  return true;
}

function shellBounds(off: ParsedOff, indices: readonly number[], delta: Delta): number[] | null {
  if (!indices.length) return null;
  const min = [Infinity,Infinity,Infinity];
  const max = [-Infinity,-Infinity,-Infinity];
  for (const index of indices) {
    const face=off.faces[index];
    if (!face || face.vertices.length!==3) return null;
    for (const vertexIndex of face.vertices) {
      const xyz=off.vertices[vertexIndex];
      if (!xyz || xyz.some(v=>!Number.isFinite(v))) return null;
      for (let axis=0;axis<3;axis+=1) {
        const value=xyz[axis]+delta[axis];
        min[axis]=Math.min(min[axis],value);
        max[axis]=Math.max(max[axis],value);
      }
    }
  }
  return [...min,...max];
}

function polyhedronFromOff(
  off: ParsedOff,
  indices: readonly number[],
  delta: Delta,
): string | null {
  if (!indices.length || indices.length > MAX_SHELL_FACES) return null;
  const mapping=new Map<number,number>();
  const points: number[][]=[];
  const faces: number[][]=[];
  for(const index of indices) {
    const face=off.faces[index];
    if(!face || face.vertices.length!==3) return null;
    const mapped: number[]=[];
    for(const vertexIndex of face.vertices) {
      let newIndex=mapping.get(vertexIndex);
      if(newIndex===undefined) {
        const xyz=off.vertices[vertexIndex];
        if(!xyz) return null;
        const vertex=xyz.map((v,axis)=>v+delta[axis]);
        if(vertex.some(v=>!Number.isFinite(v)||Math.abs(v)>MAX_COORDINATE)) return null;
        newIndex=points.length;
        points.push(vertex);
        mapping.set(vertexIndex,newIndex);
      }
      mapped.push(newIndex);
    }
    if(new Set(mapped).size!==3) return null;
    faces.push(mapped);
  }
  // OFF is a closed, consistently oriented triangle mesh from OpenSCAD.
  // Preserve its winding; do not silently reshape, voxelize or smooth.
  return "polyhedron(points="+JSON.stringify(points)+
    ",faces="+JSON.stringify(faces)+",convexity=10);";
}

function isWitnessOnly(result: ParsedOff, witness: Delta): boolean {
  if(result.faces.length!==12 || result.vertices.length<8) return false;
  const shells=connectedClosedShells(result);
  if(shells.length!==1 || !shells[0].closed) return false;
  const bounds=shellBounds(result,shells[0].faceIndices,[0,0,0]);
  if(!bounds) return false;
  const expected=[...witness,...witness.map(v=>v+1)];
  return bounds.every((v,i)=>Math.abs(v-expected[i])<=0.001);
}
