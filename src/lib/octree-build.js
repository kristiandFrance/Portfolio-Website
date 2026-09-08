/**
 * Sparse voxel octree over a displaced icosahedron — the site's hero object.
 *
 * This module is dependency-free maths shared by the browser scene
 * (src/scripts/octree-scene.js) and the build-time poster generator
 * (scripts/generate-assets.mjs), so the animated object and its static
 * fallback are guaranteed to be the same structure.
 *
 * Only cells that intersect the surface subdivide; empty space stays
 * empty. That sparseness is the entire point — see /work/octree.
 */

export const MAX_LEVEL = 4;
export const ROOT_HALF = 1.5;

/* ------------------------------------------------------------------ */
/* Source shape: icosahedron, subdivided twice, displaced by a fixed   */
/* harmonic field. Deterministic — same mass every load.               */
/* ------------------------------------------------------------------ */

const PHI = (1 + Math.sqrt(5)) / 2;

const ICO_VERTS = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];

const ICO_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function midpoint(a, b) {
  return normalize([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}

function displace(v) {
  const [x, y, z] = v;
  const s =
    1 +
    0.24 * Math.sin(2.2 * x + 1.7) * Math.sin(1.6 * y + 4.2) * Math.sin(2.1 * z + 0.8) +
    0.13 * Math.sin(1.1 * x - 1.7 * y + 1.1) +
    0.05 * Math.sin(3.9 * z + 2.6);
  return [x * s, y * s, z * s];
}

/* The object is not always the same mass. Each shape gives the octree a
   different problem to solve, and the difference is legible: the torus
   has a hole, so the sparse tree spends nothing on the middle. */
export const SHAPES = { BLOB: 0, TORUS: 1, CRYSTAL: 2 };
export const SHAPE_COUNT = 3;

/** spiky faceted variant — same sphere, high-frequency displacement */
function displaceCrystal(v) {
  const [x, y, z] = v;
  const spike = Math.abs(Math.sin(2.6 * x) * Math.sin(2.6 * y) * Math.sin(2.6 * z));
  const s = 0.86 + 0.62 * Math.pow(spike, 0.55) + 0.08 * Math.sin(5.1 * y);
  return [x * s, y * s, z * s];
}

/** torus as a non-indexed triangle soup, hole facing the camera */
function torusSoup(R = 1.02, r = 0.4, N = 44, M = 22) {
  const at = (i, j) => {
    const u = ((i % N) / N) * Math.PI * 2;
    const v = ((j % M) / M) * Math.PI * 2;
    const w = R + r * Math.cos(v);
    return [w * Math.cos(u), w * Math.sin(u), r * Math.sin(v)];
  };
  const tris = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      tris.push(a, b, c, a, c, d);
    }
  }
  const positions = new Float32Array(tris.length * 3);
  tris.forEach((t, i) => positions.set(t, i * 3));
  return { positions, triCount: tris.length / 3 };
}

/**
 * Returns { positions: Float32Array (non-indexed triangle soup),
 *           triCount: number }
 */
export function buildSourceMesh(detail = 2, shape = 0) {
  if (shape === SHAPES.TORUS) return torusSoup();
  let verts = ICO_VERTS.map(normalize);
  let faces = ICO_FACES.slice();

  for (let d = 0; d < detail; d++) {
    const next = [];
    const cache = new Map();
    const getMid = (i, j) => {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      if (cache.has(key)) return cache.get(key);
      const idx = verts.length;
      verts.push(midpoint(verts[i], verts[j]));
      cache.set(key, idx);
      return idx;
    };
    for (const [a, b, c] of faces) {
      const ab = getMid(a, b);
      const bc = getMid(b, c);
      const ca = getMid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }

  const displaced = verts.map(shape === SHAPES.CRYSTAL ? displaceCrystal : displace);
  const positions = new Float32Array(faces.length * 9);
  let o = 0;
  for (const [a, b, c] of faces) {
    positions.set(displaced[a], o); o += 3;
    positions.set(displaced[b], o); o += 3;
    positions.set(displaced[c], o); o += 3;
  }
  return { positions, triCount: faces.length };
}

/* ------------------------------------------------------------------ */
/* Triangle–AABB intersection (Akenine-Möller separating axis test)   */
/* ------------------------------------------------------------------ */

function planeBoxOverlap(nx, ny, nz, d, hx, hy, hz) {
  const r = hx * Math.abs(nx) + hy * Math.abs(ny) + hz * Math.abs(nz);
  return Math.abs(d) <= r;
}

function triBoxOverlap(cx, cy, cz, h, p, i0, i1, i2) {
  // translate triangle so the box is centred at origin
  const v0x = p[i0] - cx, v0y = p[i0 + 1] - cy, v0z = p[i0 + 2] - cz;
  const v1x = p[i1] - cx, v1y = p[i1 + 1] - cy, v1z = p[i1 + 2] - cz;
  const v2x = p[i2] - cx, v2y = p[i2 + 1] - cy, v2z = p[i2 + 2] - cz;

  // 1. box-axis tests (triangle AABB vs box)
  if (Math.min(v0x, v1x, v2x) > h || Math.max(v0x, v1x, v2x) < -h) return false;
  if (Math.min(v0y, v1y, v2y) > h || Math.max(v0y, v1y, v2y) < -h) return false;
  if (Math.min(v0z, v1z, v2z) > h || Math.max(v0z, v1z, v2z) < -h) return false;

  // edge vectors
  const e0x = v1x - v0x, e0y = v1y - v0y, e0z = v1z - v0z;
  const e1x = v2x - v1x, e1y = v2y - v1y, e1z = v2z - v1z;
  const e2x = v0x - v2x, e2y = v0y - v2y, e2z = v0z - v2z;

  // 2. nine cross-product axis tests
  const axisTest = (ax, ay, az) => {
    const p0 = ax * v0x + ay * v0y + az * v0z;
    const p1 = ax * v1x + ay * v1y + az * v1z;
    const p2 = ax * v2x + ay * v2y + az * v2z;
    const r = h * (Math.abs(ax) + Math.abs(ay) + Math.abs(az));
    return Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r;
  };

  if (axisTest(0, -e0z, e0y)) return false;
  if (axisTest(e0z, 0, -e0x)) return false;
  if (axisTest(-e0y, e0x, 0)) return false;
  if (axisTest(0, -e1z, e1y)) return false;
  if (axisTest(e1z, 0, -e1x)) return false;
  if (axisTest(-e1y, e1x, 0)) return false;
  if (axisTest(0, -e2z, e2y)) return false;
  if (axisTest(e2z, 0, -e2x)) return false;
  if (axisTest(-e2y, e2x, 0)) return false;

  // 3. triangle-plane test
  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  const d = nx * v0x + ny * v0y + nz * v0z;
  return planeBoxOverlap(nx, ny, nz, d, h, h, h);
}

/* ------------------------------------------------------------------ */
/* Sparse octree build                                                 */
/* ------------------------------------------------------------------ */

/**
 * Builds the sparse octree.
 * Returns {
 *   levels: Array<{ level, half, cells: Array<{x, y, z, ix, iy, iz}> }>,
 *   totalNodes: number
 * }
 * Cell (ix,iy,iz) are integer grid coords within that level, used for
 * neighbour lookup by the A* traversal.
 */
export function buildOctree(positions, triCount, maxLevel = MAX_LEVEL) {
  // per-cell triangle lists so children only test the parent's triangles
  const rootTris = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i++) rootTris[i] = i * 9;

  let current = [
    { x: 0, y: 0, z: 0, ix: 0, iy: 0, iz: 0, tris: rootTris },
  ];

  const levels = [
    { level: 0, half: ROOT_HALF, cells: [{ x: 0, y: 0, z: 0, ix: 0, iy: 0, iz: 0 }] },
  ];
  let totalNodes = 1;

  for (let level = 1; level <= maxLevel; level++) {
    const half = ROOT_HALF / Math.pow(2, level);
    const next = [];
    const cells = [];

    for (const parent of current) {
      for (let oz = -1; oz <= 1; oz += 2) {
        for (let oy = -1; oy <= 1; oy += 2) {
          for (let ox = -1; ox <= 1; ox += 2) {
            const cx = parent.x + ox * half;
            const cy = parent.y + oy * half;
            const cz = parent.z + oz * half;

            // gather intersecting triangles from the parent's list
            const hits = [];
            for (let t = 0; t < parent.tris.length; t++) {
              const base = parent.tris[t];
              if (triBoxOverlap(cx, cy, cz, half, positions, base, base + 3, base + 6)) {
                hits.push(base);
              }
            }
            if (hits.length === 0) continue; // sparse: empty space never subdivides

            const cell = {
              x: cx,
              y: cy,
              z: cz,
              ix: parent.ix * 2 + (ox > 0 ? 1 : 0),
              iy: parent.iy * 2 + (oy > 0 ? 1 : 0),
              iz: parent.iz * 2 + (oz > 0 ? 1 : 0),
            };
            cells.push(cell);
            next.push({ ...cell, tris: Uint32Array.from(hits) });
          }
        }
      }
    }

    levels.push({ level, half, cells });
    totalNodes += cells.length;
    current = next;
  }

  return { levels, totalNodes };
}

/* ------------------------------------------------------------------ */
/* A* over the leaf lattice (face-adjacent surface cells)              */
/* ------------------------------------------------------------------ */

export function buildLeafGraph(leafLevel) {
  const dim = Math.pow(2, leafLevel.level);
  const key = (ix, iy, iz) => ix + iy * dim + iz * dim * dim;
  const map = new Map();
  leafLevel.cells.forEach((c, i) => map.set(key(c.ix, c.iy, c.iz), i));

  const neighbours = leafLevel.cells.map((c) => {
    const out = [];
    const dirs = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1],
    ];
    for (const [dx, dy, dz] of dirs) {
      const n = map.get(key(c.ix + dx, c.iy + dy, c.iz + dz));
      if (n !== undefined) out.push(n);
    }
    return out;
  });

  return { neighbours };
}

export function aStar(cells, neighbours, start, goal) {
  const dist = (a, b) => {
    const ca = cells[a];
    const cb = cells[b];
    return Math.hypot(ca.x - cb.x, ca.y - cb.y, ca.z - cb.z);
  };

  const open = new Set([start]);
  const came = new Map();
  const g = new Map([[start, 0]]);
  const f = new Map([[start, dist(start, goal)]]);

  while (open.size > 0) {
    let current = -1;
    let best = Infinity;
    for (const n of open) {
      const fn = f.get(n) ?? Infinity;
      if (fn < best) {
        best = fn;
        current = n;
      }
    }
    if (current === goal) {
      const path = [current];
      while (came.has(current)) {
        current = came.get(current);
        path.push(current);
      }
      return path.reverse();
    }
    open.delete(current);
    for (const n of neighbours[current]) {
      const tentative = (g.get(current) ?? Infinity) + dist(current, n);
      if (tentative < (g.get(n) ?? Infinity)) {
        came.set(n, current);
        g.set(n, tentative);
        f.set(n, tentative + dist(n, goal));
        open.add(n);
      }
    }
  }
  return null;
}

/**
 * One pass of Chaikin corner-cutting over a polyline of [x,y,z] points —
 * the cheap cousin of the spline smoothing the real plugin does on agent
 * paths. Keeps endpoints.
 */
export function chaikin(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    out.push(
      [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25],
      [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]
    );
  }
  out.push(points[points.length - 1]);
  return out;
}
