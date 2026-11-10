import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pickFeatureSnap } from './featureSnap';
import type { FeatureEdge } from './featureEdgeTopology';

const edge: FeatureEdge = {
  start:[0,0,0],end:[10,0,0],kind:'sharp',adjacentFaces:2,
};
const camera=new THREE.OrthographicCamera(-10,10,10,-10,0.1,100);
camera.position.set(0,0,20);
camera.lookAt(0,0,0);
camera.updateMatrixWorld();
camera.updateProjectionMatrix();
const ray=new THREE.Ray(new THREE.Vector3(5,0,20),new THREE.Vector3(0,0,-1));
const base={
  edges:[edge],camera,ray,maxPixels:20,viewport:{width:400,height:400},
};
describe('feature snapping in world units',()=>{
  it('snaps exactly to a sharp corner within the screen radius',()=>{
    const result=pickFeatureSnap({...base,pointerNdc:{x:0,y:0}});
    expect(result?.kind).toBe('corner');
    expect(result?.point).toEqual([0,0,0]);
  });
  it('snaps to a 3D position on an edge away from the corners',()=>{
    const result=pickFeatureSnap({...base,pointerNdc:{x:0.25,y:0}});
    expect(result?.kind).toBe('edge');
    expect(result?.point[0]).toBeCloseTo(5,5);
  });
  it('prefers the edge when a corner is twelve pixels away',()=>{
    const result=pickFeatureSnap({
      ...base,
      pointerNdc:{x:0.06,y:0},
      ray:new THREE.Ray(new THREE.Vector3(0.6,0,20),new THREE.Vector3(0,0,-1)),
    });
    expect(result?.kind).toBe('edge');
    expect(result?.point[0]).toBeCloseTo(0.6,5);
  });
  it('keeps corner assistance when a finger lands five pixels away',()=>{
    const result=pickFeatureSnap({
      ...base,
      pointerNdc:{x:0.025,y:0},
      ray:new THREE.Ray(new THREE.Vector3(0.25,0,20),new THREE.Vector3(0,0,-1)),
    });
    expect(result?.kind).toBe('corner');
    expect(result?.point).toEqual([0,0,0]);
  });
  it('reports the geometric shell for a snapped edge or corner',()=>{
    const tagged = {...edge, shellIndex: 3};
    const corner=pickFeatureSnap({...base,edges:[tagged],pointerNdc:{x:0,y:0}});
    const middle=pickFeatureSnap({...base,edges:[tagged],pointerNdc:{x:0.25,y:0}});
    expect(corner?.shellIndex).toBe(3);
    expect(middle?.shellIndex).toBe(3);
  });
  it('does not attribute a shared corner to one of two shells',()=>{
    const first={...edge,shellIndex:1};
    const second={...edge,end:[0,10,0] as [number,number,number],shellIndex:2};
    const selected=pickFeatureSnap({...base,edges:[first,second],pointerNdc:{x:0,y:0}});
    expect(selected?.kind).toBe('corner');
    expect(selected?.shellIndex).toBeUndefined();
  });
  it('rejects hidden candidates to avoid snapping through a solid',()=>{
    const result=pickFeatureSnap({...base,pointerNdc:{x:0,y:0},isVisible:()=>false});
    expect(result).toBeNull();
  });
  it('does not use tessellation, boundary, or offscreen edges',()=>{
    const result=pickFeatureSnap({
      ...base,
      pointerNdc:{x:-0.8,y:-0.8},
      edges:[{...edge,kind:'open-boundary'}],
    });
    expect(result).toBeNull();
  });
});
