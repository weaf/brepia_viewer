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

/**
 * Extra source-structural + geometric proof used only when a complete
 * in-scene face comparison fails due to global retessellation.
 *
 * 1. Source edit MUST be exactly one generated translate() on a standalone
 *    top-level module call previously identified by exclusion.
 * 2. The selected part MUST exist as exactly one identical translated shell
 *    in the entire newly compiled model, and the shell count cannot change.
 * 3. The rest of the model MUST compile to exactly identical OFF triangles
 *    after disabling that call both before and after the source edit.
 *
 * This checks ALL triangles of the independently rendered unaffected parts.
 * Nested CSG, loop bodies, multiple part matches or errors fail closed.
 */
export async function verifyIndependentSourceMove({
  source, modified, candidate, baseline, moved, targetPart, delta, compile,
}:{
  source: string;
  modified: string;
  candidate: SourceMoveCandidate;
  baseline: ParsedOff;
  moved: ParsedOff;
  targetPart: number;
  delta: SourceMoveVector;
  compile: (source: string)=>Promise<ParsedOff>;
}):Promise<boolean>{
  if(!isIndependentTopLevelCall(source,candidate)) return false;
  if(delta.some(value=>!Number.isFinite(value))) return false;
  if(writeSourceMoveTranslation(source,candidate,delta)!==modified) return false;
  if(!singleExactMovedShell(baseline,moved,targetPart,delta)) return false;
  const excludedBefore=excludeScadSourceCall(source,candidate.call);
  // Guard the SAME generated translate wrapper; no other statement changes.
  const excludedAfter=modified.slice(0,candidate.call.start)+"if (false) "+
    modified.slice(candidate.call.start);
  const [remainingBefore,remainingAfter]=await Promise.all([
    compile(excludedBefore),compile(excludedAfter),
  ]);
  if(remainingBefore.faces.length===0 ||
     remainingBefore.faces.length!==remainingAfter.faces.length ||
     connectedClosedShells(remainingBefore).length!==connectedClosedShells(remainingAfter).length) return false;
  const beforeAll=faceCounts(remainingBefore,remainingBefore.faces.map((_,i)=>i),zero);
  const afterAll=faceCounts(remainingAfter,remainingAfter.faces.map((_,i)=>i),zero);
  return beforeAll.size>0 && identical(beforeAll,afterAll);
}
