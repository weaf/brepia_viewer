import type { ParsedOff } from "@/utils/offParser";
import { connectedClosedShells } from "@/utils/orcaSplitSafeThreeMf";
import { excludeScadSourceCall, maskScadNonCode } from "./sourceMoveProvenance";
import {
  writeSourceMoveTranslation, type SourceMoveCandidate, type SourceMoveVector,
} from "./sourceMoveWriteback";

const ROUND=100;

/**
 * Strictly allow only a single module call that is the entire body of a
 * TOP-LEVEL, braced, simple if(identifier) statement. This excludes
 * nested CSG/boolean operations, functions, module definitions and loops.
 * A transform on an independent top-level call cannot mutate another call.
 */
export function isIndependentTopLevelCall(source: string, candidate: SourceMoveCandidate): boolean {
  if (candidate.instanceIndex!==undefined || candidate.call.loopVariable) return false;
  const clean=maskScadNonCode(source);
  const {call}=candidate;
  if (call.start<0 || call.start+call.callText.length>clean.length) return false;
  const braces: number[]=[];
  for(let i=0;i<call.start;i+=1) {
    if(clean[i]==="{") braces.push(i);
    else if(clean[i]==="}") {
      if(!braces.length) return false;
      braces.pop();
    }
  }
  if(braces.length!==1) return false;
  const open=braces[0];
  const leading=clean.slice(0,open).trimEnd();
  const match=/\bif\s*\(\s*[A-Za-z_]\w*\s*\)$/.exec(leading);
  if(!match) return false;
  const preceding=leading.slice(0,match.index).trimEnd();
  if(preceding && !/[;}]/.test(preceding[preceding.length-1])) return false;
  let close=-1,depth=0;
  for(let i=open;i<clean.length;i+=1) {
    if(clean[i]==="{") depth+=1;
    else if(clean[i]==="}" && --depth===0) {close=i;break;}
  }
  if(close<0) return false;
  if(clean.slice(open+1,call.start).trim()!=="") return false;
  if(clean.slice(call.start+call.callText.length,close).trim()!==";") return false;
  return true;
}

function faceCounts(off: ParsedOff, indices: readonly number[], delta: SourceMoveVector): Map<string,number> {
  const out=new Map<string,number>();
  for(const index of indices) {
    const face=off.faces[index];
    if(!face || face.vertices.length!==3) return new Map();
    const key=face.vertices.map(vertexIndex => {
      const xyz=off.vertices[vertexIndex];
      if(!xyz || xyz.some(v=>!Number.isFinite(v))) return "?";
      return xyz.map((coordinate,axis)=>Math.round((coordinate+delta[axis])*ROUND)).join(",");
    }).sort().join("|");
    out.set(key,(out.get(key)??0)+1);
  }
  return out;
}
function identical(left: Map<string,number>, right: Map<string,number>): boolean {
  return left.size===right.size && [...left].every(([key,count])=>right.get(key)===count);
}
const zero: SourceMoveVector=[0,0,0];

function singleExactMovedShell(
  baseline: ParsedOff, moved: ParsedOff, targetPart: number, delta: SourceMoveVector,
): boolean {
  const before=connectedClosedShells(baseline);
  const after=connectedClosedShells(moved);
  if(before.length!==after.length || !before[targetPart]) return false;
  const expected=faceCounts(baseline,before[targetPart].faceIndices,delta);
  if(!expected.size) return false;
  let matches=0;
  for(const shell of after) {
    if(shell.faceIndices.length!==before[targetPart].faceIndices.length) continue;
    if(identical(expected,faceCounts(moved,shell.faceIndices,zero))) matches+=1;
  }
  return matches===1;
}


/** In-scene retessellation is permitted only if exactly one resulting shell
 * occupies the translated original shell bounds, within OFF serialization
 * precision. Bounds alone never prove the shape; isolated OFF comparison does.
 */
function singleLocatedMovedShell(
  baseline: ParsedOff, moved: ParsedOff, targetPart: number, delta: SourceMoveVector,
): boolean {
  const before=connectedClosedShells(baseline);
  const after=connectedClosedShells(moved);
  if(before.length!==after.length || !before[targetPart]) return false;
  const bounds=(off:ParsedOff, indices:readonly number[]):number[]=>{
    const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
    for(const index of indices) {
      for(const vi of off.faces[index].vertices) {
        const v=off.vertices[vi];
        if(!v || v.some(n=>!Number.isFinite(n))) return [];
        for(let axis=0;axis<3;axis++) {
          min[axis]=Math.min(min[axis],v[axis]);
          max[axis]=Math.max(max[axis],v[axis]);
        }
      }
    }
    return [...min,...max];
  };
  const selected=bounds(baseline,before[targetPart].faceIndices);
  if(selected.length!==6) return false;
  const target=selected.map((n,i)=>n+delta[i%3]);
  let matches=0;
  for(const shell of after) {
    const actual=bounds(moved,shell.faceIndices);
    if(actual.length===6 && actual.every((value,i)=>Math.abs(value-target[i])<=0.022)) matches++;
  }
  return matches===1;
}

/**
 * Extra source-structural + geometric proof used only when a complete
 * in-scene face comparison fails due to global retessellation.
 *
 * 1. Source edit MUST be exactly one generated translate() on a standalone
 *    top-level module call previously identified by exclusion.
 * 2. The moved part must be uniquely located at the translated bounds,
 *    with the same shell count as the baseline. Either its moved triangles
 *    match exactly, or a reverse transform around the exact generated call
 *    must reconstruct every ORIGINAL triangle in the full scene.
 * 3. The rest of the model MUST compile to exactly identical OFF triangles
 *    after disabling that call both before and after the source edit.
 *
 * This checks ALL triangles of the independently rendered unaffected parts.
 * Nested CSG, loop bodies, multiple part matches or errors fail closed.
 */
export async function verifyIndependentSourceMove({
  source, modified, candidate, baseline, moved, targetPart, delta, compile, onFailure,
}:{
  source: string;
  modified: string;
  candidate: SourceMoveCandidate;
  baseline: ParsedOff;
  moved: ParsedOff;
  targetPart: number;
  delta: SourceMoveVector;
  compile: (source: string)=>Promise<ParsedOff>;
  onFailure?: (reason: string)=>void;
}):Promise<boolean>{
  const reject=(reason:string)=>{onFailure?.(reason);return false;};
  if(!isIndependentTopLevelCall(source,candidate)) return reject("call-not-independent");
  if(delta.some(value=>!Number.isFinite(value))) return reject("non-finite-delta");
  if(writeSourceMoveTranslation(source,candidate,delta)!==modified) return reject("source-diff-unexpected");
  if(!singleExactMovedShell(baseline,moved,targetPart,delta)) {
    // A source-authored translate is analytically reversible for an
    // independent top-level call. Render the WHOLE scene with an inverse
    // transform around exactly that generated wrapper. If the complete
    // original mesh returns, the edit has only moved the selected geometry,
    // even when the moved scene itself is retessellated by Manifold.
    if(!singleLocatedMovedShell(baseline,moved,targetPart,delta)) return reject("moved-shell-bounds-mismatch");
    const inverse="translate(["+delta.map(v=>String(-v)).join(", ")+"]) ";
    const reversedSource=modified.slice(0,candidate.call.start)+inverse+
      modified.slice(candidate.call.start);
    const restored=await compile(reversedSource);
    if(restored.faces.length!==baseline.faces.length ||
       connectedClosedShells(restored).length!==connectedClosedShells(baseline).length)
      return reject("round-trip-scene-count-mismatch");
    const beforeFaces=faceCounts(baseline,baseline.faces.map((_,i)=>i),zero);
    const roundTripFaces=faceCounts(restored,restored.faces.map((_,i)=>i),zero);
    if(beforeFaces.size===0 || !identical(beforeFaces,roundTripFaces))
      return reject("round-trip-scene-geometry-mismatch");
  }
  const excludedBefore=excludeScadSourceCall(source,candidate.call);
  // Guard the SAME generated translate wrapper; no other statement changes.
  const excludedAfter=modified.slice(0,candidate.call.start)+"if (false) "+
    modified.slice(candidate.call.start);
  // The OpenSCAD WASM worker is single-threaded. Do not overlap two project
  // previews or let their temporary file contexts interfere.
  const remainingBefore=await compile(excludedBefore);
  const remainingAfter=await compile(excludedAfter);
  if(remainingBefore.faces.length===0 ||
     remainingBefore.faces.length!==remainingAfter.faces.length ||
     connectedClosedShells(remainingBefore).length!==connectedClosedShells(remainingAfter).length) return reject("unaffected-shell-count-mismatch");
  const beforeAll=faceCounts(remainingBefore,remainingBefore.faces.map((_,i)=>i),zero);
  const afterAll=faceCounts(remainingAfter,remainingAfter.faces.map((_,i)=>i),zero);
  if(beforeAll.size===0 || !identical(beforeAll,afterAll)) return reject("unaffected-geometry-mismatch");
  return true;
}
