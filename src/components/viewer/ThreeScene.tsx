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
  TransformControls,
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

const DEFAULT_VIEWER_BACKGROUND_COLOR = "#3B3B3B";
const VIEWER_BACKGROUND_STORAGE_KEY = "brepia.viewer.backgroundLightness";

interface ThreeSceneProps {
  geometry: THREE.BufferGeometry | null;
  color: string;
  isMobile?: boolean;
  backgroundColor?: string;
  coloredGroup?: THREE.Group | null;
  featureEdges?: readonly FeatureEdge[];
  /** Experimental source-proven, preview-only transform; never exported. */
  visualEditAllowed?: boolean;
}

function ViewerControls({ uprightLocked, enabled }: { uprightLocked: boolean; enabled: boolean }) {
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
    return <OrbitControls makeDefault enabled={enabled} minZoom={0.01} maxZoom={1000} />;
  }

  return <ArcballControls makeDefault enabled={enabled} minZoom={0.01} maxZoom={1000} />;
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

export function ThreeScene({
  geometry,
  color,
  isMobile = false,
  backgroundColor = DEFAULT_VIEWER_BACKGROUND_COLOR,
  coloredGroup,
  featureEdges = [],
  visualEditAllowed = false,
}: ThreeSceneProps) {
  const [isOrthographic, setIsOrthographic] = useState(true);
  const [uprightLocked, setUprightLocked] = useState(true);
  const [measuring, setMeasuring] = useState(false);
  const [visualMoving, setVisualMoving] = useState(false);
  const [visualMoveKey, setVisualMoveKey] = useState(0);
  const [visualMoveAxis, setVisualMoveAxis] = useState<0 | 1 | 2>(0);
  const [visualMoveDelta, setVisualMoveDelta] = useState<[number, number, number]>([0, 0, 0]);
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
    }
  }, [visualEditAllowed]);

  useEffect(() => {
    // A new render invalidates any preview-only transform.
    setVisualMoving(false);
    setVisualMoveDelta([0, 0, 0]);
    setVisualMoveKey((key) => key + 1);
  }, [geometry, coloredGroup]);

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
  const modelElement = coloredGroup && groupCenterOffset ? (
    <group ref={renderedModelRef} rotation={[-Math.PI / 2, 0, 0]} onClick={chooseMeasurementPoint}>
      <primitive object={coloredGroup} position={groupCenterOffset.toArray()} />
    </group>
  ) : geometry && geometryCenterOffset ? (
    <group ref={renderedModelRef} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={geometry} position={geometryCenterOffset.toArray()} onClick={chooseMeasurementPoint}>
        <meshStandardMaterial color={color} metalness={0.6} roughness={0.3} envMapIntensity={0.3} />
      </mesh>
    </group>
  ) : null;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <div ref={sceneHostRef} className="relative min-h-0 flex-1">
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
        <Canvas className="block h-full w-full">
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
          {/* Do not refit a user-zoomed camera when dimension endpoints change. */}
          <Stage environment={null} intensity={0.6} position={[0, 0, 0]} adjustCamera={!measuring && !visualMoving}>
            <Environment files={`${import.meta.env.BASE_URL}city.hdr`} />
            <ambientLight intensity={0.8} />
            <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
            <directionalLight position={[-5, 5, 5]} intensity={0.2} />
            <directionalLight position={[-5, 5, -5]} intensity={0.2} />
            <directionalLight position={[0, 5, 0]} intensity={0.2} />
            <directionalLight position={[-5, -5, -5]} intensity={0.6} />
            {visualMoving && visualEditAllowed && modelElement ? (
              isMobile ? <group position={visualMoveDelta}>{modelElement}</group> : <TransformControls
                key={visualMoveKey}
                mode="translate"
                showX showY showZ
                size={1}
                onObjectChange={(event) => {
                  const object = (event?.target as unknown as { object?: THREE.Object3D })?.object;
                  if (object) {
                    setVisualMoveDelta([object.position.x, object.position.y, object.position.z]);
                  }
                }}
              >
                {modelElement}
              </TransformControls>
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
          <ViewerControls uprightLocked={uprightLocked} enabled={!draggingMeasurement} />
          {showViewGizmo && (
            <ViewGizmo
              alignment={initialIsMobile ? "top-right" : "bottom-right"}
              margin={initialIsMobile ? [58, 58] : [80, 80]}
            />
          )}
        </Canvas>
      </Suspense>

      {visualEditAllowed && (
        <div className="absolute left-2 top-14 z-20 flex max-w-[min(90vw,330px)] flex-col gap-1.5 rounded-lg border border-white/15 bg-black/75 p-1.5 text-white shadow-lg"
          data-testid="visual-move-preview">
          <Button
            type="button" size="sm"
            variant={visualMoving ? "secondary" : "ghost"}
            className="h-11 justify-start gap-2 px-3 text-xs"
            aria-label="Preview visual movement"
            aria-pressed={visualMoving}
            onClick={() => {
              setVisualMoving(current => !current);
              setMeasuring(false);
              setVisualMoveDelta([0, 0, 0]);
              setVisualMoveKey(value => value + 1);
            }}
          >
            Visual move {visualMoving ? "on" : "preview"}
          </Button>
          {visualMoving && !isMobile && (
            <div className="space-y-1 px-2 pb-1 text-xs">
              <p>Drag the axis handles to move the preview.</p>
              <p className="font-mono" data-testid="visual-move-offsets">
                Scene X {visualMoveDelta[0].toFixed(1)} / Y {visualMoveDelta[1].toFixed(1)} / Z {visualMoveDelta[2].toFixed(1)}
              </p>
              <p className="text-amber-200">Preview only. Source code and exports are unchanged.</p>
              <button type="button" className="min-h-10 rounded border border-white/20 px-3"
                onClick={() => {
                  setVisualMoveDelta([0, 0, 0]);
                  setVisualMoveKey(value => value + 1);
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
         <div className="relative z-10 flex w-full shrink-0 flex-col gap-1 border-t border-white/15 bg-adam-background-1/95 px-3 py-2 text-xs text-adam-text-primary"
           data-testid="visual-move-mobile-controls">
           <div className="flex min-h-11 items-center gap-2">
             <label htmlFor="visual-move-axis" className="shrink-0">Move axis</label>
             <select id="visual-move-axis" aria-label="Visual move axis"
               value={visualMoveAxis}
               onChange={(event) => setVisualMoveAxis(Number(event.currentTarget.value) as 0 | 1 | 2)}
               className="h-11 rounded-lg border border-white/20 bg-adam-background-1 px-3">
               <option value={0}>X</option><option value={1}>Y</option><option value={2}>Z</option>
             </select>
             <span className="min-w-0 flex-1 truncate font-mono" data-testid="visual-move-offsets">
               Scene X {visualMoveDelta[0].toFixed(1)} / Y {visualMoveDelta[1].toFixed(1)} / Z {visualMoveDelta[2].toFixed(1)}
             </span>
             <button type="button" className="min-h-11 shrink-0 rounded-lg border border-white/20 px-3"
               onClick={() => setVisualMoveDelta([0, 0, 0])}>Reset position</button>
           </div>
           <input
             type="range" min={-50} max={50} step={1}
             aria-label={"Move model along " + ["X", "Y", "Z"][visualMoveAxis] + " axis"}
             value={visualMoveDelta[visualMoveAxis]}
             onChange={(event) => {
               const number = Number(event.currentTarget.value);
               setVisualMoveDelta(current => current.map((value, index) =>
                 index === visualMoveAxis ? number : value) as [number, number, number]);
             }}
             className="h-11 w-full touch-pan-x accent-cyan-400"
           />
           <p className="text-[11px] text-amber-200">Preview only. Source code and exports are unchanged.</p>
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
