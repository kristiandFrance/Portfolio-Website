/**
 * THE INSTRUMENT — one WebGL scene behind the whole page.
 *
 * Built on the measured ESQRD teardown (docs/ESQRD_Teardown.md):
 *
 *  1. DOM-ANCHORED.  The object's position AND size come from an empty
 *     `[data-oct-anchor]` div in normal document flow. CSS owns the
 *     composition; the 3D follows. It cannot collide with content.
 *  2. SELECTIVE BLOOM at 0.22 strength — only objects on the BLOOM layer
 *     (the agent, the goal, the hot path) glow. The lattice never does.
 *  3. PLEXUS FIELD — 450 desktop / 125 mobile, grey, linked under 5.3
 *     units, at an opacity that reads as atmosphere, not confetti.
 *  4. One easing, everywhere.
 *
 * The octree itself is real: a sparse voxel octree built over a displaced
 * mesh, the node counts in the readout are the true counts, and the agent
 * runs a real A* across the leaf graph.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Group,
  HemisphereLight,
  Layers,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {
  buildSourceMesh,
  buildOctree,
  buildLeafGraph,
  aStar,
  chaikin,
  MAX_LEVEL,
  ROOT_HALF,
  SHAPES,
  SHAPE_COUNT,
} from '../lib/octree-build.js';

/* ══════════════════════════════════════════════════════════════
   TUNING — every taste constant. Values marked (esqrd) are copied
   from the teardown; the rest are tuned to this object.
   ══════════════════════════════════════════════════════════════ */
const T = {
  line: '#c6b29e', // warm hairline, never white
  copper: '#d9682a',
  ember: '#ff6a20',
  solid: '#1a1719',

  camZ: 7.4,
  fov: 32,

  bloom: {
    strength: 0.22, // (esqrd) 0.217
    radius: 1.6,
    scale: 0.5, // render bloom at half res
  },

  plexus: {
    count: 450, // (esqrd) 450 / 125 mobile
    countMobile: 125,
    spawn: [16, 6, 16], // (esqrd) wide and flat, not a cube
    maxLinkDist: 5.3, // (esqrd)
    oscFreq: 0.05, // (esqrd)
    oscAmp: 1.8, // (esqrd)
    color: '#6d6560',
    dotOpacity: 0.3,
    linkOpacity: 0.09,
    maxLinks: 1400,
    relinkEvery: 6, // frames — motion is slow, links needn't update hot
  },

  agent: {
    speed: 1.5,
    tintRadius: 0.3,
    tintLift: 0.28,
    trailCount: 18,
    trailLife: 1.2,
    goalFill: 0.14,
  },

  lens: { radiusPx: 170, latticeFade: 0.14, solidShow: 0.9 },

  load: { delay: 0.3, step: 0.4, dur: 0.6, solidFrom: 1.05, solidTo: 2.25 },

  /* the entrance: camera pulls in while the lens widens, so the object
     holds its frame while the perspective warps around it — a dolly
     zoom. The lattice grows slightly on top so it reads as arriving. */
  dolly: { dur: 1.9, fromZ: 13.5, fromFov: 15, fromScale: 0.84 },

  /* how far the object turns when a scene advances a step */
  roll: 0.85,

  /* the dissolve between one mass and the next */
  morph: { drawDur: 1.6, flowCount: 3200, flowDur: 2.8, spread: 2.1 },
};

/* which mass each scene wraps. The torus is the honest one: its hole
   costs the sparse tree nothing, and you can see that. */
const SCENE_SHAPE = {
  hero: SHAPES.BLOB,
  statement: SHAPES.CRYSTAL,
  shipped: SHAPES.TORUS,
  projects: SHAPES.CRYSTAL,
  jam: SHAPES.BLOB,
  about: SHAPES.TORUS,
  contact: SHAPES.BLOB, // reassembles into the solid it started as
};

/* the twelve edges of a unit cell, as ±1 endpoint pairs */
const CELL_EDGES = [
  [-1, -1, -1, 1, -1, -1], [-1, 1, -1, 1, 1, -1], [-1, -1, 1, 1, -1, 1], [-1, 1, 1, 1, 1, 1],
  [-1, -1, -1, -1, 1, -1], [1, -1, -1, 1, 1, -1], [-1, -1, 1, -1, 1, 1], [1, -1, 1, 1, 1, 1],
  [-1, -1, -1, -1, -1, 1], [1, -1, -1, 1, -1, 1], [-1, 1, -1, -1, 1, 1], [1, 1, -1, 1, 1, 1],
];

/* a random point ON a lattice line — not a cell centre. Sampling the
   edges is what makes the dissolve read as the lines themselves coming
   apart, rather than a cloud appearing near the object. */
function sampleOnLattice(shape, out) {
  const lf = shape.leaf;
  const c = lf.cells[(Math.random() * lf.cells.length) | 0];
  const e = CELL_EDGES[(Math.random() * 12) | 0];
  const t = Math.random();
  const h = lf.half;
  out[0] = c.x + (e[0] + (e[3] - e[0]) * t) * h;
  out[1] = c.y + (e[1] + (e[4] - e[1]) * t) * h;
  out[2] = c.z + (e[2] + (e[5] - e[2]) * t) * h;
  return out;
}

const BLOOM_LAYER = 1;

const C_LINE = new Color(T.line);
const C_COPPER = new Color(T.copper);
const C_EMBER = new Color(T.ember);
const C_SOLID = new Color(T.solid);

const EASE_OUT = (t) => 1 - Math.pow(1 - t, 3);

/* Per-chapter object state. Position and scale now come from the DOM
   anchor — these control only opacity, spin, and behaviour. */
const STATES = {
  hero: { levels: [0.34, 0.34, 0.38, 0.5, 0.86], solid: 0, contract: 0, spin: 0.05, traverse: false, lens: 1, plexus: 1 },
  statement: { levels: [0.16, 0.18, 0.22, 0.34, 0.66], solid: 0, contract: 0, spin: 0.09, traverse: true, lens: 0, plexus: 0.85 },
  shipped: { levels: [0.1, 0.12, 0.15, 0.26, 0.5], solid: 0, contract: 0, spin: 0.11, traverse: true, lens: 0, plexus: 0.6 },
  projects: { levels: [0.06, 0.08, 0.12, 0.24, 0.46], solid: 0, contract: 0.6, spin: 0.09, traverse: false, lens: 0, plexus: 0.5 },
  jam: { levels: [0.05, 0.06, 0.09, 0.16, 0.32], solid: 0, contract: 0.35, spin: 0.07, traverse: false, lens: 0, plexus: 0.45 },
  about: { levels: [0.05, 0.06, 0.08, 0.14, 0.28], solid: 0, contract: 0, spin: 0.02, traverse: false, lens: 0, plexus: 0.4 },
  contact: { levels: [0.05, 0.06, 0.07, 0.1, 0.18], solid: 0.92, contract: 0, spin: 0.04, traverse: false, lens: 1, plexus: 0.7 },
};

/* shared uniforms */
const uLens = { value: new Vector3(-99999, -99999, 1) };
const uLensStrength = { value: 0 };
const uAgent = { value: new Vector3(999, 999, 999) };
const uAgentAmt = { value: 0 };

function latticeMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uProgress: { value: 0 },
      uContract: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: C_LINE.clone() },
      uCopper: { value: C_COPPER.clone() },
      uAgentGlow: { value: 0 },
      uLens,
      uLensStrength,
      uAgent,
      uAgentAmt,
    },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute float aDelay;
      uniform float uProgress;
      uniform float uContract;
      uniform vec3 uAgent;
      varying float vA;
      varying float vNear;
      void main() {
        float t = clamp((uProgress - aDelay * 0.55) / 0.45, 0.0, 1.0);
        float e = 1.0 - pow(1.0 - t, 3.0);
        vec3 c = mix(aCenter, aCenter * 0.22, uContract);
        vec3 pos = c + (position - aCenter) * mix(0.86, 1.0, e);
        vA = e;
        vNear = 1.0 - smoothstep(${(T.agent.tintRadius * 0.3).toFixed(3)}, ${T.agent.tintRadius.toFixed(3)}, distance(aCenter, uAgent));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform vec3 uColor; uniform vec3 uCopper;
      uniform float uOpacity; uniform float uAgentGlow; uniform float uAgentAmt;
      uniform vec3 uLens; uniform float uLensStrength;
      varying float vA; varying float vNear;
      void main() {
        float a = vA * uOpacity;
        float d = distance(gl_FragCoord.xy, uLens.xy);
        float outside = smoothstep(uLens.z * 0.35, uLens.z, d);
        a *= mix(${T.lens.latticeFade}, 1.0, outside * (1.0 - uLensStrength) + outside * uLensStrength + (1.0 - uLensStrength) * (1.0 - outside));
        float near = vNear * uAgentGlow * uAgentAmt;
        vec3 col = mix(uColor, uCopper, clamp(near, 0.0, 1.0));
        a += near * ${T.agent.tintLift} * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

function buildLevelLines(level) {
  const { cells, half } = level;
  const pos = new Float32Array(cells.length * 24 * 3);
  const cen = new Float32Array(cells.length * 24 * 3);
  const del = new Float32Array(cells.length * 24);
  const E = [
    [-1, -1, -1, 1, -1, -1], [-1, 1, -1, 1, 1, -1], [-1, -1, 1, 1, -1, 1], [-1, 1, 1, 1, 1, 1],
    [-1, -1, -1, -1, 1, -1], [1, -1, -1, 1, 1, -1], [-1, -1, 1, -1, 1, 1], [1, -1, 1, 1, 1, 1],
    [-1, -1, -1, -1, -1, 1], [1, -1, -1, 1, -1, 1], [-1, 1, -1, -1, 1, 1], [1, 1, -1, 1, 1, 1],
  ];
  let p = 0, d = 0;
  cells.forEach((c, i) => {
    const hash = Math.abs(Math.sin(i * 12.9898 + c.ix * 78.233)) % 1;
    const sweep = (c.x + c.y * 0.6 + 3) / 6;
    const delay = Math.min(0.98, sweep * 0.45 + hash * 0.5);
    for (const [ax, ay, az, bx, by, bz] of E) {
      pos[p] = c.x + ax * half; pos[p + 1] = c.y + ay * half; pos[p + 2] = c.z + az * half;
      pos[p + 3] = c.x + bx * half; pos[p + 4] = c.y + by * half; pos[p + 5] = c.z + bz * half;
      for (let k = 0; k < 6; k += 3) { cen[p + k] = c.x; cen[p + k + 1] = c.y; cen[p + k + 2] = c.z; }
      del[d] = delay; del[d + 1] = delay;
      p += 6; d += 2;
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aCenter', new BufferAttribute(cen, 3));
  g.setAttribute('aDelay', new BufferAttribute(del, 1));
  return new LineSegments(g, latticeMaterial());
}

/* ── plexus field: points + links, the ESQRD background ──────── */
function buildPlexus(count) {
  const [SX, SY, SZ] = T.plexus.spawn;
  const base = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    base[i * 3] = (Math.random() * 2 - 1) * SX;
    base[i * 3 + 1] = (Math.random() * 2 - 1) * SY;
    base[i * 3 + 2] = (Math.random() * 2 - 1) * SZ;
    seed[i] = Math.random() * Math.PI * 2;
  }
  const live = new Float32Array(base);

  const pg = new BufferGeometry();
  pg.setAttribute('position', new BufferAttribute(live, 3));
  const points = new Points(
    pg,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uOpacity: { value: 0 }, uColor: { value: new Color(T.plexus.color) } },
      vertexShader: `
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 1.6 * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        precision mediump float;
        uniform float uOpacity; uniform vec3 uColor;
        void main() {
          float m = 1.0 - smoothstep(0.25, 0.5, length(gl_PointCoord - 0.5));
          float a = m * uOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    })
  );

  const lg = new BufferGeometry();
  lg.setAttribute('position', new BufferAttribute(new Float32Array(T.plexus.maxLinks * 6), 3));
  lg.setDrawRange(0, 0);
  const links = new LineSegments(
    lg,
    new LineBasicMaterial({ color: new Color(T.plexus.color), transparent: true, opacity: 0 })
  );

  return { points, links, base, live, seed, count };
}

export function initOctree({ canvas, posterEl, onReady }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktop = window.matchMedia('(min-width: 64rem)');
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    if (posterEl) posterEl.hidden = false;
    canvas.hidden = true;
    onReady?.();
    return;
  }
  renderer.setClearColor(0x000000, 0);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);

  const scene = new Scene();
  const camera = new PerspectiveCamera(T.fov, 1, 0.1, 80);
  camera.position.set(0, 0, T.camZ);
  camera.layers.enable(BLOOM_LAYER);

  scene.add(new HemisphereLight(0x8d8378, 0x0a0a0c, 1.15));
  const key = new DirectionalLight(0xfff0e4, 0.75);
  key.position.set(2.5, 3.2, 2.4);
  scene.add(key);
  const rim = new DirectionalLight(new Color(T.copper), 0.35);
  rim.position.set(-3, -1.2, -2);
  scene.add(rim);

  const group = new Group();
  const TILT = 0.3;
  group.rotation.set(TILT, 0, -0.05);
  scene.add(group);

  /* ── the octree, once per mass ────────────────────────────── */
  const shapes = [];
  for (let i = 0; i < SHAPE_COUNT; i++) {
    const src = buildSourceMesh(2, i);
    const oct = buildOctree(src.positions, src.triCount, MAX_LEVEL);
    const cumulative = [];
    oct.levels.reduce((a, lv) => {
      cumulative.push(a + lv.cells.length);
      return a + lv.cells.length;
    }, 0);
    const lf = oct.levels[oct.levels.length - 1];
    shapes.push({
      levels: oct.levels,
      totalNodes: oct.totalNodes,
      leaf: lf,
      neighbours: buildLeafGraph(lf).neighbours,
      cum: cumulative,
      alpha: i === 0 ? 1 : 0,
      drawT: i === 0 ? 1 : 0,
      lines: null,
    });
  }
  /* the solid mass is the blob — it is only ever shown in the scenes
     that use it (the entrance and the reassembly at contact) */
  const { positions } = buildSourceMesh(2, SHAPES.BLOB);
  let SH = 0;
  let levels = shapes[0].levels;
  let totalNodes = shapes[0].totalNodes;

  const solidGeo = new BufferGeometry();
  solidGeo.setAttribute('position', new BufferAttribute(positions, 3));
  solidGeo.computeVertexNormals();
  const solidMat = new MeshLambertMaterial({
    color: C_SOLID, flatShading: true, transparent: true, opacity: 1, side: DoubleSide,
  });
  solidMat.onBeforeCompile = (sh) => {
    sh.uniforms.uLens = uLens;
    sh.uniforms.uLensStrength = uLensStrength;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLens;\nuniform float uLensStrength;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float dl = distance(gl_FragCoord.xy, uLens.xy);
        float ml = (1.0 - smoothstep(uLens.z * 0.35, uLens.z, dl)) * uLensStrength;
        gl_FragColor.a = max(gl_FragColor.a, ml * ${T.lens.solidShow});`);
  };
  const solid = new Mesh(solidGeo, solidMat);
  group.add(solid);

  const edgeMat = new LineBasicMaterial({ color: C_LINE, transparent: true, opacity: 0.14 });
  const edges = new LineSegments(new EdgesGeometry(solidGeo, 12), edgeMat);
  group.add(edges);

  shapes.forEach((sh, i) => {
    sh.lines = sh.levels.map((lv) => {
      const l = buildLevelLines(lv);
      l.material.uniforms.uProgress.value = i === 0 ? 0 : 1;
      group.add(l);
      return l;
    });
    sh.lines[MAX_LEVEL].material.uniforms.uAgentGlow.value = 1;
    sh.lines[MAX_LEVEL - 1].material.uniforms.uAgentGlow.value = 0.45;
  });
  let levelLines = shapes[0].lines;

  /* ── plexus ───────────────────────────────────────────────── */
  const plex = buildPlexus(desktop.matches ? T.plexus.count : T.plexus.countMobile);
  const plexGroup = new Group();
  plexGroup.position.z = -6;
  plexGroup.add(plex.points, plex.links);
  scene.add(plexGroup);

  /* ── the A* agent (on the BLOOM layer) ────────────────────── */
  let leaf = shapes[0].leaf;
  let neighbours = shapes[0].neighbours;
  const leafSize = leaf.half * 2 * 0.92;

  const boid = new Group();
  const cone = new Mesh(
    new ConeGeometry(leafSize * 0.32, leafSize * 1.05, 6),
    new MeshBasicMaterial({ color: C_EMBER, transparent: true, opacity: 0 })
  );
  cone.layers.enable(BLOOM_LAYER);
  boid.add(cone);
  group.add(boid);

  const goalGeo = new BoxGeometry(leafSize, leafSize, leafSize);
  const goal = new Group();
  const goalFill = new Mesh(goalGeo, new MeshBasicMaterial({
    color: C_COPPER, transparent: true, opacity: T.agent.goalFill, depthWrite: false,
  }));
  const goalEdge = new LineSegments(new EdgesGeometry(goalGeo),
    new LineBasicMaterial({ color: C_EMBER, transparent: true, opacity: 0.8 }));
  goalEdge.layers.enable(BLOOM_LAYER);
  goal.add(goalFill, goalEdge);
  goal.visible = false;
  group.add(goal);

  const PATH_MAX = 1024;
  function makePath(max, bloom) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(PATH_MAX * 3), 3));
    g.setDrawRange(0, 0);
    const l = new Line(g, new LineBasicMaterial({
      color: bloom ? C_EMBER : C_COPPER, transparent: true, opacity: 0, depthTest: false,
    }));
    l.renderOrder = 3;
    l.userData.max = max;
    if (bloom) l.layers.enable(BLOOM_LAYER);
    group.add(l);
    return l;
  }
  const pathDim = makePath(0.16, false);
  const pathHot = makePath(0.75, true);

  const TRAIL_N = T.agent.trailCount;
  const trailGeo = new BufferGeometry();
  trailGeo.setAttribute('position', new BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
  trailGeo.setAttribute('aAge', new BufferAttribute(new Float32Array(TRAIL_N).fill(1), 1));
  const trailMat = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uColor: { value: C_EMBER.clone() }, uOpacity: { value: 0 } },
    vertexShader: `
      attribute float aAge; varying float vAge;
      void main() {
        vAge = aAge;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (7.0 * (1.0 - aAge) + 1.0) * (60.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision mediump float; uniform vec3 uColor; uniform float uOpacity; varying float vAge;
      void main() {
        float m = 1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - 0.5));
        float a = m * uOpacity * (1.0 - vAge) * 0.34;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  const trail = new Points(trailGeo, trailMat);
  trail.layers.enable(BLOOM_LAYER);
  group.add(trail);
  const trailAge = new Float32Array(TRAIL_N).fill(1);
  let trailHead = 0, trailTimer = 0;

  let path = null, smooth = null, segLen = null, travel = 0, totalLen = 0;
  let cursorCell = Math.floor(leaf.cells.length * 0.31);
  const dirV = new Vector3(0, 1, 0);
  const UP = new Vector3(0, 1, 0);

  function writeLine(line, pts, n) {
    const a = line.geometry.getAttribute('position');
    const c = Math.min(n, PATH_MAX);
    for (let i = 0; i < c; i++) a.setXYZ(i, pts[i][0], pts[i][1], pts[i][2]);
    a.needsUpdate = true;
    line.geometry.setDrawRange(0, c);
  }

  function nextPath() {
    for (let k = 0; k < 8; k++) {
      const gi = Math.floor(Math.random() * leaf.cells.length);
      const found = aStar(leaf.cells, neighbours, cursorCell, gi);
      if (found && found.length > 6) {
        path = found;
        smooth = chaikin(chaikin(found.map((i) => [leaf.cells[i].x, leaf.cells[i].y, leaf.cells[i].z])));
        segLen = [0];
        for (let i = 1; i < smooth.length; i++) {
          const a = smooth[i - 1], b = smooth[i];
          segLen.push(segLen[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
        }
        totalLen = segLen[segLen.length - 1];
        travel = 0;
        writeLine(pathDim, smooth, smooth.length);
        writeLine(pathHot, smooth, 1);
        const g = leaf.cells[gi];
        goal.position.set(g.x, g.y, g.z);
        goal.visible = true;
        cursorCell = gi;
        return;
      }
    }
    path = null;
  }

  function moveBoid(dt) {
    if (!smooth) return;
    travel = Math.min(travel + T.agent.speed * dt, totalLen);
    let i = 1;
    while (i < segLen.length - 1 && segLen[i] < travel) i++;
    const a = smooth[i - 1], b = smooth[i];
    const span = Math.max(segLen[i] - segLen[i - 1], 1e-5);
    const t = (travel - segLen[i - 1]) / span;
    boid.position.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    dirV.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    cone.quaternion.setFromUnitVectors(UP, dirV);
    uAgent.value.copy(boid.position);
    writeLine(pathHot, smooth, i + 1);

    trailTimer += dt;
    if (trailTimer > T.agent.trailLife / TRAIL_N) {
      trailTimer = 0;
      const at = trailGeo.getAttribute('position');
      at.setXYZ(trailHead, boid.position.x, boid.position.y, boid.position.z);
      at.needsUpdate = true;
      trailAge[trailHead] = 0;
      trailHead = (trailHead + 1) % TRAIL_N;
    }
    if (travel >= totalLen) nextPath();
  }

  /* ══ the dissolve ═══════════════════════════════════════════
     When the mass changes, a stream of points leaves the old cell
     centres and lands on the new ones, while the incoming lattice
     redraws itself with its own per-cell stagger. */
  const FLOW_N = T.morph.flowCount;
  const flowGeo = new BufferGeometry();
  flowGeo.setAttribute('position', new BufferAttribute(new Float32Array(FLOW_N * 3), 3));
  flowGeo.setAttribute('aFrom', new BufferAttribute(new Float32Array(FLOW_N * 3), 3));
  flowGeo.setAttribute('aTo', new BufferAttribute(new Float32Array(FLOW_N * 3), 3));
  const flowDelay = new Float32Array(FLOW_N);
  const flowDir = new Float32Array(FLOW_N * 3);
  for (let i = 0; i < FLOW_N; i++) {
    flowDelay[i] = Math.random();
    // random point on a sphere — the detour each particle takes
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const mag = 0.45 + Math.random() * 0.55;
    flowDir[i * 3] = Math.cos(th) * r * mag;
    flowDir[i * 3 + 1] = u * mag;
    flowDir[i * 3 + 2] = Math.sin(th) * r * mag;
  }
  flowGeo.setAttribute('aDelay', new BufferAttribute(flowDelay, 1));
  flowGeo.setAttribute('aDir', new BufferAttribute(flowDir, 3));
  const flowMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    /* deliberately NOT additive: thousands of overlapping points sum to
       white almost immediately, which is what turned the dissolve into
       a fireball. Normal blending keeps every particle legible. */
    uniforms: {
      uT: { value: 1 },
      uOpacity: { value: 0 },
      uSpread: { value: T.morph.spread },
      uColor: { value: new Color('#e8e2dc') },
      uHot: { value: C_EMBER.clone() },
    },
    vertexShader: `
      attribute vec3 aFrom; attribute vec3 aTo; attribute float aDelay;
      attribute vec3 aDir;
      uniform float uT; uniform float uSpread;
      varying float vA;
      varying float vT;
      void main() {
        // a long stagger: the swarm leaves in waves rather than at once
        float t = clamp((uT - aDelay * 0.62) / 0.38, 0.0, 1.0);
        float e = t * t * (3.0 - 2.0 * t);
        vec3 pos = mix(aFrom, aTo, e);
        // every particle takes its own detour, so the cloud sweeps wide
        // and converges — without this all three masses share a bounding
        // box and the journey is too short to see
        pos += aDir * sin(e * 3.14159) * uSpread;
        // fade in fast, hold bright across the journey, fade out at the end
        vA = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.82, 1.0, t));
        vT = t;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = (1.5 + 1.2 * vA) * (60.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision mediump float;
      uniform float uOpacity; uniform vec3 uColor; uniform vec3 uHot;
      varying float vA;
      varying float vT;
      void main() {
        float m = 1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - 0.5));
        // hottest in flight, cooling as it lands on the new lattice
        vec3 col = mix(uHot, uColor, smoothstep(0.15, 0.75, vT));
        float a = m * vA * uOpacity * 0.85;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const flow = new Points(flowGeo, flowMat);
  /* positions live entirely in the shader, so the geometry's bounding
     sphere is a zero-radius point at the origin — leave culling on and
     the whole swarm vanishes whenever the object nears a screen edge */
  flow.frustumCulled = false;
  flow.renderOrder = 4;
  flow.visible = false;
  group.add(flow);
  let flowT = 1;

  function goShape(next) {
    if (next === SH || !shapes[next]) return;
    const aF = flowGeo.getAttribute('aFrom');
    const aT = flowGeo.getAttribute('aTo');
    const tmp = [0, 0, 0];
    for (let i = 0; i < FLOW_N; i++) {
      sampleOnLattice(shapes[SH], tmp);
      aF.setXYZ(i, tmp[0], tmp[1], tmp[2]);
      sampleOnLattice(shapes[next], tmp);
      aT.setXYZ(i, tmp[0], tmp[1], tmp[2]);
    }
    aF.needsUpdate = true;
    aT.needsUpdate = true;
    flowT = 0;
    flow.visible = true;

    shapes[next].drawT = 0; // the incoming lattice redraws itself
    SH = next;
    levels = shapes[SH].levels;
    totalNodes = shapes[SH].totalNodes;
    levelLines = shapes[SH].lines;
    leaf = shapes[SH].leaf;
    neighbours = shapes[SH].neighbours;
    cum = shapes[SH].cum;
    // the agent's graph just changed under it
    path = null;
    smooth = null;
    cursorCell = (Math.random() * leaf.cells.length) | 0;
  }

  /* ══ selective bloom: half-res, two-pass blur, additive ═════ */
  const bloomLayers = new Layers();
  bloomLayers.set(BLOOM_LAYER);
  const rtA = new WebGLRenderTarget(1, 1);
  const rtB = new WebGLRenderTarget(1, 1);
  const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new Scene();
  const blurMat = new ShaderMaterial({
    uniforms: { uTex: { value: null }, uDir: { value: new Vector2(1, 0) }, uRadius: { value: T.bloom.radius } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      precision mediump float;
      uniform sampler2D uTex; uniform vec2 uDir; uniform float uRadius; varying vec2 vUv;
      void main() {
        vec4 s = texture2D(uTex, vUv) * 0.227027;
        s += texture2D(uTex, vUv + uDir * 1.3846 * uRadius) * 0.316216;
        s += texture2D(uTex, vUv - uDir * 1.3846 * uRadius) * 0.316216;
        s += texture2D(uTex, vUv + uDir * 3.2308 * uRadius) * 0.070270;
        s += texture2D(uTex, vUv - uDir * 3.2308 * uRadius) * 0.070270;
        gl_FragColor = s;
      }`,
  });
  const compMat = new ShaderMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    uniforms: { uTex: { value: null }, uStrength: { value: T.bloom.strength } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      precision mediump float;
      uniform sampler2D uTex; uniform float uStrength; varying vec2 vUv;
      void main() { gl_FragColor = texture2D(uTex, vUv) * uStrength; }`,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), blurMat);
  quad.frustumCulled = false;
  quadScene.add(quad);
  let bloomOn = desktop.matches && !reduced;

  /* ══ DOM anchoring — CSS owns where the object lives ════════ */
  const anchorEls = new Map();
  document.querySelectorAll('[data-oct-anchor]').forEach((el) => {
    anchorEls.set(el.dataset.octAnchor, el);
  });
  let activeName = 'hero';
  let target = STATES.hero;

  const want = { x: 0, y: 0, s: 1 };
  const now_ = { x: 0, y: 0, s: 1 };
  let placed = false;

  function readAnchor() {
    const el = anchorEls.get(activeName);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!el || w === 0 || h === 0) return;
    const r = el.getBoundingClientRect();
    const visH = 2 * Math.tan(((camera.fov / 2) * Math.PI) / 180) * camera.position.z;
    const visW = visH * camera.aspect;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    want.x = (cx / w - 0.5) * visW;
    want.y = -(cy / h - 0.5) * visH;
    // the anchor's width sets the object's on-screen size
    want.s = ((r.width / w) * visW) / (ROOT_HALF * 2);
  }

  /* ── chapter observer ─────────────────────────────────────── */
  const chapters = document.querySelectorAll('[data-oct-state]');
  const io = new IntersectionObserver(
    (es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        const n = e.target.dataset.octState;
        if (STATES[n]) {
          activeName = n;
          target = STATES[n];
          if (SCENE_SHAPE[n] !== undefined) goShape(SCENE_SHAPE[n]);
        }
      }
    },
    { rootMargin: '-45% 0px -45% 0px' }
  );
  chapters.forEach((c) => io.observe(c));

  /* ── pointer ──────────────────────────────────────────────── */
  const par = { x: 0, y: 0, tx: 0, ty: 0 };
  if (canHover && !reduced) {
    window.addEventListener('pointermove', (e) => {
      par.tx = ((e.clientX / window.innerWidth) * 2 - 1) * 0.1;
      par.ty = ((e.clientY / window.innerHeight) * 2 - 1) * 0.06;
      const r = canvas.getBoundingClientRect();
      uLens.value.set((e.clientX - r.left) * dpr, (r.height - (e.clientY - r.top)) * dpr, T.lens.radiusPx * dpr);
    }, { passive: true });
    window.addEventListener('pointerleave', () => { uLens.value.x = -99999; });
  }

  /* ── readouts ─────────────────────────────────────────────── */
  const readouts = [...document.querySelectorAll('[data-oct-readout]')];
  let lastRead = '';
  function say(txt) {
    if (txt === lastRead) return;
    lastRead = txt;
    for (const el of readouts) el.textContent = txt;
  }
  let cum = shapes[0].cum;

  let baseFov = T.fov;
  /* dolly runs once, when the preloader hands over */
  let dolly = reduced ? null : { t: 0 };
  let introEase = reduced ? 1 : 0;
  let rollNow = 0;
  if (!reduced) {
    camera.position.z = T.dolly.fromZ;
    camera.fov = T.dolly.fromFov;
    camera.updateProjectionMatrix();
    document.addEventListener('site:ready', () => { if (dolly) dolly.go = true; }, { once: true });
    // never strand the entrance if the ready event is missed
    setTimeout(() => { if (dolly) dolly.go = true; }, 7000);
  }

  /* ── size ─────────────────────────────────────────────────── */
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    baseFov = w < 700 ? 42 : T.fov;
    if (!dolly) camera.fov = baseFov;
    camera.updateProjectionMatrix();
    const bw = Math.max(1, Math.floor(w * dpr * T.bloom.scale));
    const bh = Math.max(1, Math.floor(h * dpr * T.bloom.scale));
    rtA.setSize(bw, bh);
    rtB.setSize(bw, bh);
    readAnchor();
    if (reduced) renderStatic();
  }
  resize();
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener('scroll', readAnchor, { passive: true });

  /* ── loop ─────────────────────────────────────────────────── */
  const cur = { levels: [0, 0, 0, 0, 0], solid: 1, contract: 0, spin: 0.05, plexus: 0 };
  let loadT = reduced ? Infinity : 0;
  let spin = 0, agentA = 0, frame = 0, running = true, announced = false;
  let last = performance.now();

  function relink(t) {
    const { base, live, seed, count } = plex;
    const [, , ] = T.plexus.spawn;
    for (let i = 0; i < count; i++) {
      live[i * 3] = base[i * 3] + Math.cos(t * T.plexus.oscFreq * 0.6 + seed[i]) * T.plexus.oscAmp * 0.4;
      live[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * T.plexus.oscFreq + seed[i]) * T.plexus.oscAmp;
      live[i * 3 + 2] = base[i * 3 + 2];
    }
    plex.points.geometry.getAttribute('position').needsUpdate = true;

    if (frame % T.plexus.relinkEvery === 0) {
      const la = plex.links.geometry.getAttribute('position');
      const md2 = T.plexus.maxLinkDist * T.plexus.maxLinkDist;
      let n = 0;
      for (let a = 0; a < count && n < T.plexus.maxLinks; a++) {
        for (let b = a + 1; b < count && n < T.plexus.maxLinks; b++) {
          const dx = live[a * 3] - live[b * 3];
          const dy = live[a * 3 + 1] - live[b * 3 + 1];
          const dz = live[a * 3 + 2] - live[b * 3 + 2];
          if (dx * dx + dy * dy + dz * dz > md2) continue;
          la.setXYZ(n * 2, live[a * 3], live[a * 3 + 1], live[a * 3 + 2]);
          la.setXYZ(n * 2 + 1, live[b * 3], live[b * 3 + 1], live[b * 3 + 2]);
          n++;
        }
      }
      la.needsUpdate = true;
      plex.links.geometry.setDrawRange(0, n * 2);
    }
  }

  function tick(nowMs) {
    if (!running) return;
    const dt = Math.min((nowMs - last) / 1000, 0.05);
    last = nowMs;
    frame++;
    const t = nowMs / 1000;

    /* load animation */
    if (loadT !== Infinity) {
      loadT += dt;
      const lt = loadT - T.load.delay;
      let lvl = 0, nodes = 1;
      levelLines.forEach((l, i) => {
        const p = Math.max(0, Math.min(1, (lt - i * T.load.step) / T.load.dur));
        l.material.uniforms.uProgress.value = EASE_OUT(p);
        if (p > 0.05) { lvl = i; nodes = cum[i]; }
      });
      cur.solid = 1 - Math.max(0, Math.min(1, (lt - T.load.solidFrom) / (T.load.solidTo - T.load.solidFrom)));
      say(`LEVEL 0${lvl} / 0${MAX_LEVEL} · ${nodes} NODES`);
      if (lt > MAX_LEVEL * T.load.step + T.load.dur + 0.2) loadT = Infinity;
    } else {
      levelLines.forEach((l) => (l.material.uniforms.uProgress.value = 1));
    }
    const done = loadT === Infinity;

    /* ── the mass, and the dissolve between masses ────────────
       The outgoing lattice fades, the incoming one redraws itself
       with its own per-cell stagger, and a stream of points carries
       the old cell centres onto the new ones. */
    for (let i = 0; i < shapes.length; i++) {
      const sh = shapes[i];
      // outgoing lets go fast (it is becoming the particles); incoming
      // arrives on its own stagger as they land
      const rate = i === SH ? 1.9 : 2.4;
      sh.alpha += ((i === SH ? 1 : 0) - sh.alpha) * (1 - Math.exp(-dt * rate));
      if (sh.drawT < 1) sh.drawT = Math.min(1, sh.drawT + dt / T.morph.drawDur);
      if (done) {
        const prog = EASE_OUT(sh.drawT);
        for (const l of sh.lines) l.material.uniforms.uProgress.value = prog;
      }
    }
    if (flowT < 1) {
      flowT = Math.min(1, flowT + dt / T.morph.flowDur);
      flowMat.uniforms.uT.value = flowT;
      flowMat.uniforms.uOpacity.value = Math.min(1, Math.sin(flowT * Math.PI) * 1.8);
      if (flowT >= 1) flow.visible = false;
    }

    const k = 1 - Math.exp(-dt * 3.4);
    for (let i = 0; i < 5; i++) {
      const g = done ? target.levels[i] : STATES.hero.levels[i];
      cur.levels[i] += (g - cur.levels[i]) * k;
      for (const sh of shapes) {
        sh.lines[i].material.uniforms.uOpacity.value = cur.levels[i] * sh.alpha;
        sh.lines[i].material.uniforms.uContract.value = cur.contract;
      }
    }
    if (done) cur.solid += (target.solid - cur.solid) * k;
    cur.contract += ((done ? target.contract : 0) - cur.contract) * k;
    cur.spin += (target.spin - cur.spin) * k;
    cur.plexus += ((done ? target.plexus : 0) - cur.plexus) * k;
    uLensStrength.value += ((done && canHover && !reduced ? target.lens : 0) - uLensStrength.value) * k;

    solidMat.opacity = cur.solid;
    solidMat.depthWrite = cur.solid > 0.5;
    solid.visible = cur.solid > 0.01 || uLensStrength.value > 0.02;
    edgeMat.opacity = cur.solid * 0.14;
    edges.visible = cur.solid > 0.01;

    plex.points.material.uniforms.uOpacity.value = cur.plexus * T.plexus.dotOpacity;
    plex.links.material.opacity = cur.plexus * T.plexus.linkOpacity;
    if (!reduced) relink(t);

    /* DOM anchor drives position + size */
    readAnchor();
    if (!placed) { placed = true; now_.x = want.x; now_.y = want.y; now_.s = want.s; }
    now_.x += (want.x - now_.x) * k;
    now_.y += (want.y - now_.y) * k;
    now_.s += (want.s - now_.s) * k;
    group.position.set(now_.x, now_.y, 0);
    /* the object arrives slightly small and settles into frame */
    const introScale = T.dolly.fromScale + (1 - T.dolly.fromScale) * introEase;
    group.scale.setScalar(now_.s * introScale);

    /* the ball rolls when the scene advances a part */
    const stepIdx = parseInt(document.documentElement.dataset.octStep || '0', 10) || 0;
    rollNow += (stepIdx * T.roll - rollNow) * k;

    if (!reduced) {
      spin += cur.spin * dt;
      par.x += (par.tx - par.x) * (1 - Math.exp(-dt * 2.4));
      par.y += (par.ty - par.y) * (1 - Math.exp(-dt * 2.4));
      group.rotation.y = spin + par.x + rollNow;
      group.rotation.x = TILT + par.y * 0.5;
      plexGroup.rotation.y = par.x * 0.3;
      plexGroup.rotation.x = par.y * 0.2;
    }

    /* A* */
    const going = done && target.traverse && !reduced;
    if (going) {
      if (!path) nextPath();
      if (path) {
        moveBoid(dt);
        const left = Math.max(0, Math.round(((totalLen - travel) / Math.max(totalLen, 1e-5)) * path.length));
        say(`A* · ${path.length} NODES · ${left} TO GOAL`);
      }
      agentA += (1 - agentA) * k;
    } else {
      agentA += (0 - agentA) * k;
      if (done) say(`LEVEL 0${MAX_LEVEL} / 0${MAX_LEVEL} · ${totalNodes} NODES`);
    }
    uAgentAmt.value = agentA;
    cone.material.opacity = agentA;
    boid.visible = agentA > 0.02;
    pathDim.material.opacity = agentA * pathDim.userData.max;
    pathHot.material.opacity = agentA * pathHot.userData.max;
    pathDim.visible = pathHot.visible = agentA > 0.02;
    trailMat.uniforms.uOpacity.value = agentA;
    trail.visible = agentA > 0.02;
    for (let i = 0; i < TRAIL_N; i++) if (trailAge[i] < 1) trailAge[i] = Math.min(1, trailAge[i] + dt / T.agent.trailLife);
    trailGeo.getAttribute('aAge').set(trailAge);
    trailGeo.getAttribute('aAge').needsUpdate = true;
    goal.visible = going && path !== null;
    if (goal.visible) {
      goal.scale.setScalar(1.18 + 0.1 * Math.sin(nowMs * 0.004));
      goalEdge.material.opacity = 0.62 + 0.18 * Math.sin(nowMs * 0.004);
    }

    render();

    if (!announced && done) { announced = true; onReady?.(); }
    requestAnimationFrame(tick);
  }

  function render() {
    if (bloomOn && agentA > 0.02) {
      // 1. emissive objects only, at half res
      const oldLayers = camera.layers.mask;
      camera.layers.mask = bloomLayers.mask;
      renderer.setRenderTarget(rtA);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      camera.layers.mask = oldLayers;

      // 2. separable blur
      quad.material = blurMat;
      blurMat.uniforms.uTex.value = rtA.texture;
      blurMat.uniforms.uDir.value.set(1 / rtA.width, 0);
      renderer.setRenderTarget(rtB);
      renderer.render(quadScene, quadCam);
      blurMat.uniforms.uTex.value = rtB.texture;
      blurMat.uniforms.uDir.value.set(0, 1 / rtA.height);
      renderer.setRenderTarget(rtA);
      renderer.render(quadScene, quadCam);

      // 3. main scene, then composite the glow additively over it
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      quad.material = compMat;
      compMat.uniforms.uTex.value = rtA.texture;
      renderer.autoClear = false;
      renderer.render(quadScene, quadCam);
      renderer.autoClear = true;
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  }

  function renderStatic() {
    levelLines.forEach((l, i) => {
      l.material.uniforms.uProgress.value = 1;
      l.material.uniforms.uOpacity.value = STATES.hero.levels[i];
    });
    cur.solid = 0; solidMat.opacity = 0; solid.visible = false; edges.visible = false;
    plex.points.material.uniforms.uOpacity.value = T.plexus.dotOpacity * 0.7;
    plex.links.material.opacity = T.plexus.linkOpacity * 0.7;
    relink(0);
    say(`LEVEL 0${MAX_LEVEL} / 0${MAX_LEVEL} · ${totalNodes} NODES`);
    readAnchor();
    now_.x = want.x; now_.y = want.y; now_.s = want.s;
    group.position.set(now_.x, now_.y, 0);
    /* the object arrives slightly small and settles into frame */
    const introScale = T.dolly.fromScale + (1 - T.dolly.fromScale) * introEase;
    group.scale.setScalar(now_.s * introScale);

    /* the ball rolls when the scene advances a part */
    const stepIdx = parseInt(document.documentElement.dataset.octStep || '0', 10) || 0;
    rollNow += (stepIdx * T.roll - rollNow) * k;
    render();
  }

  document.addEventListener('visibilitychange', () => {
    running = document.visibilityState === 'visible';
    if (running) { last = performance.now(); tick(last); }
  });

  if (reduced) {
    renderStatic();
    onReady?.();
    return;
  }
  requestAnimationFrame((n) => { last = n; tick(n); });
}
