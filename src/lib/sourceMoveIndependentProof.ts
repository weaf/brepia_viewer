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

/**
 * Accept an indexed instance only when the actual loop is a top-level
 * standalone statement (possibly inside a top-level if/else branch) and its
 * entire path to the call consists of translations. The generated delta is
 * in world axes; rotate/scale/mirror, nested CSG and braced loop bodies
 * cannot be translated in world space using this simple source rewrite.
 */
export function isIndependentTopLevelLoopInstance(
  source: string, candidate: SourceMoveCandidate,
): boolean {
  const {call, instanceIndex} = candidate;
  if (!call.loopVariable || !Number.isInteger(instanceIndex) ||
      instanceIndex! < 0 || call.start < 0 ||
      source.slice(call.start, call.start + call.callText.length) !== call.callText) return false;
  const clean = maskScadNonCode(source);
  const before = clean.slice(0, call.start);
  const loopPattern = /\bfor\s*\(/g;
  const matches = Array.from(before.matchAll(loopPattern));
  for (let site = matches.length - 1; site >= 0; site -= 1) {
    const match = matches[site];
    const openParen = before.indexOf("(", match.index);
    let depth = 0, end = -1;
    for (let i = openParen; i < call.start; i += 1) {
      if (clean[i] === "(") depth += 1;
      else if (clean[i] === ")" && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) continue;
    const header = clean.slice(openParen + 1, end - 1).trim();
    const variable = call.loopVariable.replace(/[$]/g, "");
    const headerPattern = new RegExp("^" + variable +
      "\\s*=\\s*\\[\\s*0\\s*:\\s*(?:[A-Za-z_]\\w*|[0-9]+)(?:\\s*-\\s*[0-9]+)?\\s*\\]$");
    if (!headerPattern.test(header)) continue;
    // Only the transform chain between this exact for() and the call.
    let cursor = end;
    let valid = true;
    let transforms = 0;
    while (cursor < call.start) {
      while (/\s/.test(clean[cursor] ?? "")) cursor += 1;
      if (cursor === call.start) break;
      const translate = /^translate\s*\(/.exec(clean.slice(cursor, call.start));
      if (!translate) { valid = false; break; }
      const begin = cursor + translate[0].lastIndexOf("(");
      let level = 0, close = -1;
      for (let i = begin; i < call.start; i += 1) {
        if (clean[i] === "(") level += 1;
        else if (clean[i] === ")" && --level === 0) { close = i + 1; break; }
      }
      if (close < 0) { valid = false; break; }
      cursor = close;
      transforms += 1;
    }
    if (!valid || cursor !== call.start || transforms > 8) continue;
    // A transparent single top-level if/else block is allowed, but not
    // module definitions, unions, differences or arbitrary nested scopes.
    const braces: number[] = [];
    for (let i = 0; i < match.index!; i += 1) {
      if (clean[i] === "{") braces.push(i);
      else if (clean[i] === "}") {
        if (braces.length === 0) return false;
        braces.pop();
      }
    }
    if (braces.length > 1) return false;
    if (braces.length === 1) {
      const opening = braces[0];
      const prefix = clean.slice(0, opening).trimEnd();
      if (!/(?:\belse|\bif\s*\([^()]*\))$/.test(prefix)) return false;
    }
    return true;
  }
  return false;
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
 * Geometric sanity check for a rigid, source-proven translation.
 * Non-identical tessellation is legal; a rigid translation preserves the
 * complete surface area, enclosed signed volume magnitude and closedness.
 * This is NEVER an independent basis for source attribution or saving.
 */
function sameClosedShellGeometry(
  baseline: ParsedOff, moved: ParsedOff, partIndex: number, delta: SourceMoveVector,
): boolean {
  const before=connectedClosedShells(baseline);
  const after=connectedClosedShells(moved);
  const chosen=before[partIndex];
  if (!chosen?.closed || before.length!==after.length) return false;
  const bounds=(off:ParsedOff, indices:readonly number[])=>{
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const index of indices) for(const vi of off.faces[index].vertices) {
      const v=off.vertices[vi];
      if(!v || v.some(n=>!Number.isFinite(n))) return null;
      for(let axis=0;axis<3;axis++) {
        min[axis]=Math.min(min[axis],v[axis]);
        max[axis]=Math.max(max[axis],v[axis]);
      }
    }
    return [...min,...max];
  };
  const beforeBounds=bounds(baseline,chosen.faceIndices);
  if(!beforeBounds) return false;
  const target=beforeBounds.map((v,i)=>v+delta[i%3]);
  const matching=after.filter(part => {
    const b=bounds(moved,part.faceIndices);
    return b && b.every((v,i)=>Math.abs(v-target[i])<=0.022);
  });
  if(matching.length!==1 || !matching[0].closed) return false;
  const metrics=(off:ParsedOff,indices:readonly number[])=>{
    let area=0, volume6=0;
    const b=bounds(off,indices);
    if(!b) return null;
    const origin=[(b[0]+b[3])/2,(b[1]+b[4])/2,(b[2]+b[5])/2];
    for(const i of indices) {
      const face=off.faces[i];
      if(!face || face.vertices.length!==3) return null;
      const [a,c,d]=face.vertices.map(vi=>{
        const xyz=off.vertices[vi];
        return [xyz[0]-origin[0],xyz[1]-origin[1],xyz[2]-origin[2]];
      });
      const u=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
      const v=[d[0]-a[0],d[1]-a[1],d[2]-a[2]];
      const cross=[
        u[1]*v[2]-u[2]*v[1],
        u[2]*v[0]-u[0]*v[2],
        u[0]*v[1]-u[1]*v[0],
      ];
      area+=Math.hypot(...cross)/2;
      volume6+=a[0]*(c[1]*d[2]-c[2]*d[1])+
        a[1]*(c[2]*d[0]-c[0]*d[2])+
        a[2]*(c[0]*d[1]-c[1]*d[0]);
    }
    return {area,volume:Math.abs(volume6)/6};
  };
  const a=metrics(baseline,chosen.faceIndices);
  const b=metrics(moved,matching[0].faceIndices);
  if(!a || !b || a.area<=1e-6 || b.area<=1e-6 ||
     a.volume<=1e-6 || b.volume<=1e-6) return false;
  const close=(x:number,y:number,absolute:number)=>Number.isFinite(x)&&Number.isFinite(y)&&
    Math.abs(x-y)<=Math.max(absolute,Math.max(x,y)*0.002);
  if(!close(a.area,b.area,0.005) || !close(a.volume,b.volume,0.01)) {
    console.info("[Source Move] rigid component invariant mismatch", {before:a,after:b});
    return false;
  }
  return true;
}

/**
 * Extra source-structural + geometric proof used only when a complete
 * in-scene face comparison fails due to global retessellation.
 *
 * 1. Source edit MUST be exactly one generated translate() on a standalone
 *    top-level module call previously identified by exclusion.
 * 2. The moved part must be uniquely located at the translated bounds,
 *    with the same shell count as the baseline. Either the triangles match
 *    exactly, or the selected shell must stay closed and preserve its
 *    full surface area and enclosed volume within OFF serialization error.
 *    The generated code contains ONLY a rigid, external translate() on the
 *    exactly matched call; geometry metrics alone never authorize a save.
 * 3. The rest of the model MUST compile to exactly identical OFF triangles
 *    after disabling that call both before and after the source edit.
 *
 * This checks ALL triangles of the independently rendered unaffected parts.
 * Nested CSG, rotated/scaled loop instances, multiple matches or errors fail closed.
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
  const isolatedLoop = isIndependentTopLevelLoopInstance(source,candidate);
  if(!isIndependentTopLevelCall(source,candidate) && !isolatedLoop)
    return reject("call-not-independent");
  if(delta.some(value=>!Number.isFinite(value))) return reject("non-finite-delta");
  if(writeSourceMoveTranslation(source,candidate,delta)!==modified) return reject("source-diff-unexpected");
  if(!singleExactMovedShell(baseline,moved,targetPart,delta)) {
    // The ONLY source modification is an outer translate() on a previously
    // matched, independent top-level call. By OpenSCAD semantics this cannot
    // reshape that call's geometry or alter siblings. Validate the compiled
    // result has exactly one translated closed shell with matching complete
    // area and volume. The unaffected scene is recompiled and checked face-
    // for-face below. Never infer source identity from geometry alone.
    if(!singleLocatedMovedShell(baseline,moved,targetPart,delta))
      return reject("moved-shell-bounds-mismatch");
    if(!sameClosedShellGeometry(baseline,moved,targetPart,delta))
      return reject("moved-shell-shape-invariant-mismatch");
  }
  const excludedBefore=excludeScadSourceCall(
    source,candidate.call,isolatedLoop ? candidate.instanceIndex : undefined,
  );
  // Disable the SAME instance before and after the generated writeback.
  // Other loop iterations must remain byte-identical in their OFF triangles.
  const guard = isolatedLoop
    ? "if (" + candidate.call.loopVariable + " != " + candidate.instanceIndex + ") "
    : "if (false) ";
  const excludedAfter=modified.slice(0,candidate.call.start)+guard+
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
