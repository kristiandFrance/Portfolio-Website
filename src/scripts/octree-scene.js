/**
 * The hero object: a solid mass that takes itself apart.
 *
 * v4 — formal light instrument. Ink hairline lattice on cool paper, one
 * copper accent reserved for highlights:
 *
 *  - load: the solid subdivides into the sparse lattice (real octree,
 *    real node counts in the readout)
 *  - shipped: an A* boid flies the lattice — nearby cells tint copper,
 *    the goal cell is marked until the boid hits it, the planned path is
 *    drawn dim and filled in behind the agent, a short trail follows
 *  - projects: the lattice contracts to a dense cluster
 *  - about: fades to near-nothing
 *  - contact: reassembles into the solid it started as
 *
 * Pointer: gentle parallax, and in the hero a feathered lens that fades
 * the lattice to reveal the solid object it encapsulates.
 *
 * Every taste constant lives in TUNING below — adjust there, nowhere else.
 */

import {
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

/* ------------------------------------------------------------------ */
/* TUNING — every visual constant in one place                         */
/* ------------------------------------------------------------------ */
const TUNING = {
  ink: '#101317', // lattice lines
  copper: '#b23205', // the accent — boid, goal, path, cell tint
  solid: '#f2f3f4', // the pale mass

  lens: {
    radiusPx: 150, // feathered reveal circle
    latticeFade: 0.12, // lattice alpha multiplier at the centre
    solidShow: 0.92, // solid alpha inside the circle
  },

  agent: {
    speed: 1.35, // world units / s
    tintRadius: 0.26, // cells within this range tint copper
    tintAlphaLift: 0.3, // max extra line alpha near the boid
    haloScale: 2.0, // × leaf size
    haloOpacity: 0.25,
    trailCount: 16,
    trailLife: 1.1, // seconds
    trailOpacity: 0.3,
    goalFill: 0.15,
    goalPulseMax: 0.8,
  },

  pathDimOpacity: 0.18,
  pathHotOpacity: 0.6,

  parallax: { yaw: 0.11, pitch: 0.07 },

  load: {
    delay: 0.35,
    levelStep: 0.42,
    levelDur: 0.62,
    solidFadeStart: 1.15,
    solidFadeEnd: 2.35,
  },
};

const INK = new Color(TUNING.ink);
const COPPER = new Color(TUNING.copper);
const SOLID = new Color(TUNING.solid);

const EASE_OUT = (t) => 1 - Math.pow(1 - t, 3);

/* Per-section object states. `levels` are opacity multipliers L0..L4.
 *
 * Composition rule: the object gets three deliberate moments — hero
 * (subdivide), statement (the A* boid crosses it), contact (reassemble).
 * Chapters carrying their own media (shipped, projects, jam, about) park
 * it off the right edge, so it can never overlap a page asset.
 *
 * `sx` is the object's centre as a fraction of viewport width (0 = left
 * edge, 1 = right edge) and is converted to world units against the live
 * aspect ratio each frame — so the composition holds at any window shape,
 * which a fixed world x does not. `y` stays in world units: the vertical
 * field of view is constant, so vertical framing never drifts. */
const STATES = {
  hero: { levels: [0.3, 0.3, 0.34, 0.46, 0.8], solid: 0, contract: 0, rot: 0.055, sx: 0.6, y: 0.05, scale: 1, traverse: false, lens: 1 },
  statement: { levels: [0.16, 0.18, 0.22, 0.34, 0.66], solid: 0, contract: 0, rot: 0.09, sx: 0.78, y: 0.05, scale: 0.65, traverse: true, lens: 0 },
  shipped: { levels: [0.02, 0.02, 0.03, 0.04, 0.07], solid: 0, contract: 0, rot: 0.05, sx: 1.15, y: 0.3, scale: 0.45, traverse: false, lens: 0 },
  projects: { levels: [0.02, 0.02, 0.03, 0.04, 0.07], solid: 0, contract: 0.62, rot: 0.05, sx: 1.15, y: 0.3, scale: 0.45, traverse: false, lens: 0 },
  about: { levels: [0.02, 0.02, 0.02, 0.03, 0.05], solid: 0, contract: 0, rot: 0.015, sx: 1.15, y: 0.1, scale: 0.5, traverse: false, lens: 0 },
  contact: { levels: [0.04, 0.05, 0.06, 0.08, 0.14], solid: 0.95, contract: 0, rot: 0.04, sx: 0.84, y: 0.05, scale: 0.6, traverse: false, lens: 0 },
};

/* shared uniforms (one object each, referenced by every material) */
const uLens = { value: new Vector3(-99999, -99999, 1) }; // xy px (GL), z radius px
const uLensStrength = { value: 0 };
const uAgent = { value: new Vector3(999, 999, 999) }; // group-local
const uAgentAmt = { value: 0 };

function lineMaterial(color) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uProgress: { value: 0 },
      uContract: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: color.clone() },
      uCopper: { value: COPPER.clone() },
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
        vec3 center = mix(aCenter, aCenter * 0.22, uContract);
        vec3 pos = center + (position - aCenter) * mix(0.86, 1.0, e);
        vA = e;
        vNear = 1.0 - smoothstep(${(TUNING.agent.tintRadius * 0.3).toFixed(3)}, ${TUNING.agent.tintRadius.toFixed(3)}, distance(aCenter, uAgent));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform vec3 uColor;
      uniform vec3 uCopper;
      uniform float uOpacity;
      uniform float uAgentGlow;
      uniform float uAgentAmt;
      uniform vec3 uLens;
      uniform float uLensStrength;
      varying float vA;
      varying float vNear;
      void main() {
        float a = vA * uOpacity;
        /* feathered reveal lens: lattice thins near the pointer */
        float d = distance(gl_FragCoord.xy, uLens.xy);
        float outside = smoothstep(uLens.z * 0.35, uLens.z, d);
        a *= mix(1.0 - (1.0 - ${TUNING.lens.latticeFade}) * uLensStrength, 1.0, outside);
        /* copper tint near the travelling agent — a highlight, not a light */
        float near = vNear * uAgentGlow * uAgentAmt;
        vec3 col = mix(uColor, uCopper, clamp(near, 0.0, 1.0));
        a += near * ${TUNING.agent.tintAlphaLift} * vA;
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
  return new LineSegments(geo, lineMaterial(INK));
}

/** soft radial texture for the boid halo (generated, no asset) */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export function initOctree({ canvas, posterEl }) {
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

  scene.add(new HemisphereLight(0xffffff, 0xd8dadd, 1.05));
  const keyLight = new DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(2.5, 3.2, 2.2);
  scene.add(keyLight);

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
  /* the reveal lens shows the solid inside the feathered circle even when
     its base opacity is 0 — injected into the stock Lambert shader */
  solidMat.onBeforeCompile = (shader) => {
    shader.uniforms.uLens = uLens;
    shader.uniforms.uLensStrength = uLensStrength;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uLens;\nuniform float uLensStrength;'
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float dLens = distance(gl_FragCoord.xy, uLens.xy);
        float mLens = (1.0 - smoothstep(uLens.z * 0.35, uLens.z, dLens)) * uLensStrength;
        gl_FragColor.a = max(gl_FragColor.a, mLens * ${TUNING.lens.solidShow});`
      );
  };
  const solid = new Mesh(solidGeo, solidMat);
  group.add(solid);

  const edgeMat = new LineBasicMaterial({
    color: INK,
    transparent: true,
    opacity: 0.16,
  });
  const edges = new LineSegments(new EdgesGeometry(solidGeo, 12), edgeMat);
  group.add(edges);

  const levelLines = levels.map((lv) => {
    const lines = buildLevelLines(lv);
    group.add(lines);
    return lines;
  });
  /* cells tint near the agent on the two deepest levels */
  levelLines[MAX_LEVEL].material.uniforms.uAgentGlow.value = 1;
  levelLines[MAX_LEVEL - 1].material.uniforms.uAgentGlow.value = 0.45;

  /* --- A* agent: a boid flying the lattice --- */
  const leaf = levels[levels.length - 1];
  const { neighbours } = buildLeafGraph(leaf);
  const leafSize = leaf.half * 2 * 0.92;

  const boid = new Group();
  const cone = new Mesh(
    new ConeGeometry(leafSize * 0.3, leafSize * 0.95, 6),
    new MeshBasicMaterial({ color: COPPER, transparent: true, opacity: 0 })
  );
  boid.add(cone);
  const halo = new Sprite(
    new SpriteMaterial({
      map: makeGlowTexture(),
      color: COPPER,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
  );
  halo.scale.setScalar(leafSize * TUNING.agent.haloScale);
  boid.add(halo);
  group.add(boid);

  /* the goal: a copper-marked cell, held until the boid hits it */
  const goalGeo = new BoxGeometry(leafSize, leafSize, leafSize);
  const goal = new Group();
  const goalFill = new Mesh(
    goalGeo,
    new MeshBasicMaterial({
      color: COPPER,
      transparent: true,
      opacity: TUNING.agent.goalFill,
      depthWrite: false,
    })
  );
  const goalEdges = new LineSegments(
    new EdgesGeometry(goalGeo),
    new LineBasicMaterial({ color: COPPER, transparent: true, opacity: 0.8 })
  );
  goal.add(goalFill);
  goal.add(goalEdges);
  goal.visible = false;
  group.add(goal);

  /* planned path: dim line ahead, filled in behind the agent */
  const PATH_MAX = 1024;
  function makePathLine(opacityMax) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(PATH_MAX * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new Line(
      geo,
      new LineBasicMaterial({ color: COPPER, transparent: true, opacity: 0, depthTest: false })
    );
    line.renderOrder = 3;
    line.userData.opacityMax = opacityMax;
    group.add(line);
    return line;
  }
  const pathDim = makePathLine(TUNING.pathDimOpacity);
  const pathHot = makePathLine(TUNING.pathHotOpacity);

  /* short fading trail behind the boid — the sense of flow */
  const TRAIL_N = TUNING.agent.trailCount;
  const trailGeo = new BufferGeometry();
  trailGeo.setAttribute('position', new BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
  trailGeo.setAttribute('aAge', new BufferAttribute(new Float32Array(TRAIL_N).fill(1), 1));
  const trailMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: COPPER.clone() },
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aAge;
      varying float vAge;
      void main() {
        vAge = aAge;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (4.5 * (1.0 - aAge) + 1.5) * (300.0 / -mv.z) * 0.02;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAge;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float m = 1.0 - smoothstep(0.2, 0.5, length(uv));
        float a = m * uOpacity * (1.0 - vAge) * ${TUNING.agent.trailOpacity};
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const trail = new Points(trailGeo, trailMat);
  trail.renderOrder = 4;
  group.add(trail);
  const trailAges = new Float32Array(TRAIL_N).fill(1);
  let trailHead = 0;
  let trailTimer = 0;

  let path = null;
  let smooth = null;
  let segLen = null;
  let travel = 0;
  let totalLen = 0;
  let cursorCell = Math.floor(leaf.cells.length * 0.31);
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
    travel = Math.min(travel + TUNING.agent.speed * dt, totalLen);
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

    /* drop a trail point on a fixed cadence */
    trailTimer += dt;
    if (trailTimer > TUNING.agent.trailLife / TRAIL_N) {
      trailTimer = 0;
      const attr = trailGeo.getAttribute('position');
      attr.setXYZ(trailHead, boid.position.x, boid.position.y, boid.position.z);
      attr.needsUpdate = true;
      trailAges[trailHead] = 0;
      trailHead = (trailHead + 1) % TRAIL_N;
    }

    if (travel >= totalLen) nextPath(); // hit it — new goal
  }

  /* --- state machine --- */
  const current = {
    levels: [0, 0, 0, 0, 0],
    solid: 1,
    contract: 0,
    rot: STATES.hero.rot,
    x: 0, // snapped to the hero position on the first frame, once sized
    y: STATES.hero.y,
    scale: 1,
  };
  let placed = false;
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

  /* --- pointer: parallax + reveal lens --- */
  const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  if (canHover && !reducedMotion) {
    window.addEventListener(
      'pointermove',
      (e) => {
        const nx = (e.clientX / window.innerWidth) * 2 - 1;
        const ny = (e.clientY / window.innerHeight) * 2 - 1;
        parallax.tx = nx * TUNING.parallax.yaw;
        parallax.ty = ny * TUNING.parallax.pitch;
        const rect = canvas.getBoundingClientRect();
        uLens.value.set(
          (e.clientX - rect.left) * dpr,
          (rect.height - (e.clientY - rect.top)) * dpr,
          TUNING.lens.radiusPx * dpr
        );
      },
      { passive: true }
    );
    window.addEventListener('pointerleave', () => {
      uLens.value.x = -99999;
    });
  }

  /* --- readouts (hero + statement both carry one) --- */
  const readouts = [...document.querySelectorAll('[data-octree-readout]')];
  let lastReadout = '';
  function setReadout(text) {
    if (text === lastReadout) return;
    lastReadout = text;
    for (const el of readouts) el.textContent = text;
  }

  const cumulative = [];
  levels.reduce((acc, lv) => {
    cumulative.push(acc + lv.cells.length);
    return acc + lv.cells.length;
  }, 0);

  /* --- sizing --- */
  /* half-extents of the view at the object's depth, so screen-fraction
     positions in STATES can be converted to world units */
  let viewHalfW = 3;
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 700 ? 38 : 30;
    camera.updateProjectionMatrix();
    const halfH = Math.tan(((camera.fov / 2) * Math.PI) / 180) * camera.position.z;
    viewHalfW = halfH * camera.aspect;
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

    if (loadT !== Infinity) {
      loadT += dt;
      const t = loadT - TUNING.load.delay;
      let shownLevel = 0;
      let nodes = 1;
      levelLines.forEach((lines, i) => {
        const p = Math.max(0, Math.min(1, (t - i * TUNING.load.levelStep) / TUNING.load.levelDur));
        lines.material.uniforms.uProgress.value = EASE_OUT(p);
        if (p > 0.05) {
          shownLevel = i;
          nodes = cumulative[i];
        }
      });
      const sf = Math.max(
        0,
        Math.min(1, (t - TUNING.load.solidFadeStart) / (TUNING.load.solidFadeEnd - TUNING.load.solidFadeStart))
      );
      current.solid = 1 - sf;
      setReadout(`LEVEL 0${shownLevel} / 0${MAX_LEVEL} · ${nodes} NODES`);
      if (t > MAX_LEVEL * TUNING.load.levelStep + TUNING.load.levelDur + 0.2) {
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
    if (loadDone) current.solid += (target.solid - current.solid) * k;
    current.contract += ((loadDone ? target.contract : 0) - current.contract) * k;
    current.rot += (target.rot - current.rot) * k;
    const targetX = desktop.matches ? (target.sx * 2 - 1) * viewHalfW : 0;
    if (!placed) {
      placed = true;
      current.x = targetX; // no drift-in on load
    }
    current.x += (targetX - current.x) * k;
    current.y += (target.y - current.y) * k;
    current.scale += (target.scale - current.scale) * k;

    const lensTarget = loadDone && canHover && !reducedMotion ? target.lens : 0;
    uLensStrength.value += (lensTarget - uLensStrength.value) * k;

    solidMat.opacity = current.solid;
    solidMat.depthWrite = current.solid > 0.5;
    solid.visible = current.solid > 0.01 || uLensStrength.value > 0.02;
    edgeMat.opacity = current.solid * 0.16;
    edges.visible = current.solid > 0.01;

    group.position.set(current.x, current.y, 0);
    group.scale.setScalar(current.scale);
    if (!reducedMotion) {
      spin += current.rot * dt;
      parallax.x += (parallax.tx - parallax.x) * (1 - Math.exp(-dt * 2.6));
      parallax.y += (parallax.ty - parallax.y) * (1 - Math.exp(-dt * 2.6));
      group.rotation.y = spin + parallax.x;
      group.rotation.x = BASE_TILT_X + parallax.y * 0.6;
    }

    /* A* traversal — only while the shipped section drives the state */
    const traversing = loadDone && target.traverse && !reducedMotion;
    if (traversing) {
      if (!path) nextPath();
      if (path) {
        moveBoid(dt);
        const remaining = Math.max(
          0,
          Math.round(((totalLen - travel) / Math.max(totalLen, 1e-5)) * path.length)
        );
        setReadout(`A* · ${path.length} NODES · ${remaining} TO GOAL`);
      }
      agentAlpha += (1 - agentAlpha) * k;
    } else {
      agentAlpha += (0 - agentAlpha) * k;
      if (loadDone) setReadout(`LEVEL 0${MAX_LEVEL} / 0${MAX_LEVEL} · ${totalNodes} NODES`);
    }
    uAgentAmt.value = agentAlpha;
    cone.material.opacity = agentAlpha;
    halo.material.opacity = agentAlpha * TUNING.agent.haloOpacity;
    boid.visible = agentAlpha > 0.02;
    pathDim.material.opacity = agentAlpha * pathDim.userData.opacityMax;
    pathHot.material.opacity = agentAlpha * pathHot.userData.opacityMax;
    pathDim.visible = pathHot.visible = agentAlpha > 0.02;
    trailMat.uniforms.uOpacity.value = agentAlpha;
    trail.visible = agentAlpha > 0.02;
    for (let i = 0; i < TRAIL_N; i++) {
      if (trailAges[i] < 1) {
        trailAges[i] = Math.min(1, trailAges[i] + dt / TUNING.agent.trailLife);
      }
    }
    trailGeo.getAttribute('aAge').set(trailAges);
    trailGeo.getAttribute('aAge').needsUpdate = true;

    goal.visible = traversing && path !== null;
    if (goal.visible) {
      const pulse = 1.2 + 0.12 * Math.sin(now * 0.005);
      goal.scale.setScalar(pulse);
      goalEdges.material.opacity =
        TUNING.agent.goalPulseMax - 0.2 + 0.2 * Math.sin(now * 0.005);
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
    current.solid = 0;
    solidMat.opacity = 0;
    solid.visible = false;
    edges.visible = false;
    setReadout(`LEVEL 0${MAX_LEVEL} / 0${MAX_LEVEL} · ${totalNodes} NODES`);
    resize();
    /* frame it exactly as the animated hero does */
    group.position.set(
      desktop.matches ? (STATES.hero.sx * 2 - 1) * viewHalfW : 0,
      STATES.hero.y,
      0
    );
    group.scale.setScalar(STATES.hero.scale);
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
