import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  ArcballControls,
  Stage,
  Environment,
  OrthographicCamera,
  PerspectiveCamera,
  OrbitControls,
  Line,
  Html,
} from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ChevronDown, ChevronUp, Lock, Moon, Ruler, Sun, Undo2, Unlock, X } from "lucide-react";
import { OrthographicPerspectiveToggle } from "@/components/viewer/OrthographicPerspectiveToggle";
import { ViewGizmo } from "@/components/viewer/ViewGizmo";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { distanceBetweenModelPoints, type ModelPoint } from "@/lib/measureDistance";
import { inclinationFromHorizontal, inclinationGuides, formatDistanceFromModelUnits, type DistanceUnit } from "@/lib/measurementGeometry";
import { pickFeatureSnap } from "@/lib/featureSnap";
import type { FeatureEdge } from "@/lib/featureEdgeTopology";
import { resolveViewerBackgroundLightness } from "@/lib/viewerBackground";
import { scadAxisToViewerDirection, scadToViewerOffset, type VisualMoveOffset } from "@/lib/visualMoveAxes";

const DEFAULT_VIEWER_BACKGROUND_COLOR = "#3B3B3B";
const VIEWER_BACKGROUND_STORAGE_KEY = "brepia.viewer.backgroundLightness";

interface ThreeSceneProps {
  geometry: THREE.BufferGeometry | null;
  color: string;
  isMobile?: boolean;
  backgroundColor?: string;
  coloredGroup?: THREE.Group | null;
  partGroup?: THREE.Group | null;
  partStatus?: 'available' | 'single-component' | 'too-complex' | 'too-many-parts' | null;
  featureEdges?: readonly FeatureEdge[];
  /** Experimental source-proven, preview-only transform; never exported. */
  visualEditAllowed?: boolean;
}

function ViewerControls({ uprightLocked, enabled, onUserCameraMove }: { uprightLocked: boolean; enabled: boolean; onUserCameraMove: () => void }) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (!uprightLocked) return;

    // ArcballControls allows the camera's up vector to roll freely. When the
    // user switches to the Mesh-style locked interaction, restore canonical
    // world-up before OrbitControls takes over so Top/Bottom and the view gizmo
    // stay deterministic instead of preserving an already-rolled frame.
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    invalidate();
  }, [camera, invalidate, uprightLocked]);

  if (uprightLocked) {
    return <OrbitControls makeDefault enabled={enabled} onStart={onUserCameraMove} minZoom={0.01} maxZoom={1000} />;
  }

  return <ArcballControls makeDefault enabled={enabled} onStart={onUserCameraMove} minZoom={0.01} maxZoom={1000} />;
}

type ModelSurfacePointer = {
  point: THREE.Vector3;
  pointer: THREE.Vector2;
  camera: THREE.Camera;
  ray: THREE.Ray;
};

// Mobile handles live in screen space (44 px) but remain anchored to 3D
// surface points. Native pointer capture keeps a dragged handle responsive
// even when a finger leaves the small model or handle target.
function MobileMeasurementHandles({
  points,
  modelRef,
  autoPlace,
  onPlace,
  onDrag,
  onDraggingChange,
}: {
  points: ModelPoint[];
  modelRef: React.RefObject<THREE.Group | null>;
  autoPlace: boolean;
  onPlace: (points: ModelPoint[]) => void;
  onDrag: (index: number, sample: ModelSurfacePointer) => void;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const draggingRef = useRef<number | null>(null);
  const placementPendingRef = useRef(false);

  useEffect(() => {
    if (!autoPlace) placementPendingRef.current = false;
  }, [autoPlace]);

  const raycastModel = useCallback((clientX: number, clientY: number) => {
    const model = modelRef.current;
    const bounds = gl.domElement.getBoundingClientRect();
    if (!model || bounds.width <= 0 || bounds.height <= 0) return null;
    const pointer = new THREE.Vector2(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    model.updateWorldMatrix(true, true);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(model, true)[0];
    return hit ? {
      point: hit.point.clone(),
      pointer,
      camera,
      ray: raycaster.ray.clone(),
    } : null;
  }, [camera, gl, modelRef]);

  useFrame(() => {
    if (!autoPlace || placementPendingRef.current || points.length > 0) return;
    const bounds = gl.domElement.getBoundingClientRect();
    if (bounds.width < 40 || bounds.height < 40) return;
    const sample = (x: number) => raycastModel(
      bounds.left + bounds.width * x,
      bounds.top + bounds.height * 0.47,
    );
    // Select two surface locations near the center of the visible model.
    // Do not create measurements at invented coordinates if raycasts miss.
    const left = sample(0.42);
    const right = sample(0.58);
    if (!left || !right || left.point.distanceTo(right.point) < 0.01) return;
    placementPendingRef.current = true;
    onPlace([
      left.point.toArray() as ModelPoint,
      right.point.toArray() as ModelPoint,
    ]);
  });

  const moveHandle = (index: number, clientX: number, clientY: number) => {
    const hit = raycastModel(clientX, clientY);
    if (hit) onDrag(index, hit);
  };
  const stopDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (draggingRef.current === null) return;
    draggingRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onDraggingChange(false);
  };

  if (points.length !== 2) return null;
  return (
    <>
      {points.map((point, index) => (
        <Html key={index} position={point} center
          style={{ pointerEvents: "none" }} zIndexRange={[100, 0]}>
          <button
            type="button"
            aria-label={`Drag measurement endpoint ${index + 1}`}
            title={`Drag endpoint ${index + 1} to a corner or edge`}
            className="flex h-11 w-11 touch-none items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
            style={{ pointerEvents: "auto", touchAction: "none" }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              draggingRef.current = index;
              event.currentTarget.setPointerCapture(event.pointerId);
              onDraggingChange(true);
            }}
            onPointerMove={(event) => {
              if (draggingRef.current !== index) return;
              event.preventDefault();
              event.stopPropagation();
              moveHandle(index, event.clientX, event.clientY);
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              moveHandle(index, event.clientX, event.clientY);
              stopDrag(event);
            }}
            onPointerCancel={stopDrag}
            onLostPointerCapture={() => {
              if (draggingRef.current === index) {
                draggingRef.current = null;
                onDraggingChange(false);
              }
            }}
          >
            <span aria-hidden="true"
              className="block h-5 w-5 rounded-full border-2 border-white bg-amber-400 shadow-[0_0_0_2px_rgba(0,0,0,.65)]" />
          </button>
        </Html>
      ))}
    </>
  );
}



// Both desktop and mobile use the same captured R3F pointer gesture.
// A click on an arrow selects its axis and immediately starts the drag;
// a drag from the model surface uses the previously selected axis.
function VisualMoveManipulator({
  children,
  offset,
  basePosition = [0,0,0],
  axis,
  handleLength,
  isMobile,
  onAxisChange,
  onOffsetChange,
  onDraggingChange,
  onPinchingChange,
  onUserCameraMove,
}: {
  children: React.ReactNode;
  offset: VisualMoveOffset;
  basePosition?: [number, number, number];
  axis: 0 | 1 | 2;
  handleLength: number;
  isMobile: boolean;
  onAxisChange: (axis: 0 | 1 | 2) => void;
  onOffsetChange: (offset: VisualMoveOffset) => void;
  onDraggingChange: (dragging: boolean) => void;
  onPinchingChange: (pinching: boolean) => void;
  onUserCameraMove: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  type Capture = {
    setPointerCapture: (id: number) => void;
    hasPointerCapture: (id: number) => boolean;
    releasePointerCapture: (id: number) => void;
  };
  const dragRef = useRef<{
    pointerId: number;
    capture: Capture;
    axis: 0 | 1 | 2;
    x: number;
    y: number;
    initialOffset: VisualMoveOffset;
    axisPixelsX: number;
    axisPixelsY: number;
    fallbackUnitsPerPixel: number;
  } | null>(null);
  const controlsRef = useRef<{ controls: { enabled: boolean }; wasEnabled: boolean } | null>(null);
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const pinchControlsRef = useRef<{ enabled: boolean; wasEnabled: boolean } | null>(null);

  const endDrag = useCallback((pointerId: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    if (drag.capture.hasPointerCapture(pointerId)) {
      drag.capture.releasePointerCapture(pointerId);
    }
    if (controlsRef.current) {
      controlsRef.current.controls.enabled = controlsRef.current.wasEnabled;
      controlsRef.current = null;
    }
    onDraggingChange(false);
  }, [onDraggingChange]);

  // Native pointer listeners survive React re-renders and raycast changes when
  // the model moves away from the original touch point. The first finger drags
  // the model; a second touch cancels that drag and switches to camera pinch zoom.
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.dataset.moveCameraZoom = String(camera.zoom);
    const touches = touchPointsRef.current;
    const distanceBetweenTouches = () => {
      const [a, b] = [...touches.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const onDown = (event: PointerEvent) => {
      if (!isMobile || event.pointerType !== "touch") return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) {
        if (dragRef.current) endDrag(dragRef.current.pointerId);
        const active = controls as { enabled: boolean } | null;
        if (active) {
          pinchControlsRef.current = { enabled: active.enabled, wasEnabled: active.enabled };
          active.enabled = false;
        }
        pinchRef.current = {
          distance: Math.max(1, distanceBetweenTouches()),
          zoom: camera.zoom,
        };
        onPinchingChange(true);
        onUserCameraMove();
      }
    };
    const onMove = (event: PointerEvent) => {
      if (isMobile && event.pointerType === "touch" && touches.has(event.pointerId)) {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      const pinch = pinchRef.current;
      if (isMobile && pinch && touches.size >= 2) {
        if (event.cancelable) event.preventDefault();
        camera.zoom = THREE.MathUtils.clamp(
          pinch.zoom * distanceBetweenTouches() / pinch.distance,
          0.01,
          1000,
        );
        camera.updateProjectionMatrix();
        canvas.dataset.moveCameraZoom = String(camera.zoom);
        invalidate();
        return;
      }
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (event.cancelable) event.preventDefault();
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      const axisLengthSquared = drag.axisPixelsX ** 2 + drag.axisPixelsY ** 2;
      const displacement = axisLengthSquared >= 16
        ? (dx * drag.axisPixelsX + dy * drag.axisPixelsY) / axisLengthSquared
        : -dy * drag.fallbackUnitsPerPixel;
      const next = [...drag.initialOffset] as VisualMoveOffset;
      // A mobile finger has less travel than a mouse; use a predictable,
      // continuous gain rather than rounding or repeated step increments.
      next[drag.axis] += displacement * (isMobile ? 2 : 1);
      onOffsetChange(next);
    };
    const onEnd = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) endDrag(event.pointerId);
      touches.delete(event.pointerId);
      // Ignore the remaining finger until it lifts: no surprise second drag.
      if (pinchRef.current && touches.size === 0) {
        pinchRef.current = null;
        if (pinchControlsRef.current) {
          pinchControlsRef.current.enabled = pinchControlsRef.current.wasEnabled;
          pinchControlsRef.current = null;
        }
        onPinchingChange(false);
      }
    };
    canvas.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onEnd, true);
    window.addEventListener("pointercancel", onEnd, true);
    return () => {
      canvas.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onEnd, true);
      if (dragRef.current) endDrag(dragRef.current.pointerId);
      if (pinchControlsRef.current) {
        pinchControlsRef.current.enabled = pinchControlsRef.current.wasEnabled;
        pinchControlsRef.current = null;
      }
      touches.clear();
      pinchRef.current = null;
    };
  }, [camera, controls, endDrag, gl, invalidate, isMobile, onOffsetChange, onPinchingChange, onUserCameraMove]);

  const startDrag = (event: ThreeEvent<PointerEvent>, chosenAxis: 0 | 1 | 2) => {
    if (event.button !== 0 || !event.isPrimary ||
        dragRef.current || pinchRef.current || touchPointsRef.current.size > 1) return;
    const model = groupRef.current;
    if (!model) return;
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    model.updateWorldMatrix(true, false);
    const origin = model.localToWorld(new THREE.Vector3());
    const direction = new THREE.Vector3(...scadAxisToViewerDirection(chosenAxis));
    const screenOrigin = origin.clone().project(camera);
    const screenEnd = origin.clone().add(direction).project(camera);
    const axisPixelsX = (screenEnd.x - screenOrigin.x) * size.width / 2;
    const axisPixelsY = (screenOrigin.y - screenEnd.y) * size.height / 2;
    const fallbackUnitsPerPixel = camera instanceof THREE.OrthographicCamera
      ? Math.abs(camera.top - camera.bottom) / (camera.zoom * size.height)
      : camera instanceof THREE.PerspectiveCamera
        ? 2 * origin.distanceTo(camera.position) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / size.height
        : 1 / size.height;
    const capture = event.target as unknown as Capture;
    dragRef.current = {
      pointerId: event.pointerId, capture, axis: chosenAxis,
      x: event.clientX, y: event.clientY,
      initialOffset: [...offset] as VisualMoveOffset,
      axisPixelsX, axisPixelsY, fallbackUnitsPerPixel,
    };
    const activeControls = controls as { enabled: boolean } | null;
    if (activeControls) {
      controlsRef.current = { controls: activeControls, wasEnabled: activeControls.enabled };
      activeControls.enabled = false;
    }
    onAxisChange(chosenAxis);
    onDraggingChange(true);
    onUserCameraMove();
    capture.setPointerCapture(event.pointerId);
  };

  const arrowColors = ["#ff5959", "#43e6a2", "#4887ff"];
  const axisDirections: VisualMoveOffset[] = ([0, 1, 2] as const).map((axisIndex) =>
    scadAxisToViewerDirection(axisIndex).map((coordinate) => coordinate * handleLength) as VisualMoveOffset,
  );

  return (
    <group ref={groupRef} position={new THREE.Vector3(...basePosition).add(new THREE.Vector3(...scadToViewerOffset(offset))).toArray()}
      onPointerDown={(event) => startDrag(event, axis)}
      onPointerCancel={(event) => endDrag(event.pointerId)}
      onLostPointerCapture={(event) => endDrag(event.pointerId)}
    >
      {children}
      {axisDirections.map((direction, i) => {
        if (isMobile && i !== axis) return null;
        const selected = i === axis;
        const axisIndex = i as 0 | 1 | 2;
        return (
          <group key={i}>
            <Line points={[[0, 0, 0], direction]} color={arrowColors[i]}
              lineWidth={selected ? 4 : 2.5} raycast={() => {}} />
            <mesh position={direction}
              onPointerDown={(event) => startDrag(event, axisIndex)}
              onPointerOver={() => { if (!isMobile) document.body.style.cursor = "grab"; }}
              onPointerOut={() => { if (!isMobile) document.body.style.cursor = ""; }}
            >
              <sphereGeometry args={[Math.max(0.7, handleLength * 0.085), 16, 12]} />
              <meshBasicMaterial color={arrowColors[i]} depthTest={false}
                transparent opacity={selected ? 1 : 0.8} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function ThreeScene({
  geometry,
  color,
  isMobile = false,
  backgroundColor = DEFAULT_VIEWER_BACKGROUND_COLOR,
  coloredGroup,
  partGroup = null,
  partStatus = null,
  featureEdges = [],
  visualEditAllowed = false,
}: ThreeSceneProps) {
  const [isOrthographic, setIsOrthographic] = useState(true);
  const [uprightLocked, setUprightLocked] = useState(true);
  const [measuring, setMeasuring] = useState(false);
  const [visualMoving, setVisualMoving] = useState(false);
  const [visualMoveMode, setVisualMoveMode] = useState<'whole' | 'part'>('whole');
  const [selectedPart, setSelectedPart] = useState<number | null>(null);
  const [partOffsets, setPartOffsets] = useState<Record<number, VisualMoveOffset>>({});
  // Stage may fit a newly opened model, but never override a user's
  // zoom/orientation when a parameter triggers another OpenSCAD render.
  const [cameraManuallyAdjusted, setCameraManuallyAdjusted] = useState(false);
  const preserveCamera = useCallback(() => setCameraManuallyAdjusted(true), []);
  const shouldAutoFitCamera = !measuring && !visualMoving && !cameraManuallyAdjusted;
  const [visualMoveAxis, setVisualMoveAxis] = useState<0 | 1 | 2>(0);
  // UI and saved preview delta use OpenSCAD XYZ (Z-up), not Three.js XYZ (Y-up).
  const [visualMoveDelta, setVisualMoveDelta] = useState<VisualMoveOffset>([0, 0, 0]);
  const [draggingVisualMove, setDraggingVisualMove] = useState(false);
  const [pinchingVisualMove, setPinchingVisualMove] = useState(false);
  const [mobilePrecisionExpanded, setMobilePrecisionExpanded] = useState(false);
  const [measurementMode, setMeasurementMode] = useState<"distance" | "angle">("distance");
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>("mm");
  const [snapping, setSnapping] = useState(true);
  const [snapNotice, setSnapNotice] = useState<string | null>(null);
  const [autoPlaceMobileLine, setAutoPlaceMobileLine] = useState(false);
  const [draggingMeasurement, setDraggingMeasurement] = useState(false);
  const [mobileMeasurePanelExpanded, setMobileMeasurePanelExpanded] = useState(true);
  const sceneHostRef = useRef<HTMLDivElement>(null);
  const renderedModelRef = useRef<THREE.Group>(null);
  const [measurementPoints, setMeasurementPoints] = useState<ModelPoint[]>([]);
  // Keep the initial layout stable across responsive resizes. Desktop retains
  // the existing visible cube by default, while mobile gains an explicit cube
  // toggle without permanently consuming the smaller viewport.
  const [initialIsMobile] = useState(isMobile);
  const [showViewGizmo, setShowViewGizmo] = useState(() => !isMobile);
  const defaultBackgroundLightness = useMemo(
    () => hexColorToLightness(backgroundColor),
    [backgroundColor],
  );
  const [backgroundLightness, setBackgroundLightness] = useState(() => {
    if (typeof window === "undefined") return defaultBackgroundLightness;
    return resolveViewerBackgroundLightness(
      window.localStorage.getItem(VIEWER_BACKGROUND_STORAGE_KEY),
      defaultBackgroundLightness,
    );
  });
  useEffect(() => {
    if (!visualEditAllowed) {
      setVisualMoving(false);
      setVisualMoveDelta([0, 0, 0]);
      setDraggingVisualMove(false);
    }
  }, [visualEditAllowed]);

  useEffect(() => {
    // A new render invalidates any preview-only transform.
    setVisualMoving(false);
    setVisualMoveDelta([0, 0, 0]);
    setVisualMoveMode('whole');
    setSelectedPart(null);
    setPartOffsets({});
  }, [geometry, coloredGroup, partGroup]);

  const viewerBackgroundColor = useMemo(
    () => lightnessToGrayHex(backgroundLightness),
    [backgroundLightness],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      VIEWER_BACKGROUND_STORAGE_KEY,
      String(backgroundLightness),
    );
  }, [backgroundLightness]);

  // The colored group's meshes sit at their raw OpenSCAD coordinates.
  // Offset so the combined bounds are centered at origin, mirroring the
  // STL path's geom.center() behavior. Camera controls can then use the scene
  // origin as a stable visual pivot regardless of the model's authored datum.
  const groupCenterOffset = useMemo(() => {
    if (!coloredGroup) return null;
    const box = new THREE.Box3().setFromObject(coloredGroup);
    if (box.isEmpty()) return new THREE.Vector3();
    return box.getCenter(new THREE.Vector3()).negate();
  }, [coloredGroup]);

  // This overlay never changes source code or the STL/OFF output buffers.
  useEffect(() => {
    setMeasurementPoints([]);
    setSnapNotice(null);
  }, [geometry, coloredGroup]);

  const visualMoveHandleLength = useMemo(() => {
    const box = coloredGroup
      ? new THREE.Box3().setFromObject(coloredGroup)
      : geometry ? new THREE.Box3().setFromBufferAttribute(geometry.getAttribute("position") as THREE.BufferAttribute) : null;
    return box && !box.isEmpty() ? Math.max(2, box.getSize(new THREE.Vector3()).length() * 0.4) : 5;
  }, [geometry, coloredGroup]);

  const geometryCenterOffset = useMemo(() => {
    if (!geometry) return null;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box || box.isEmpty()) return new THREE.Vector3();
    return box.getCenter(new THREE.Vector3()).negate();
  }, [geometry]);


  const resolveMeasurementPoint = useCallback(
    (event: ModelSurfacePointer) => {
      let point: ModelPoint = [event.point.x,event.point.y,event.point.z];
      let snapKind: string | null = null;
      if (snapping && featureEdges.length) {
        const target=renderedModelRef.current;
        const bounds=sceneHostRef.current?.getBoundingClientRect();
        const modelCenter=coloredGroup ? groupCenterOffset : geometryCenterOffset;
        if (target && bounds && modelCenter) {
          target.updateWorldMatrix(true,false);
          // Stage and nested model groups can move or resize the scene.
          // Project candidates through the live world matrix, never through
          // an assumed X rotation or a hardcoded preview scale.
          const toWorld=(raw: ModelPoint): ModelPoint => {
            const local=new THREE.Vector3(raw[0],raw[1],raw[2]).add(modelCenter);
            target.localToWorld(local);
            return [local.x,local.y,local.z];
          };
          const worldFeatureEdges=featureEdges.map((edge) => ({
            ...edge,start:toWorld(edge.start),end:toWorld(edge.end),
          }));
          const modelSize = new THREE.Box3()
            .setFromObject(target)
            .getSize(new THREE.Vector3()).length() || 1;
          const isVisible=(candidate: THREE.Vector3) => {
            const camera=event.camera;
            // A camera ray can graze a triangulated corner and miss a front
            // face exactly on its boundary. Compare against the actual surface
            // hit as an additional occlusion gate, including ortho cameras.
            const viewDirection=new THREE.Vector3();
            camera.getWorldDirection(viewDirection);
            const surfaceDepth=event.point.clone().sub(camera.position).dot(viewDirection);
            const candidateDepth=candidate.clone().sub(camera.position).dot(viewDirection);
            if (candidateDepth > surfaceDepth + Math.max(0.1,modelSize*0.08)) {
              return false;
            }
            if (candidate.distanceTo(event.point) > Math.max(0.15,modelSize*0.16)) {
              return false;
            }
            const isPerspective=camera instanceof THREE.PerspectiveCamera;
            const direction=new THREE.Vector3();
            const origin=new THREE.Vector3();
            if (isPerspective) {
              origin.copy(camera.position);
              direction.copy(candidate).sub(origin);
            } else {
              camera.getWorldDirection(direction);
              origin.copy(candidate).addScaledVector(direction,-2000);
              direction.copy(candidate).sub(origin);
            }
            const distance=direction.length();
            const first=new THREE.Raycaster(
              origin,direction.normalize(),0,distance+0.1,
            ).intersectObject(target,true)[0];
            return !first || first.distance >= distance - 0.1;
          };
          const selected=pickFeatureSnap({
            edges:worldFeatureEdges,
            pointerNdc:event.pointer,
            camera:event.camera,
            ray:event.ray,
            viewport:{width:bounds.width,height:bounds.height},
            maxPixels:isMobile ? 24 : 16,
            isVisible,
          });
          if (selected) {
            point=selected.point;
            snapKind=selected.kind + (selected.shellIndex !== undefined ? ' on mesh shell ' + selected.shellIndex : '');
          }
        }
      }
      return { point, snapKind };
    },
    [snapping, featureEdges, coloredGroup, groupCenterOffset, geometryCenterOffset, isMobile],
  );

  const chooseMeasurementPoint = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (!measuring || event.delta > 4 || draggingMeasurement) return;
      event.stopPropagation();
      const { point, snapKind } = resolveMeasurementPoint(event);
      setSnapNotice(snapKind);
      setMeasurementPoints((previous) =>
        previous.length >= 2
          ? [point]
          : [...previous, point],
      );
    },
    [measuring, measurementMode, resolveMeasurementPoint, draggingMeasurement],
  );

  const dragMeasurementEndpoint = useCallback(
    (index: number, sample: ModelSurfacePointer) => {
      const { point, snapKind } = resolveMeasurementPoint(sample);
      setMeasurementPoints((previous) =>
        previous.length === 2
          ? previous.map((old, i) => i === index ? point : old)
          : previous,
      );
      setSnapNotice(snapKind);
    },
    [resolveMeasurementPoint],
  );

  const measuredDistance =
    measurementMode === "distance" && measurementPoints.length === 2
      ? distanceBetweenModelPoints(measurementPoints[0], measurementPoints[1])
      : null;
  const measuredAngle =
    measurementMode === "angle" && measurementPoints.length === 2
      ? inclinationFromHorizontal(measurementPoints[0], measurementPoints[1])
      : null;
  const angleGuides = useMemo(
    () => measurementMode === "angle" && measurementPoints.length === 2
      ? inclinationGuides(measurementPoints[0], measurementPoints[1])
      : null,
    [measurementMode, measurementPoints],
  );
  const distanceLabel =
    measuredDistance === null
      ? null
      : formatDistanceFromModelUnits(measuredDistance, distanceUnit);
  const angleLabel =
    measuredAngle === null ? null : measuredAngle.toFixed(1) + "°";





  // Controls wrap the displayed mesh only in the explicit preview mode.
  // The OpenSCAD source and the export buffers remain untouched.
  const modelElement = useMemo(() => coloredGroup && groupCenterOffset ? (
    <group ref={renderedModelRef} rotation={[-Math.PI / 2, 0, 0]} onClick={chooseMeasurementPoint}>
      <primitive object={coloredGroup} position={groupCenterOffset.toArray()} />
    </group>
  ) : geometry && geometryCenterOffset ? (
    <group ref={renderedModelRef} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={geometry} position={geometryCenterOffset.toArray()} onClick={chooseMeasurementPoint}>
        <meshStandardMaterial color={color} metalness={0.6} roughness={0.3} envMapIntensity={0.3} />
      </mesh>
    </group>
  ) : null, [coloredGroup, groupCenterOffset, geometry, geometryCenterOffset, color, chooseMeasurementPoint]);

  const partObjects = useMemo(() => (partGroup?.userData.parts ?? []) as THREE.Group[], [partGroup]);
  // Highlight only the selected preview component; no source or export mutation.
  useEffect(() => {
    partObjects.forEach((part, index) => part.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        material.emissive.setHex(index === selectedPart && visualMoveMode === 'part' ? 0x0066ff : 0x000000);
        material.emissiveIntensity = index === selectedPart && visualMoveMode === 'part' ? 0.55 : 0;
      });
    }));
  }, [partObjects, selectedPart, visualMoveMode]);

  // A Three.Object3D is reparented when mounted as a primitive. Freeze its
  // component references separately from the mutable Group.children array.
  const availablePartCount = partObjects.length;
  const selectedPartOffset = selectedPart === null ? [0,0,0] as VisualMoveOffset
    : (partOffsets[selectedPart] ?? [0,0,0] as VisualMoveOffset);
  // Stable during a drag: otherwise VisualMoveManipulator cleans up its
  // native pointer listeners whenever parent state changes.
  const setSelectedPartOffset = useCallback((offset: VisualMoveOffset) => {
    if (selectedPart === null) return;
    setPartOffsets(current => ({ ...current, [selectedPart]: offset }));
  }, [selectedPart]);
  const resetSelectedPart = () => {
    if (selectedPart === null) return;
    setPartOffsets(current => ({ ...current, [selectedPart]: [0,0,0] }));
  };
  // Both meshes and offsets are temporary. Never write to the source or exports.
  const partModelElement = partGroup && groupCenterOffset && availablePartCount > 1 ? (
    <group ref={renderedModelRef}>
      {partObjects.map((part, index) => {
        const offset = partOffsets[index] ?? [0,0,0] as VisualMoveOffset;
        const center = part.userData.center as [number, number, number];
        const worldCenter = scadToViewerOffset([
          center[0] + groupCenterOffset.x,
          center[1] + groupCenterOffset.y,
          center[2] + groupCenterOffset.z,
        ]);
        // Centre the selected gizmo on the component, not the entire model.
        // The extra inverse translation leaves the source-space mesh untouched.
        const partVisual = (
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <primitive object={part} position={groupCenterOffset.toArray()}
              onClick={(event: ThreeEvent<MouseEvent>) => {
                if (event.delta > 4) return;
                event.stopPropagation();
                setSelectedPart(index);
              }}
            />
          </group>
        );
        return index === selectedPart ? (
          <VisualMoveManipulator key={index} axis={visualMoveAxis} offset={selectedPartOffset}
            basePosition={worldCenter} isMobile={isMobile}
            handleLength={Math.max(2, visualMoveHandleLength * 0.35)}
            onAxisChange={setVisualMoveAxis} onOffsetChange={setSelectedPartOffset}
            onDraggingChange={setDraggingVisualMove} onPinchingChange={setPinchingVisualMove}
            onUserCameraMove={preserveCamera}>
            <group position={worldCenter.map(value => -value) as [number,number,number]}>
              {partVisual}
            </group>
          </VisualMoveManipulator>
        ) : (
          <group key={index} position={scadToViewerOffset(offset)}>
            {partVisual}
          </group>
        );
      })}
    </group>
  ) : null;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <div
        ref={sceneHostRef}
        className="relative min-h-0 flex-1"
        data-camera-auto-fit={shouldAutoFitCamera ? "true" : "false"}
        onWheelCapture={preserveCamera}
      >
      {/* Local Suspense boundary — `<Canvas>` re-throws suspension upward
          when any drei loader (e.g. <Environment> fetching city.hdr) is in
          flight. Without this boundary the suspension propagates all the
          way to <Await> inside TanStack's StartClient and tears down the
          entire app subtree. */}
      <Suspense
        fallback={
          <div
            className="h-full w-full"
            style={{ backgroundColor: viewerBackgroundColor }}
          />
        }
      >
        <Canvas className="block h-full w-full" style={isMobile && visualMoving ? { touchAction: "none" } : undefined}>
          <color attach="background" args={[viewerBackgroundColor]} />
          {isOrthographic ? (
            <OrthographicCamera
              makeDefault
              position={initialIsMobile ? [-100, 150, 100] : [-100, 100, 100]}
              zoom={40}
              near={0.1}
              far={1000}
            />
          ) : (
            <PerspectiveCamera
              makeDefault
              position={initialIsMobile ? [-100, 150, 100] : [-100, 100, 100]}
              fov={45}
              near={0.1}
              far={1000}
              zoom={0.4}
            />
          )}
          {/* Keep Stage's initial model fit. After manual camera movement, do
              not refit on geometry changes (Customizer, sliders or presets). */}
          <Stage environment={null} intensity={0.6} position={[0, 0, 0]} adjustCamera={shouldAutoFitCamera}>
            <Environment files={`${import.meta.env.BASE_URL}city.hdr`} />
            <ambientLight intensity={0.8} />
            <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
            <directionalLight position={[-5, 5, 5]} intensity={0.2} />
            <directionalLight position={[-5, 5, -5]} intensity={0.2} />
            <directionalLight position={[0, 5, 0]} intensity={0.2} />
            <directionalLight position={[-5, -5, -5]} intensity={0.6} />
            {visualMoving && visualEditAllowed && visualMoveMode === 'part' && partModelElement
              ? partModelElement
              : visualMoving && visualEditAllowed && modelElement ? (
              <VisualMoveManipulator
                offset={visualMoveDelta}
                axis={visualMoveAxis}
                handleLength={visualMoveHandleLength}
                isMobile={isMobile}
                onAxisChange={setVisualMoveAxis}
                onOffsetChange={setVisualMoveDelta}
                onDraggingChange={setDraggingVisualMove}
                onPinchingChange={setPinchingVisualMove}
                onUserCameraMove={preserveCamera}
              >{modelElement}</VisualMoveManipulator>
            ) : modelElement}
          </Stage>
          {measuring && isMobile && (
            <MobileMeasurementHandles
              points={measurementPoints}
              modelRef={renderedModelRef}
              autoPlace={autoPlaceMobileLine}
              onPlace={(points) => {
                setMeasurementPoints((previous) => previous.length ? previous : points);
                setAutoPlaceMobileLine(false);
              }}
              onDrag={dragMeasurementEndpoint}
              onDraggingChange={setDraggingMeasurement}
            />
          )}
          {measuring && measurementPoints.map((point, index) => (
            <mesh key={index} position={point} raycast={() => {}}>
              <sphereGeometry args={[0.45, 12, 12]} />
              <meshBasicMaterial color="#fbbf24" depthTest={false} />
            </mesh>
          ))}
          {measuring && measurementMode === "distance" && measurementPoints.length === 2 && distanceLabel && (
            <>
              <Line
                points={[measurementPoints[0], measurementPoints[1]]}
                color="#fbbf24"
                lineWidth={2}
              />
              {!isMobile && <Html
                position={[
                  (measurementPoints[0][0] + measurementPoints[1][0]) / 2,
                  (measurementPoints[0][1] + measurementPoints[1][1]) / 2,
                  (measurementPoints[0][2] + measurementPoints[1][2]) / 2,
                ]}
                center
                style={{ pointerEvents: "none" }}
              >
                <span className={cn("whitespace-nowrap rounded-md border border-amber-300/50 bg-black/85 px-2 py-1 text-xs font-semibold text-amber-200 shadow-lg", isMobile && "-translate-y-8")}>
                  {distanceLabel}
                </span>
              </Html>}
            </>
          )}
          {measuring && measurementMode === "angle" && measurementPoints.length === 2 && (
            <>
              <Line points={[measurementPoints[0], measurementPoints[1]]}
                color="#22d3ee" lineWidth={2} />
              {angleGuides && (
                <Line points={[measurementPoints[0], angleGuides.horizontalEnd]}
                  color="#94a3b8" lineWidth={1} dashed dashSize={0.7} gapSize={0.45} />
              )}
              {angleGuides && angleGuides.arc.length > 1 && (
                <Line points={angleGuides.arc.map((point) => [...point] as [number,number,number])}
                  color="#fbbf24" lineWidth={2} />
              )}
              {!isMobile && angleLabel && (
                <Html
                  position={angleGuides?.arc.length
                    ? angleGuides.arc[Math.floor(angleGuides.arc.length / 2)]
                    : measurementPoints[0]}
                  center style={{ pointerEvents: "none" }}
                >
                  <span className="whitespace-nowrap rounded-md border border-cyan-300/50 bg-black/85 px-2 py-1 text-xs font-semibold text-cyan-100 shadow-lg">
                    {angleLabel} to horizontal
                  </span>
                </Html>
              )}
            </>
          )}
          {/* <Grid
          position={[0, 0, 0]}
          cellSize={30}
          cellThickness={0.5}
          sectionSize={10}
          sectionColor="gray"
          sectionThickness={0.5}
          fadeDistance={500}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid={true}
        /> */}
          <ViewerControls uprightLocked={uprightLocked} enabled={!draggingMeasurement && !draggingVisualMove && !pinchingVisualMove} onUserCameraMove={preserveCamera} />
          {showViewGizmo && (
            <ViewGizmo
              onViewChange={preserveCamera}
              alignment={initialIsMobile ? "top-right" : "bottom-right"}
              margin={initialIsMobile ? [58, 58] : [80, 80]}
            />
          )}
        </Canvas>
      </Suspense>

      {visualEditAllowed && (!isMobile || !visualMoving || !partModelElement) && (
        <div className={cn("absolute left-2 z-20 flex max-w-[min(90vw,330px)] flex-col rounded-lg border border-white/15 bg-black/85 text-white shadow-lg", isMobile ? "bottom-12 p-0.5" : "top-14 gap-1.5 p-1.5")}
          data-testid="visual-move-preview">
          <Button
            type="button" size="sm"
            variant={visualMoving ? "secondary" : "ghost"}
            className={cn("justify-start gap-1.5 text-xs", isMobile ? "h-9 px-2" : "h-11 px-3")}
            aria-label="Preview visual movement"
            aria-pressed={visualMoving}
            onClick={() => {
              setVisualMoving(current => !current);
              setDraggingVisualMove(false);
              setPinchingVisualMove(false);
              setMeasuring(false);
              setVisualMoveDelta([0, 0, 0]);
            }}
          >
            Visual move {visualMoving ? "on" : "preview"}
          </Button>
          {visualMoving && Boolean(partModelElement) && !isMobile && (
            <div className="space-y-1 px-2 pb-1 text-xs">
              <label className="flex items-center gap-2" htmlFor="visual-move-mode">
                Move
                <select id="visual-move-mode" aria-label="Move mode"
                  className="h-9 rounded border border-white/20 bg-black px-2" value={visualMoveMode}
                  onChange={event => { setVisualMoveMode(event.target.value as 'whole' | 'part'); setDraggingVisualMove(false); }}>
                  <option value="whole">Whole Model</option>
                  <option value="part" disabled={!partModelElement}>Selected Part</option>
                </select>
              </label>
              {visualMoveMode === 'part' && (
                <div className="space-y-1" data-testid="part-move-controls">
                  <label htmlFor="part-move-selector">Part</label>
                  <select id="part-move-selector" aria-label="Select model part" className="h-9 max-w-full rounded border border-white/20 bg-black px-2"
                    value={selectedPart ?? ''} onChange={event => setSelectedPart(Number(event.target.value))}>
                    <option value="" disabled>Select in 3D or choose here</option>
                    {partObjects.map((part, index) => (
                      <option key={index} value={index}>Part {index + 1} ({part.userData.triangleCount} triangles)</option>
                    ))}
                  </select>
                  <p>{selectedPart === null ? 'Tap a part to select it, then drag a handle.' : 'Selected part ' + (selectedPart + 1)}</p>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className="min-h-9 rounded border border-white/20 px-2"
                      onClick={resetSelectedPart} disabled={selectedPart === null}>Reset Selected Part</button>
                    <button type="button" className="min-h-9 rounded border border-white/20 px-2"
                      onClick={() => setPartOffsets({})}>Reset All Parts</button>
                  </div>
                </div>
              )}
              {visualMoveMode === 'whole' && !partModelElement && partStatus && (
                <p role="status">Individual parts unavailable ({partStatus}).</p>
              )}
            </div>
          )}
          {visualMoving && !isMobile && (
            <div className="space-y-1 px-2 pb-1 text-xs">
              <p>Drag the model or a colored axis marker.</p>
              <div className="flex items-center gap-2">
                <label htmlFor="desktop-move-axis">Axis</label>
                <select id="desktop-move-axis" aria-label="Visual move axis" title="OpenSCAD axes: Z is vertical"
                  className="h-9 rounded border border-white/20 bg-black px-2"
                  value={visualMoveAxis}
                  onChange={(event) => setVisualMoveAxis(Number(event.currentTarget.value) as 0 | 1 | 2)}>
                  <option value={0}>X</option><option value={1}>Y</option><option value={2}>Z</option>
                </select>
              </div>
              <p className="font-mono" data-testid="visual-move-offsets">
                Scene X {(visualMoveMode === 'part' ? selectedPartOffset : visualMoveDelta)[0].toFixed(1)} / Y {(visualMoveMode === 'part' ? selectedPartOffset : visualMoveDelta)[1].toFixed(1)} / Z {(visualMoveMode === 'part' ? selectedPartOffset : visualMoveDelta)[2].toFixed(1)}
              </p>
              <p className="text-amber-200">Preview only. Source code and exports are unchanged.</p>
              <button type="button" className="min-h-10 rounded border border-white/20 px-3"
                onClick={() => {
                  if (visualMoveMode === 'part') resetSelectedPart();
                  else setVisualMoveDelta([0, 0, 0]);
                }}>Reset position</button>
            </div>
          )}
        </div>
      )}
      <div
        className={cn(
          "absolute bottom-2 left-2 z-10 flex w-20 items-center gap-0.5 rounded-full border border-adam-neutral-700/70 bg-adam-background-1/85 px-1 py-1 backdrop-blur-sm sm:w-44 sm:gap-2 sm:px-2",
        )}
        title="Viewer background"
      >
        <Moon className="h-3 w-3 shrink-0 text-adam-text-primary/70 sm:h-3.5 sm:w-3.5" />
        <Slider
          value={[backgroundLightness]}
          defaultValue={[defaultBackgroundLightness]}
          min={0}
          max={100}
          step={1}
          onValueChange={(values) => setBackgroundLightness(values[0])}
          variant="capsule"
          defaultMarkerStyle="line"
          className="h-6 flex-1"
          aria-label="Viewer background brightness"
        />
        <Sun className="h-3 w-3 shrink-0 text-adam-text-primary/70 sm:h-3.5 sm:w-3.5" />
      </div>

      <div
        className={cn(
          "absolute flex flex-col items-center",
          initialIsMobile ? "bottom-2 right-2" : "bottom-2 right-9",
        )}
      >
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant={measuring ? "secondary" : "ghost"}
            className="h-8 w-8 rounded-full border border-adam-neutral-700/70 bg-adam-background-1/85 text-adam-text-primary backdrop-blur-sm"
            aria-label={measuring ? "Turn off measurement" : "Measure distance or angle"}
            title={measuring ? "Turn off measurement" : "Measure distance or angle"}
            aria-pressed={measuring}
            data-testid="viewer-measure-toolbar-button"
            onClick={() => {
              setVisualMoving(false);
              setVisualMoveDelta([0, 0, 0]);
              setAutoPlaceMobileLine(!measuring && isMobile);
              setDraggingMeasurement(false);
              setMobileMeasurePanelExpanded(true);
              setMeasuring(!measuring);
              setMeasurementPoints([]);
              setSnapNotice(null);
            }}
          >
            <Ruler className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={uprightLocked ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 rounded-full border border-adam-neutral-700/70 bg-adam-background-1/85 text-adam-text-primary backdrop-blur-sm"
            aria-label={
              uprightLocked
                ? "Unlock viewer rotation"
                : "Lock viewer upright like Mesh view"
            }
            aria-pressed={uprightLocked}
            title={
              uprightLocked ? "Free rotate" : "Lock upright like Mesh view"
            }
            onClick={() => setUprightLocked((locked) => !locked)}
          >
            {uprightLocked ? (
              <Lock className="h-4 w-4" />
            ) : (
              <Unlock className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant={showViewGizmo ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 rounded-full border border-adam-neutral-700/70 bg-adam-background-1/85 text-adam-text-primary backdrop-blur-sm"
            aria-label={
              showViewGizmo ? "Hide orientation cube" : "Show orientation cube"
            }
            aria-pressed={showViewGizmo}
            title={
              showViewGizmo ? "Hide orientation cube" : "Show orientation cube"
            }
            onClick={() => setShowViewGizmo((visible) => !visible)}
          >
            <Box className="h-4 w-4" />
          </Button>
          <OrthographicPerspectiveToggle
            isOrthographic={isOrthographic}
            onToggle={setIsOrthographic}
          />
        </div>
      </div>
      </div>
       {visualEditAllowed && visualMoving && isMobile && (
         <div className="relative z-10 flex w-full shrink-0 flex-col border-t border-white/15 bg-adam-background-1/95 px-2 py-1 text-xs text-adam-text-primary"
            data-testid="visual-move-mobile-controls">
            {partModelElement && (
              <div className="flex h-10 min-w-0 items-center gap-1"
                data-testid={visualMoveMode === 'part' ? 'part-move-controls' : 'part-move-mode-mobile'}>
                <button type="button" aria-label="Preview visual movement" aria-pressed={visualMoving}
                  title="Turn off visual move"
                  className="h-9 w-10 shrink-0 rounded-md border border-white/20"
                  onClick={() => {
                    setVisualMoving(false);
                    setDraggingVisualMove(false);
                    setPinchingVisualMove(false);
                    setVisualMoveDelta([0, 0, 0]);
                  }}>Off</button>
                <label className="sr-only" htmlFor="visual-move-mode-mobile">Move mode</label>
                <select id="visual-move-mode-mobile" aria-label="Move mode"
                  className="h-9 w-28 shrink-0 rounded-md border border-white/20 bg-adam-background-1 px-1"
                  value={visualMoveMode}
                  onChange={event => {
                    setVisualMoveMode(event.target.value as 'whole' | 'part');
                    setDraggingVisualMove(false);
                  }}>
                  <option value="whole">Whole Model</option>
                  <option value="part">Selected Part</option>
                </select>
                {visualMoveMode === 'part' && (
                  <>
                    <label className="sr-only" htmlFor="part-move-selector-mobile">Part</label>
                    <select id="part-move-selector-mobile" aria-label="Select model part"
                      className="h-9 min-w-0 flex-1 rounded-md border border-white/20 bg-adam-background-1 px-1"
                      value={selectedPart ?? ''}
                      onChange={event => setSelectedPart(Number(event.target.value))}>
                      <option value="" disabled>Choose part</option>
                      {partObjects.map((part, index) => (
                        <option key={index} value={index}>Part {index + 1} ({part.userData.triangleCount} triangles)</option>
                      ))}
                    </select>
                    <button type="button" aria-label="Reset All Parts" title="Reset all parts"
                      className="h-9 w-9 shrink-0 rounded-md border border-white/20"
                      onClick={() => setPartOffsets({})}>All</button>
                  </>
                )}
              </div>
            )}
            <div className="flex h-10 items-center gap-2">
             <label htmlFor="visual-move-axis" className="sr-only">Move axis</label>
             <select id="visual-move-axis" aria-label="Visual move axis" title="OpenSCAD axes: Z is vertical"
               value={visualMoveAxis}
               onChange={(event) => setVisualMoveAxis(Number(event.currentTarget.value) as 0 | 1 | 2)}
               className="h-9 shrink-0 rounded-md border border-white/20 bg-adam-background-1 px-2">
               <option value={0}>X</option><option value={1}>Y</option><option value={2}>Z</option>
             </select>
             <span className="min-w-0 flex-1 truncate font-mono" data-testid="visual-move-offsets">
               Scene X {(visualMoveMode === 'part' ? selectedPartOffset : visualMoveDelta)[0].toFixed(1)} / Y {(visualMoveMode === 'part' ? selectedPartOffset : visualMoveDelta)[1].toFixed(1)} / Z {(visualMoveMode === 'part' ? selectedPartOffset : visualMoveDelta)[2].toFixed(1)}
             </span>
             <button type="button"
               aria-label={visualMoveMode === 'part' ? 'Reset Selected Part' : 'Reset position'}
               title={visualMoveMode === 'part' ? 'Reset selected part' : 'Reset position'}
               className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/20"
               onClick={() => { if (visualMoveMode === 'part') resetSelectedPart(); else setVisualMoveDelta([0,0,0]); }}><Undo2 className="h-4 w-4" /></button>
             <button type="button"
               aria-label={mobilePrecisionExpanded ? "Hide precision slider" : "Show precision slider"}
               aria-expanded={mobilePrecisionExpanded}
               className="h-9 shrink-0 rounded-md border border-white/20 px-2"
               onClick={() => setMobilePrecisionExpanded(current => !current)}>
               {mobilePrecisionExpanded ? "Hide" : "Adjust"}
             </button>
           </div>
           {mobilePrecisionExpanded && (
             <div className="flex min-h-10 items-center gap-2" data-testid="visual-move-mobile-precision">
               <input
                 type="range" min={-50} max={50} step={0.1}
                 aria-label={"Move model along " + ["X", "Y", "Z"][visualMoveAxis] + " axis"}
                 value={Math.max(-50, Math.min(50, (visualMoveMode === 'part' ? selectedPartOffset : visualMoveDelta)[visualMoveAxis]))}
                 onChange={(event) => {
                   const number = Number(event.currentTarget.value);
                    const current = visualMoveMode === 'part' ? selectedPartOffset : visualMoveDelta;
                    const next = current.map((value, index) => index === visualMoveAxis ? number : value) as VisualMoveOffset;
                    if (visualMoveMode === 'part') setSelectedPartOffset(next);
                    else setVisualMoveDelta(next);
                 }}
                 className="h-9 min-w-0 flex-1 touch-pan-x accent-cyan-400"
               />
               <span className="shrink-0 font-mono tabular-nums">{(visualMoveMode === 'part' ? selectedPartOffset : visualMoveDelta)[visualMoveAxis].toFixed(1)}</span>
             </div>
           )}
         </div>
       )}
       {measuring && (
       <div className={isMobile
           ? cn("relative z-10 flex w-full shrink-0 flex-col gap-1 border-t border-white/10 bg-adam-background-1/95 px-2 py-1.5",
               mobileMeasurePanelExpanded ? "h-36" : "h-14")
           : "absolute bottom-14 left-2 z-10 flex max-w-[min(92vw,340px)] flex-col gap-1.5"}>
         {isMobile && !mobileMeasurePanelExpanded ? (
           <button
             type="button"
             aria-label="Show measurement controls"
             aria-expanded={false}
             onClick={() => setMobileMeasurePanelExpanded(true)}
             className="flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-amber-300/30 bg-black/65 px-3 text-left text-sm text-white"
           >
             <Ruler className="h-4 w-4 shrink-0 text-amber-300" />
             <span className="shrink-0 font-semibold">{measurementMode === "distance" ? "Distance" : "Angle"}</span>
             <span className="min-w-0 flex-1 truncate text-amber-200">
               {measurementMode === "distance" ? distanceLabel ?? "Place a dimension" : angleLabel ? angleLabel + " to horizontal" : "Place an angle"}
             </span>
             <ChevronUp className="h-4 w-4 shrink-0" />
           </button>
         ) : (
         <>
         <div className="flex min-h-11 flex-nowrap items-center gap-1.5 overflow-x-auto">
          {measuring && (
            <>
              <select
                aria-label="Measurement mode"
                title="Choose distance or two-point inclination to the horizontal plane"
                value={measurementMode}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  if (next !== "distance" && next !== "angle") return;
                  setMeasurementMode(next);
                  setAutoPlaceMobileLine(measuring && isMobile);
                  setDraggingMeasurement(false);
                  setMeasurementPoints([]);
                  setSnapNotice(null);
                }}
                className="h-11 min-w-0 rounded-full border border-white/20 bg-adam-background-1/95 px-2.5 text-xs text-adam-text-primary"
              >
                <option value="distance">Distance</option>
                <option value="angle">Angle</option>
              </select>
              {measurementMode === "distance" && (
                <select
                  aria-label="Distance unit"
                  title="Assumes one OpenSCAD model unit is one millimetre"
                  value={distanceUnit}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    if (next === "mm" || next === "cm" || next === "m") {
                      setDistanceUnit(next);
                    }
                  }}
                  className="h-11 min-w-0 rounded-full border border-white/20 bg-adam-background-1/95 px-2.5 text-xs text-adam-text-primary"
                >
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </select>
              )}
              {measurementMode === "distance" && (
                <span className="shrink-0 text-[10px] text-white/70" title="Assumes one OpenSCAD unit is one millimetre">
                  1u = 1mm
                </span>
              )}
            </>
          )}
        </div>
        {measuring && (
           <div className="flex min-h-11 flex-nowrap items-center gap-1.5 overflow-x-auto">
             {isMobile && (
               <Button
                 type="button"
                 size="sm"
                 variant="ghost"
                 className="h-11 shrink-0 gap-1 rounded-full border border-amber-300/30 bg-adam-background-1/90 px-2.5"
                 aria-label="Hide measurement controls"
                 aria-expanded={true}
                 onClick={() => setMobileMeasurePanelExpanded(false)}
               >
                 <ChevronDown className="h-4 w-4" />
                 Hide
               </Button>
             )}
             <Button
               type="button"
               size="sm"
               variant={snapping ? "secondary" : "ghost"}
              className="h-11 rounded-full border border-white/20 bg-adam-background-1/90 px-3"
              aria-label="Snap to corners and edges"
              aria-pressed={snapping}
              onClick={() => setSnapping((enabled) => !enabled)}
              title="Use real sharp feature corners and edges, not face-triangulation lines"
            >
              Snap {snapping ? "on" : "off"}
            </Button>
            {measurementPoints.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-11 gap-1 rounded-full border border-white/20 bg-adam-background-1/90 px-3"
                aria-label="Undo last measurement point"
                onClick={() => {
                  setMeasurementPoints((points) => points.slice(0, -1));
                  setSnapNotice(null);
                }}
              >
                <Undo2 className="h-4 w-4" />
                Undo
              </Button>
            )}
            {measurementPoints.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-11 gap-1 rounded-full border border-white/20 bg-adam-background-1/90 px-3"
                aria-label="Clear measurement"
                onClick={() => {
                  setAutoPlaceMobileLine(false);
                  setDraggingMeasurement(false);
                  setMeasurementPoints([]);
                  setSnapNotice(null);
                }}
              >
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        )}
        {measuring && (
          <div className="flex h-7 min-w-0 items-center gap-1.5 overflow-hidden">
            <p role="status" className="min-w-0 flex-1 truncate rounded-md bg-black/80 px-2 py-1 text-xs text-white">
              {measurementMode === "distance"
                ? measurementPoints.length === 0
                  ? "Tap the first point on the model"
                  : measurementPoints.length === 1
                    ? "Tap the second point on the model"
                    : distanceLabel + (isMobile
                        ? " - drag the endpoints to adjust"
                        : " - tap again to start a new measurement")
                : measurementPoints.length === 0
                  ? "Tap the first angle reference point"
                  : measurementPoints.length === 1
                    ? "Tap the second angle point"
                    : angleLabel
                      ? angleLabel + " to horizontal" + (isMobile
                          ? " - drag the endpoints to adjust"
                          : " - tap again to start a new angle")
                      : "Angle undefined - tap to start again"}
            </p>
             {snapNotice && (
               <span className="shrink-0 rounded-md bg-black/75 px-2 py-1 text-[10px] text-amber-200">
                 Snapped to {snapNotice}
               </span>
             )}
           </div>
         )}
         </>
         )}
       </div>
       )}


    </div>
  );
}

function hexColorToLightness(color: string) {
  const normalized = color.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return 23;
  }

  const value = Number.parseInt(normalized, 16);
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  return Math.round(((red + green + blue) / 3 / 255) * 100);
}

function lightnessToGrayHex(lightness: number) {
  const clamped = Math.min(100, Math.max(0, lightness));
  const channel = Math.round((clamped / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${channel}${channel}${channel}`;
}
