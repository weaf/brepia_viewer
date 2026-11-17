import { describe, expect, it } from "vitest";
import {
  scadAxisToViewerDirection,
  scadToViewerOffset,
  type VisualMoveAxis,
  type VisualMoveOffset,
} from "./visualMoveAxes";

describe("OpenSCAD Move axes in the Three.js viewer", () => {
  it("keeps OpenSCAD Z as the vertical Three.js Y coordinate", () => {
    expect(scadToViewerOffset([3, 5, 7])).toEqual([3, 7, -5]);
  });

  it.each([
    [0, [1, 0, 0], [12, 0, 0]],
    [1, [0, 0, -1], [0, 0, -12]],
    [2, [0, 1, 0], [0, 12, 0]],
  ] as const)("moves OpenSCAD axis %s along the matching scene axis",
    (axis, expectedDirection, expectedPosition) => {
      expect(scadAxisToViewerDirection(axis as VisualMoveAxis)).toEqual(expectedDirection);
      const scad: VisualMoveOffset = [0, 0, 0];
      scad[axis] = 12;
      expect(scadToViewerOffset(scad)).toEqual(expectedPosition);
    });

  it("does not mutate the source model offset", () => {
    const offset: VisualMoveOffset = [2, -4, 6];
    expect(scadToViewerOffset(offset)).toEqual([2, 6, 4]);
    expect(offset).toEqual([2, -4, 6]);
  });
});
