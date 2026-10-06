import { Canvas, useThree } from '@react-three/fiber';
import {
  ArcballControls,
  Stage,
  Environment,
  OrthographicCamera,
  PerspectiveCamera,
  OrbitControls,
} from '@react-three/drei';
import * as THREE from 'three';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Box, Lock, Moon, Sun, Unlock } from 'lucide-react';
import { OrthographicPerspectiveToggle } from '@/components/viewer/OrthographicPerspectiveToggle';
import { ViewGizmo } from '@/components/viewer/ViewGizmo';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

const DEFAULT_VIEWER_BACKGROUND_COLOR = '#3B3B3B';
const VIEWER_BACKGROUND_STORAGE_KEY = 'brepia.viewer.backgroundLightness';

interface ThreeSceneProps {
  geometry: THREE.BufferGeometry | null;
  color: string;
  isMobile?: boolean;
  backgroundColor?: string;
  coloredGroup?: THREE.Group | null;
}

function ViewerControls({ uprightLocked }: { uprightLocked: boolean }) {
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
    return <OrbitControls makeDefault minZoom={0.01} maxZoom={1000} />;
  }

  return <ArcballControls makeDefault minZoom={0.01} maxZoom={1000} />;
}

export function ThreeScene({
  geometry,
  color,
  isMobile = false,
  backgroundColor = DEFAULT_VIEWER_BACKGROUND_COLOR,
  coloredGroup,
}: ThreeSceneProps) {
  const [isOrthographic, setIsOrthographic] = useState(true);
  const [uprightLocked, setUprightLocked] = useState(true);
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
    if (typeof window === 'undefined') return defaultBackgroundLightness;
    const stored = Number(
      window.localStorage.getItem(VIEWER_BACKGROUND_STORAGE_KEY),
    );
    return Number.isFinite(stored)
      ? Math.min(100, Math.max(0, stored))
      : defaultBackgroundLightness;
  });
  const viewerBackgroundColor = useMemo(
    () => lightnessToGrayHex(backgroundLightness),
    [backgroundLightness],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
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

  const geometryCenterOffset = useMemo(() => {
    if (!geometry) return null;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box || box.isEmpty()) return new THREE.Vector3();
    return box.getCenter(new THREE.Vector3()).negate();
  }, [geometry]);

  return (
    <div className="relative h-full w-full overflow-hidden">
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
          <Stage environment={null} intensity={0.6} position={[0, 0, 0]}>
            <Environment files={`${import.meta.env.BASE_URL}city.hdr`} />
            <ambientLight intensity={0.8} />
            <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
            <directionalLight position={[-5, 5, 5]} intensity={0.2} />
            <directionalLight position={[-5, 5, -5]} intensity={0.2} />
            <directionalLight position={[0, 5, 0]} intensity={0.2} />
            <directionalLight position={[-5, -5, -5]} intensity={0.6} />
            {coloredGroup && groupCenterOffset ? (
              <group rotation={[-Math.PI / 2, 0, 0]}>
                <primitive
                  object={coloredGroup}
                  position={groupCenterOffset.toArray()}
                />
              </group>
            ) : geometry && geometryCenterOffset ? (
              <group rotation={[-Math.PI / 2, 0, 0]}>
                <mesh
                  geometry={geometry}
                  position={geometryCenterOffset.toArray()}
                >
                  <meshStandardMaterial
                    color={color}
                    metalness={0.6}
                    roughness={0.3}
                    envMapIntensity={0.3}
                  />
                </mesh>
              </group>
            ) : null}
          </Stage>
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
          <ViewerControls uprightLocked={uprightLocked} />
          {showViewGizmo && (
            <ViewGizmo
              alignment={initialIsMobile ? 'top-right' : 'bottom-right'}
              margin={initialIsMobile ? [58, 58] : [80, 80]}
            />
          )}
        </Canvas>
      </Suspense>

      <div
        className={cn(
          'absolute bottom-2 left-2 z-10 flex items-center gap-2 rounded-full border border-adam-neutral-700/70 bg-adam-background-1/85 px-2 py-1 backdrop-blur-sm',
          initialIsMobile ? 'w-36' : 'w-44',
        )}
        title="Viewer background"
      >
        <Moon className="h-3.5 w-3.5 shrink-0 text-adam-text-primary/70" />
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
        <Sun className="h-3.5 w-3.5 shrink-0 text-adam-text-primary/70" />
      </div>

      <div
        className={cn(
          'absolute flex flex-col items-center',
          initialIsMobile ? 'bottom-2 right-2' : 'bottom-2 right-9',
        )}
      >
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={uprightLocked ? 'secondary' : 'ghost'}
            size="icon"
            className="h-8 w-8 rounded-full border border-adam-neutral-700/70 bg-adam-background-1/85 text-adam-text-primary backdrop-blur-sm"
            aria-label={
              uprightLocked
                ? 'Unlock viewer rotation'
                : 'Lock viewer upright like Mesh view'
            }
            aria-pressed={uprightLocked}
            title={
              uprightLocked ? 'Free rotate' : 'Lock upright like Mesh view'
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
            variant={showViewGizmo ? 'secondary' : 'ghost'}
            size="icon"
            className="h-8 w-8 rounded-full border border-adam-neutral-700/70 bg-adam-background-1/85 text-adam-text-primary backdrop-blur-sm"
            aria-label={
              showViewGizmo ? 'Hide orientation cube' : 'Show orientation cube'
            }
            aria-pressed={showViewGizmo}
            title={
              showViewGizmo ? 'Hide orientation cube' : 'Show orientation cube'
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
  );
}

function hexColorToLightness(color: string) {
  const normalized = color.trim().replace(/^#/, '');
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
    .padStart(2, '0');
  return `#${channel}${channel}${channel}`;
}
