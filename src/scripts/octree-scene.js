/**
 * The hero object: a solid mass that takes itself apart.
 *
 * v3 — dark instrument. Light hairline lattice on near-black, one amber
 * accent that behaves like hot metal:
 *
 *  - load: the solid subdivides into the sparse lattice (real octree,
 *    real node counts)
 *  - shipped: an A* boid flies the lattice — cells glow amber as it
 *    passes, the goal cell burns until the boid hits it, the planned
 *    path is drawn dim and filled in hot behind the agent
 *  - projects: the lattice contracts to a dense cluster
 *  - about: fades to near-nothing
 *  - contact: reassembles into the solid it started as
 *
 * Pointer: parallax toward the cursor, plus a feathered ring lens — cells
 * near the cursor glow amber while the very centre goes dark, like a hand
 * passing over an instrument panel.
 *
 * Particles: ambient dust drifting behind everything, and glowing node
 * points at leaf-cell centres that light with the agent and the lens.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DirectionalLight,
  EdgesGeometry,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  buildSourceMesh,
  buildOctree,
  buildLeafGraph,
  aStar,
  chaikin,
  MAX_LEVEL,
} from '../lib/octree-build.js';

const LINE = new Color('#d5d9de');
const AMBER = new Color('#f0630f');
const SOLID = new Color('#1a1d21');

const EASE_OUT = (t) => 1 - Math.pow(1 - t, 3);

/* Per-section object states. `levels` are opacity multipliers L0..L4. */
const STATES = {
  hero: { levels: [0.2, 0.22, 0.26, 0.38, 0.72], pts: 0.55, dust: 1, solid: 0, contract: 0, rot: 0.055, x: 0.62, y: 0.05, scale: 1, traverse: false, lens: 1 },
  shipped: { levels: [0.07, 0.09, 0.13, 0.24, 0.5], pts: 0.85, dust: 0.8, solid: 0, contract: 0, rot: 0.13, x: 1.15, y: 0.1, scale: 0.62, traverse: true, lens: 0 },
  projects: { levels: [0.04, 0.06, 0.1, 0.22, 0.46], pts: 0.5, dust: 0.8, solid: 0, contract: 0.62, rot: 0.1, x: 1.3, y: 0.35, scale: 0.55, traverse: false, lens: 0 },
  about: { levels: [0.02, 0.02, 0.03, 0.05, 0.09], pts: 0.06, dust: 0.35, solid: 0, contract: 0, rot: 0.015, x: 1.15, y: 0.1, scale: 0.62, traverse: false, lens: 0 },
  contact: { levels: [0.03, 0.04, 0.05, 0.07, 0.12], pts: 0.12, dust: 0.6, solid: 0.95, contract: 0, rot: 0.04, x: 1.05, y: 0.05, scale: 0.72, traverse: false, lens: 1 },
};

/* Load animation timing (seconds). */
const LOAD_DELAY = 0.35;
const LEVEL_STEP = 0.42;
const LEVEL_DUR = 0.62;
const SOLID_FADE_START = 1.15;
const SOLID_FADE_END = 2.35;

/* shared uniforms (one object each, referenced by every material) */
const uLens = { value: new Vector3(-99999, -99999, 1) }; // xy px (GL), z radius px
const uLensStrength = { value: 0 };
const uAgent = { value: new Vector3(999, 999, 999) }; // group-local
const uAgentGlowGlobal = { value: 0 };
const uTime = { value: 0 };

const LATTICE_FRAG_GLOW = /* glsl */ `
  /* amber ring around the pointer with a dark core */
  float dPx = distance(gl_FragCoord.xy, uLens.xy);
  float r = uLens.z;
  float ring = (1.0 - smoothstep(r * 0.55, r, dPx)) * smoothstep(r * 0.12, r * 0.42, dPx);
  float core = 1.0 - smoothstep(r * 0.04, r * 0.26, dPx);
  ring *= uLensStrength;
  core *= uLensStrength;
`;

function lineMaterial(color) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uProgress: { value: 0 },
      uContract: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: color.clone() },
      uGlowColor: { value: AMBER.clone() },
      uAgentGlow: { value: 0 },
      uLens,
      uLensStrength,
      uAgent,
      uAgentGlowGlobal,
    },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute float aDelay;
      uniform float uProgress;
      uniform float uContract;
      uniform vec3 uAgent;
      varying float vA;
      varying float vGlow;
      void main() {
        float t = clamp((uProgress - aDelay * 0.55) / 0.45, 0.0, 1.0);
        float e = 1.0 - pow(1.0 - t, 3.0);
        vec3 center = mix(aCenter, aCenter * 0.22, uContract);
        vec3 pos = center + (position - aCenter) * mix(0.86, 1.0, e);
        vA = e;
        /* proximity of this cell to the travelling agent */
        vGlow = 1.0 - smoothstep(0.12, 0.62, distance(aCenter, uAgent));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform vec3 uColor;
      uniform vec3 uGlowColor;
      uniform float uOpacity;
      uniform float uAgentGlow;
      uniform float uAgentGlowGlobal;
      uniform vec3 uLens;
      uniform float uLensStrength;
      varying float vA;
      varying float vGlow;
      void main() {
        float a = vA * uOpacity;
        ${LATTICE_FRAG_GLOW}
        float agent = vGlow * uAgentGlow * uAgentGlowGlobal;
        vec3 col = mix(uColor, uGlowColor, clamp(ring + agent, 0.0, 1.0));
        a = a * (1.0 - 0.85 * core) + ring * 0.4 * vA + agent * 0.8 * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

/** 12 box edges per cell, merged per level, with per-cell stagger delay. */
function buildLevelLines(levelData) {
  const { cells, half } = levelData;
  const positions = new Float32Array(cells.length * 24 * 3);
  const centers = new Float32Array(cells.length * 24 * 3);
  const delays = new Float32Array(cells.length * 24);

  const E = [
    [-1, -1, -1, 1, -1, -1], [-1, 1, -1, 1, 1, -1], [-1, -1, 1, 1, -1, 1], [-1, 1, 1, 1, 1, 1],
    [-1, -1, -1, -1, 1, -1], [1, -1, -1, 1, 1, -1], [-1, -1, 1, -1, 1, 1], [1, -1, 1, 1, 1, 1],
    [-1, -1, -1, -1, -1, 1], [1, -1, -1, 1, -1, 1], [-1, 1, -1, -1, 1, 1], [1, 1, -1, 1, 1, 1],
  ];

  let p = 0;
  let d = 0;
  cells.forEach((c, i) => {
    const hash = Math.abs(Math.sin(i * 12.9898 + c.ix * 78.233)) % 1;
    const sweep = (c.x + c.y * 0.6 + 3) / 6;
    const delay = Math.min(0.98, sweep * 0.45 + hash * 0.5);

    for (const [ax, ay, az, bx, by, bz] of E) {
      positions[p] = c.x + ax * half; positions[p + 1] = c.y + ay * half; positions[p + 2] = c.z + az * half;
      positions[p + 3] = c.x + bx * half; positions[p + 4] = c.y + by * half; positions[p + 5] = c.z + bz * half;
      for (let k = 0; k < 6; k += 3) {
        centers[p + k] = c.x; centers[p + k + 1] = c.y; centers[p + k + 2] = c.z;
      }
      delays[d] = delay; delays[d + 1] = delay;
      p += 6; d += 2;
    }
  });

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('aCenter', new BufferAttribute(centers, 3));
  geo.setAttribute('aDelay', new BufferAttribute(delays, 1));
  return new LineSegments(geo, lineMaterial(LINE));
}

/** glowing node points at leaf-cell centres */
function buildNodePoints(leaf) {
  const n = leaf.cells.length;
  const positions = new Float32Array(n * 3);
  const seeds = new Float32Array(n);
  leaf.cells.forEach((c, i) => {
    positions[i * 3] = c.x;
    positions[i * 3 + 1] = c.y;
    positions[i * 3 + 2] = c.z;
    seeds[i] = Math.abs(Math.sin(i * 41.7)) % 1;
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new BufferAttribute(seeds, 1));

  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uOpacity: { value: 0 },
      uContract: { value: 0 },
      uColor: { value: AMBER.clone() },
      uBase: { value: LINE.clone() },
      uLens,
      uLensStrength,
      uAgent,
      uAgentGlowGlobal,
      uTime,
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uContract;
      uniform vec3 uAgent;
      uniform float uTime;
      varying float vGlow;
      varying float vTwinkle;
      void main() {
        vec3 pos = mix(position, position * 0.22, uContract);
        vGlow = 1.0 - smoothstep(0.1, 0.55, distance(position, uAgent));
        vTwinkle = 0.6 + 0.4 * sin(uTime * (0.6 + aSeed * 1.4) + aSeed * 40.0);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = (2.2 + vGlow * 6.0) * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform float uOpacity;
      uniform vec3 uColor;
      uniform vec3 uBase;
      uniform vec3 uLens;
      uniform float uLensStrength;
      uniform float uAgentGlowGlobal;
      varying float vGlow;
      varying float vTwinkle;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float m = 1.0 - smoothstep(0.15, 0.5, length(uv));
        ${LATTICE_FRAG_GLOW}
        float agent = vGlow * uAgentGlowGlobal;
        float glow = clamp(ring + agent, 0.0, 1.0);
        vec3 col = mix(uBase, uColor, clamp(glow + 0.35, 0.0, 1.0));
        float a = m * (uOpacity * 0.4 * vTwinkle * (1.0 - 0.9 * core) + glow * 0.85);
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  return new Points(geo, mat);
}

/** ambient dust drifting behind the object */
function buildDust() {
  const N = 320;
  const positions = new Float32Array(N * 3);
  const seeds = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 13;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
    positions[i * 3 + 2] = -1.5 - Math.random() * 4;
    seeds[i * 2] = Math.random();
    seeds[i * 2 + 1] = Math.random();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new BufferAttribute(seeds, 2));

  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uOpacity: { value: 0 },
      uTime,
      uAmber: { value: AMBER.clone() },
      uGrey: { value: new Color('#6b7178') },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aSeed;
      uniform float uTime;
      varying float vTint;
      varying float vFade;
      void main() {
        vTint = step(0.82, aSeed.x); /* ~18% of motes run amber */
        vec3 pos = position;
        pos.y += sin(uTime * (0.05 + aSeed.y * 0.08) + aSeed.x * 40.0) * 0.6;
        pos.x += cos(uTime * (0.03 + aSeed.x * 0.05) + aSeed.y * 40.0) * 0.5;
        vFade = 0.35 + 0.65 * aSeed.y;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = (1.4 + aSeed.x * 2.2) * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform float uOpacity;
      uniform vec3 uAmber;
      uniform vec3 uGrey;
      varying float vTint;
      varying float vFade;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float m = 1.0 - smoothstep(0.1, 0.5, length(uv));
        vec3 col = mix(uGrey, uAmber, vTint);
        float a = m * uOpacity * 0.28 * vFade;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  return new Points(geo, mat);
}

/** soft radial glow texture for the boid halo (generated, no asset) */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export function initOctree({ canvas, readout, posterEl }) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktop = window.matchMedia('(min-width: 64rem)');
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  let renderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch {
    if (posterEl) posterEl.hidden = false;
    canvas.hidden = true;
    return;
  }

  renderer.setClearColor(0x000000, 0);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 30);
  camera.position.set(0, 0.1, 6.2);

  scene.add(new HemisphereLight(0x3d434b, 0x0a0b0d, 1.1));
  const keyLight = new DirectionalLight(0xf2f3f4, 0.65);
  keyLight.position.set(2.5, 3.2, 2.2);
  scene.add(keyLight);
  const rim = new DirectionalLight(0xf0630f, 0.22);
  rim.position.set(-3, -1, -2);
  scene.add(rim);

  const group = new Group();
  const BASE_TILT_X = 0.32;
  group.rotation.x = BASE_TILT_X;
  group.rotation.z = -0.06;
  scene.add(group);

  /* --- geometry: source mass + real sparse octree over it --- */
  const { positions, triCount } = buildSourceMesh(2);
  const { levels, totalNodes } = buildOctree(positions, triCount, MAX_LEVEL);

  const solidGeo = new BufferGeometry();
  solidGeo.setAttribute('position', new BufferAttribute(positions, 3));
  solidGeo.computeVertexNormals();
  const solidMat = new MeshLambertMaterial({
    color: SOLID,
    flatShading: true,
    transparent: true,
    opacity: 1,
  });
  const solid = new Mesh(solidGeo, solidMat);
  group.add(solid);

  const edgeMat = new LineBasicMaterial({
    color: LINE,
    transparent: true,
    opacity: 0.14,
  });
  const edges = new LineSegments(new EdgesGeometry(solidGeo, 12), edgeMat);
  group.add(edges);

  const levelLines = levels.map((lv) => {
    const lines = buildLevelLines(lv);
    group.add(lines);
    return lines;
  });
  /* cells glow near the agent on the two deepest levels */
  levelLines[MAX_LEVEL].material.uniforms.uAgentGlow.value = 1;
  levelLines[MAX_LEVEL - 1].material.uniforms.uAgentGlow.value = 0.45;

  const leaf = levels[levels.length - 1];
  const nodePoints = buildNodePoints(leaf);
  group.add(nodePoints);

  const dust = buildDust();
  scene.add(dust);

  /* --- A* agent: a boid flying the lattice --- */
  const { neighbours } = buildLeafGraph(leaf);
  const leafSize = leaf.half * 2 * 0.92;

  const boid = new Group();
  const cone = new Mesh(
    new ConeGeometry(leafSize * 0.3, leafSize * 0.95, 6),
    new MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0 })
  );
  boid.add(cone);
  const halo = new Sprite(
    new SpriteMaterial({
      map: makeGlowTexture(),
      color: AMBER,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    })
  );
  halo.scale.setScalar(leafSize * 5);
  boid.add(halo);
  group.add(boid);

  /* the goal: an amber cell burning until the boid hits it */
  const goalGeo = new BoxGeometry(leafSize, leafSize, leafSize);
  const goal = new Group();
  const goalFill = new Mesh(
    goalGeo,
    new MeshBasicMaterial({
      color: AMBER,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: AdditiveBlending,
    })
  );
  const goalEdges = new LineSegments(
    new EdgesGeometry(goalGeo),
    new LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9 })
  );
  goal.add(goalFill);
  goal.add(goalEdges);
  goal.visible = false;
  group.add(goal);

  /* planned path: dim line ahead, hot line filling in behind the agent */
  const PATH_MAX = 1024;
  function pathLineOf(opacityMax, blending) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(PATH_MAX * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new Line(
      geo,
      new LineBasicMaterial({
        color: AMBER,
        transparent: true,
        opacity: 0,
        depthTest: false,
        blending,
      })
    );
    line.renderOrder = 3;
    line.userData.opacityMax = opacityMax;
    group.add(line);
    return line;
  }
  const pathDim = pathLineOf(0.22, undefined);
  const pathHot = pathLineOf(0.85, AdditiveBlending);

  let path = null; // cell indices
  let smooth = null; // [{x,y,z}] smoothed points
  let segLen = null; // cumulative lengths
  let travel = 0; // distance travelled along smooth path
  let totalLen = 0;
  let cursorCell = Math.floor(leaf.cells.length * 0.31);
  const AGENT_SPEED = 1.35; // world units / s
  const boidDir = new Vector3(0, 1, 0);
  const UP = new Vector3(0, 1, 0);

  function writeLine(line, pts, count) {
    const attr = line.geometry.getAttribute('position');
    const n = Math.min(count, PATH_MAX);
    for (let i = 0; i < n; i++) {
      attr.setXYZ(i, pts[i][0], pts[i][1], pts[i][2]);
    }
    attr.needsUpdate = true;
    line.geometry.setDrawRange(0, n);
  }

  function nextPath() {
    for (let attempts = 0; attempts < 8; attempts++) {
      const goalCell = Math.floor(Math.random() * leaf.cells.length);
      const found = aStar(leaf.cells, neighbours, cursorCell, goalCell);
      if (found && found.length > 6) {
        path = found;
        smooth = chaikin(chaikin(found.map((i) => [leaf.cells[i].x, leaf.cells[i].y, leaf.cells[i].z])));
        segLen = [0];
        for (let i = 1; i < smooth.length; i++) {
          const a = smooth[i - 1];
          const b = smooth[i];
          segLen.push(segLen[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
        }
        totalLen = segLen[segLen.length - 1];
        travel = 0;
        writeLine(pathDim, smooth, smooth.length);
        writeLine(pathHot, smooth, 1);
        const g = leaf.cells[goalCell];
        goal.position.set(g.x, g.y, g.z);
        goal.visible = true;
        cursorCell = goalCell;
        return;
      }
    }
    path = null;
  }

  function moveBoid(dt) {
    if (!smooth) return;
    travel = Math.min(travel + AGENT_SPEED * dt, totalLen);
    // find current segment
    let i = 1;
    while (i < segLen.length - 1 && segLen[i] < travel) i++;
    const a = smooth[i - 1];
    const b = smooth[i];
    const span = Math.max(segLen[i] - segLen[i - 1], 1e-5);
    const t = (travel - segLen[i - 1]) / span;
    boid.position.set(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    );
    boidDir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    cone.quaternion.setFromUnitVectors(UP, boidDir);
    uAgent.value.copy(boid.position);
    writeLine(pathHot, smooth, i + 1);
    if (travel >= totalLen) nextPath(); // hit it — new goal
  }

  /* --- state machine --- */
  const current = {
    levels: [0, 0, 0, 0, 0],
    pts: 0,
    dust: 0,
    solid: 1,
    contract: 0,
    rot: STATES.hero.rot,
    x: STATES.hero.x,
    y: STATES.hero.y,
    scale: 1,
  };
  let target = STATES.hero;
  let loadT = reducedMotion ? Infinity : 0;
  let spin = 0;
  let agentAlpha = 0;

  function setState(name) {
    if (STATES[name]) target = STATES[name];
  }

  const sections = document.querySelectorAll('[data-octree-state]');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) setState(e.target.dataset.octreeState);
      }
    },
    { rootMargin: '-42% 0px -42% 0px' }
  );
  const observeAll = () => sections.forEach((s) => io.observe(s));
  const unobserveAll = () => {
    io.disconnect();
    setState('hero');
  };
  if (desktop.matches) observeAll();
  desktop.addEventListener('change', (e) => (e.matches ? observeAll() : unobserveAll()));

  /* --- pointer: parallax + lens --- */
  const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  if (canHover && !reducedMotion) {
    window.addEventListener(
      'pointermove',
      (e) => {
        const nx = (e.clientX / window.innerWidth) * 2 - 1;
        const ny = (e.clientY / window.innerHeight) * 2 - 1;
        parallax.tx = nx * 0.11;
        parallax.ty = ny * 0.07;
        const rect = canvas.getBoundingClientRect();
        uLens.value.set(
          (e.clientX - rect.left) * dpr,
          (rect.height - (e.clientY - rect.top)) * dpr,
          250 * dpr
        );
      },
      { passive: true }
    );
    window.addEventListener('pointerleave', () => {
      uLens.value.x = -99999;
    });
  }

  /* --- readout --- */
  let lastReadout = '';
  function setReadout(text) {
    if (readout && text !== lastReadout) {
      readout.textContent = text;
      lastReadout = text;
    }
  }

  const cumulative = [];
  levels.reduce((acc, lv) => {
    cumulative.push(acc + lv.cells.length);
    return acc + lv.cells.length;
  }, 0);

  /* --- sizing --- */
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 700 ? 38 : 30;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  const ro = new ResizeObserver(() => {
    resize();
    if (reducedMotion) renderStatic();
  });
  ro.observe(canvas);

  /* pause when out of sight */
  let running = true;
  document.addEventListener('visibilitychange', () => {
    running = document.visibilityState === 'visible';
    if (running) tick(performance.now());
  });
  const canvasIO = new IntersectionObserver(([e]) => {
    const visible = e.isIntersecting;
    if (visible && !running) {
      running = true;
      tick(performance.now());
    }
    if (!visible) running = false;
  });
  if (!desktop.matches) canvasIO.observe(canvas);

  /* --- main loop --- */
  let last = performance.now();

  function tick(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    uTime.value = now / 1000;

    if (loadT !== Infinity) {
      loadT += dt;
      const t = loadT - LOAD_DELAY;
      let shownLevel = 0;
      let nodes = 1;
      levelLines.forEach((lines, i) => {
        const p = Math.max(0, Math.min(1, (t - i * LEVEL_STEP) / LEVEL_DUR));
        lines.material.uniforms.uProgress.value = EASE_OUT(p);
        if (p > 0.05) {
          shownLevel = i;
          nodes = cumulative[i];
        }
      });
      const sf = Math.max(0, Math.min(1, (t - SOLID_FADE_START) / (SOLID_FADE_END - SOLID_FADE_START)));
      current.solid = 1 - sf;
      setReadout(`LEVEL 0${shownLevel} / 0${MAX_LEVEL} · ${nodes} NODES`);
      if (t > MAX_LEVEL * LEVEL_STEP + LEVEL_DUR + 0.2) {
        loadT = Infinity;
      }
    } else {
      levelLines.forEach((l) => (l.material.uniforms.uProgress.value = 1));
    }

    const k = 1 - Math.exp(-dt * 3.2);
    const loadDone = loadT === Infinity;
    for (let i = 0; i < 5; i++) {
      const goalOpacity = loadDone ? target.levels[i] : STATES.hero.levels[i];
      current.levels[i] += (goalOpacity - current.levels[i]) * k;
      levelLines[i].material.uniforms.uOpacity.value = current.levels[i];
      levelLines[i].material.uniforms.uContract.value = current.contract;
    }
    current.pts += ((loadDone ? target.pts : 0) - current.pts) * k;
    current.dust += (target.dust - current.dust) * k;
    nodePoints.material.uniforms.uOpacity.value = current.pts;
    nodePoints.material.uniforms.uContract.value = current.contract;
    dust.material.uniforms.uOpacity.value = current.dust;

    if (loadDone) current.solid += (target.solid - current.solid) * k;
    current.contract += ((loadDone ? target.contract : 0) - current.contract) * k;
    current.rot += (target.rot - current.rot) * k;
    current.x += ((desktop.matches ? target.x : 0) - current.x) * k;
    current.y += (target.y - current.y) * k;
    current.scale += (target.scale - current.scale) * k;

    const lensTarget = loadDone && canHover && !reducedMotion ? target.lens : 0;
    uLensStrength.value += (lensTarget - uLensStrength.value) * k;

    solidMat.opacity = current.solid;
    solidMat.depthWrite = current.solid > 0.5;
    solid.visible = current.solid > 0.01;
    edgeMat.opacity = current.solid * 0.14;
    edges.visible = solid.visible;

    group.position.set(current.x, current.y, 0);
    group.scale.setScalar(current.scale);
    if (!reducedMotion) {
      spin += current.rot * dt;
      parallax.x += (parallax.tx - parallax.x) * (1 - Math.exp(-dt * 2.6));
      parallax.y += (parallax.ty - parallax.y) * (1 - Math.exp(-dt * 2.6));
      group.rotation.y = spin + parallax.x;
      group.rotation.x = BASE_TILT_X + parallax.y * 0.6;
      dust.rotation.y = parallax.x * 0.25;
    }

    /* A* traversal — only while the shipped section drives the state */
    const traversing = loadDone && target.traverse && !reducedMotion;
    if (traversing) {
      if (!path) nextPath();
      if (path) {
        moveBoid(dt);
        const remaining = Math.max(0, Math.round(((totalLen - travel) / Math.max(totalLen, 1e-5)) * path.length));
        setReadout(`A* · ${path.length} NODES · ${remaining} TO GOAL`);
      }
      agentAlpha += (1 - agentAlpha) * k;
    } else {
      agentAlpha += (0 - agentAlpha) * k;
      if (loadDone) setReadout(`LEVEL 0${MAX_LEVEL} / 0${MAX_LEVEL} · ${totalNodes} NODES`);
    }
    uAgentGlowGlobal.value = agentAlpha;
    cone.material.opacity = agentAlpha * 0.95;
    halo.material.opacity = agentAlpha * 0.75;
    boid.visible = agentAlpha > 0.02;
    pathDim.material.opacity = agentAlpha * pathDim.userData.opacityMax;
    pathHot.material.opacity = agentAlpha * pathHot.userData.opacityMax;
    pathDim.visible = pathHot.visible = agentAlpha > 0.02;
    goal.visible = traversing && path !== null;
    if (goal.visible) {
      const pulse = 1.2 + 0.15 * Math.sin(now * 0.005);
      goal.scale.setScalar(pulse);
      goalEdges.material.opacity = 0.65 + 0.3 * Math.sin(now * 0.005);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  /* reduced motion: render the finished lattice once, statically */
  function renderStatic() {
    levelLines.forEach((l, i) => {
      l.material.uniforms.uProgress.value = 1;
      l.material.uniforms.uOpacity.value = STATES.hero.levels[i];
    });
    nodePoints.material.uniforms.uOpacity.value = STATES.hero.pts * 0.6;
    dust.material.uniforms.uOpacity.value = 0.5;
    current.solid = 0;
    solidMat.opacity = 0;
    solid.visible = false;
    edges.visible = false;
    setReadout(`LEVEL 0${MAX_LEVEL} / 0${MAX_LEVEL} · ${totalNodes} NODES`);
    resize();
    renderer.render(scene, camera);
  }

  if (reducedMotion) {
    renderStatic();
    return;
  }

  requestAnimationFrame((n) => {
    last = n;
    tick(n);
  });
}
