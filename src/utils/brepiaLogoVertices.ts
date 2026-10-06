type Point3 = readonly [number, number, number];

const vertices: number[] = [];

function addEdge(from: Point3, to: Point3, samples = 36) {
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    vertices.push(
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    );
  }
}

function addNode(point: Point3) {
  // Slightly denser point clusters make the B-Rep vertices read as editable
  // control nodes without requiring a second material or shader path.
  const offsets = [
    [0, 0, 0],
    [0.045, 0, 0],
    [-0.045, 0, 0],
    [0, 0.045, 0],
    [0, -0.045, 0],
    [0, 0, 0.045],
    [0, 0, -0.045],
  ] as const;

  for (const offset of offsets) {
    vertices.push(
      point[0] + offset[0],
      point[1] + offset[1],
      point[2] + offset[2],
    );
  }
}

const p000: Point3 = [-1, -1, -1];
const p001: Point3 = [-1, -1, 1];
const p010: Point3 = [-1, 1, -1];
const p011: Point3 = [-1, 1, 1];
const p100: Point3 = [1, -1, -1];
const p101: Point3 = [1, -1, 1];
const p110: Point3 = [1, 1, -1];
const p111: Point3 = [1, 1, 1];

// Eleven of the twelve cube edges are intentionally drawn. Leaving the
// p101→p111 edge open mirrors the Brepia mark's unfinished/editable geometry.
[
  [p000, p001],
  [p000, p010],
  [p000, p100],
  [p001, p011],
  [p001, p101],
  [p010, p011],
  [p010, p110],
  [p011, p111],
  [p100, p101],
  [p100, p110],
  [p110, p111],
].forEach(([from, to]) => addEdge(from, to));

[p000, p001, p010, p011, p100, p101, p110, p111].forEach(addNode);

export const brepiaLogoVertices = vertices;
