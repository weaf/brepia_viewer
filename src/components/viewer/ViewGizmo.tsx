import { useCallback, useMemo } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { GizmoHelper, GizmoViewcube } from '@react-three/drei';
import * as THREE from 'three';

type Alignment =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'bottom-center'
  | 'center-right'
  | 'center-left'
  | 'center-center'
  | 'top-center';

interface ViewGizmoProps {
  alignment?: Alignment;
  margin?: [number, number];
}

type ControlsWithTarget = {
  target?: THREE.Vector3;
  update?: () => void;
};

function isControlsWithTarget(value: unknown): value is ControlsWithTarget {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const hasTarget = 'target' in value;
  const hasUpdate = 'update' in value;

  return (
    (!hasTarget || value.target instanceof THREE.Vector3) &&
    (!hasUpdate || typeof value.update === 'function') &&
    (hasTarget || hasUpdate)
  );
}

// Drei's <GizmoHelper> animates the main camera toward a face/edge orientation.
// That animation can leave camera.up and the active camera controls subtly out
// of sync, especially after free trackball rotation where camera.up is allowed
// to roll with the view.
//
// Bypass the helper animation and snap directly to a canonical face/edge view.
// Reset camera.up to a non-degenerate axis, look at the controls target, then
// update the active controls. This keeps view-cube snaps deterministic while
// still allowing unrestricted trackball rotation between snaps.
export function ViewGizmo({
  alignment = 'bottom-right',
  margin = [80, 80],
}: ViewGizmoProps) {
  const camera = useThree((state) => state.camera);
  const rawControls = useThree((state) => state.controls);
  const controls = isControlsWithTarget(rawControls) ? rawControls : null;
  const invalidate = useThree((state) => state.invalidate);
  const fallbackTarget = useMemo(() => new THREE.Vector3(), []);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>): void => {
      e.stopPropagation();
      const eventObject = e.eventObject;
      const direction = new THREE.Vector3();
      // Edge and corner cubes carry a non-origin local position pointing
      // outward from the gizmo's center; the central face cube is at the
      // origin and we use the clicked face's normal to recover the axis.
      if (eventObject.position.lengthSq() > 1e-6) {
        direction.copy(eventObject.position).normalize();
      } else if (e.face) {
        direction.copy(e.face.normal);
      } else {
        return;
      }

      const target =
        controls && controls.target ? controls.target : fallbackTarget;
      const radius = Math.max(camera.position.distanceTo(target), 1e-3);

      if (Math.abs(direction.y) > 0.99) {
        camera.up.set(0, 0, -1);
      } else {
        camera.up.set(0, 1, 0);
      }
      camera.position.copy(target).addScaledVector(direction, radius);
      camera.lookAt(target);
      controls?.update?.();
      invalidate();
    },
    [camera, controls, invalidate, fallbackTarget],
  );
  return (
    <GizmoHelper alignment={alignment} margin={margin}>
      {/* @ts-expect-error drei 10.0.7 types this ignored callback return as null. */}
      <GizmoViewcube onClick={handleClick} />
    </GizmoHelper>
  );
}
