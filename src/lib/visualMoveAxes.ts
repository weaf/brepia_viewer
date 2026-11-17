/** OpenSCAD uses Z-up; the Three.js preview uses Y-up.
 * The model is displayed with rotation [-PI/2, 0, 0] about X:
 * (x, y, z) in OpenSCAD becomes (x, z, -y) in the viewer.
 *
 * Move remains preview-only: these mappings never modify SCAD or exports.
 */
export type VisualMoveAxis = 0 | 1 | 2;
export type VisualMoveOffset = [number, number, number];

export function scadToViewerOffset([x, y, z]: readonly number[]): VisualMoveOffset {
  return [x, z, -y];
}

export function scadAxisToViewerDirection(axis: VisualMoveAxis): VisualMoveOffset {
  switch (axis) {
    case 0: return [1, 0, 0];
    case 1: return [0, 0, -1];
    case 2: return [0, 1, 0];
  }
}
