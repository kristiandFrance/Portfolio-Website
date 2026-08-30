/**
 * Build-time assets from the same octree code the live scene uses:
 *
 *   public/poster-octree.svg  — static render of the finished lattice
 *                               (noscript / no-WebGL / reduced-motion fallback)
 *   public/og.png             — 1200×630 Open Graph image (text as vector
 *                               paths via fontkit, rasterised with resvg)
 *
 * Run: npm run assets   (outputs are committed, not rebuilt in CI)
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as fontkit from 'fontkit';
import wawoff2 from 'wawoff2';
import { Resvg } from '@resvg/resvg-js';
import { buildSourceMesh, buildOctree, MAX_LEVEL } from '../src/lib/octree-build.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');
mkdirSync(pub, { recursive: true });

/* light instrument palette — keep in sync with global.css tokens */
const INK = '#101317';
const PAPER = '#e8e9eb';
const SIGNAL = '#b23205';
const SOFT = '#5a6169';

/* ------------------------------------------------------------- */
/* Octree → projected line segments                              */
/* ------------------------------------------------------------- */

const { positions, triCount } = buildSourceMesh(2);
const { levels, totalNodes } = buildOctree(positions, triCount, MAX_LEVEL);

// match the scene's resting pose: Euler XYZ (0.32, yaw, -0.06)
const RX = 0.32;
const RY = 0.68;
const RZ = -0.06;

function rotate([x, y, z]) {
  // Rz
  let x1 = x * Math.cos(RZ) - y * Math.sin(RZ);
  let y1 = x * Math.sin(RZ) + y * Math.cos(RZ);
  let z1 = z;
  // Ry
  let x2 = x1 * Math.cos(RY) + z1 * Math.sin(RY);
  let z2 = -x1 * Math.sin(RY) + z1 * Math.cos(RY);
  let y2 = y1;
  // Rx
  let y3 = y2 * Math.cos(RX) - z2 * Math.sin(RX);
  let z3 = y2 * Math.sin(RX) + z2 * Math.cos(RX);
  return [x2, y3, z3];
}

const CUBE_EDGES = [
  [-1, -1, -1, 1, -1, -1], [-1, 1, -1, 1, 1, -1], [-1, -1, 1, 1, -1, 1], [-1, 1, 1, 1, 1, 1],
  [-1, -1, -1, -1, 1, -1], [1, -1, -1, 1, 1, -1], [-1, -1, 1, -1, 1, 1], [1, -1, 1, 1, 1, 1],
  [-1, -1, -1, -1, -1, 1], [1, -1, -1, 1, -1, 1], [-1, 1, -1, -1, 1, 1], [1, 1, -1, 1, 1, 1],
];

function project(v, cx, cy, scale) {
  const [x, y] = rotate(v);
  return [(cx + x * scale).toFixed(1), (cy - y * scale).toFixed(1)];
}

/** unique projected edges for one level, as an SVG path `d` string */
function levelPath(levelData, cx, cy, scale) {
  const seen = new Set();
  const parts = [];
  for (const c of levelData.cells) {
    const h = levelData.half;
    for (const [ax, ay, az, bx, by, bz] of CUBE_EDGES) {
      const a = [c.x + ax * h, c.y + ay * h, c.z + az * h];
      const b = [c.x + bx * h, c.y + by * h, c.z + bz * h];
      const key =
        a[0].toFixed(3) + ',' + a[1].toFixed(3) + ',' + a[2].toFixed(3) + '|' +
        b[0].toFixed(3) + ',' + b[1].toFixed(3) + ',' + b[2].toFixed(3);
      if (seen.has(key)) continue;
      seen.add(key);
      const [pax, pay] = project(a, cx, cy, scale);
      const [pbx, pby] = project(b, cx, cy, scale);
      parts.push(`M${pax} ${pay}L${pbx} ${pby}`);
    }
  }
  return parts.join('');
}

/** one leaf cell filled in --signal: the active node */
function signalCell(cx, cy, scale) {
  const leaf = levels[levels.length - 1];
  const c = leaf.cells[Math.floor(leaf.cells.length * 0.37)];
  const h = leaf.half;
  // front face of the cell as a filled quad
  const q = [
    [c.x - h, c.y - h, c.z + h],
    [c.x + h, c.y - h, c.z + h],
    [c.x + h, c.y + h, c.z + h],
    [c.x - h, c.y + h, c.z + h],
  ].map((p) => project(p, cx, cy, scale));
  return `<path d="M${q[0][0]} ${q[0][1]}L${q[1][0]} ${q[1][1]}L${q[2][0]} ${q[2][1]}L${q[3][0]} ${q[3][1]}Z" fill="${SIGNAL}" fill-opacity="0.85"/>`;
}

const LEVEL_OPACITY = [0.3, 0.3, 0.34, 0.46, 0.8];

function latticeGroup(cx, cy, scale, deepest = MAX_LEVEL) {
  const parts = [];
  for (let i = 0; i <= deepest; i++) {
    parts.push(
      `<path d="${levelPath(levels[i], cx, cy, scale)}" fill="none" stroke="${INK}" stroke-opacity="${LEVEL_OPACITY[i]}" stroke-width="1"/>`
    );
  }
  parts.push(signalCell(cx, cy, scale));
  return parts.join('\n');
}

/* ------------------------------------------------------------- */
/* Poster SVG (hero fallback)                                     */
/* ------------------------------------------------------------- */

const poster = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
${latticeGroup(600, 600, 330)}
</svg>`;

writeFileSync(path.join(pub, 'poster-octree.svg'), poster);
console.log(
  `poster-octree.svg written (${(poster.length / 1024).toFixed(0)} KB, ${totalNodes} nodes)`
);

/* ------------------------------------------------------------- */
/* OG image — text as glyph paths, no font resolution at raster  */
/* ------------------------------------------------------------- */

const fontsDir = path.join(root, 'src', 'assets', 'fonts');

/* fontkit can't instantiate variations directly from WOFF2, so decompress
   to TTF in memory first */
async function loadVariable(file, axes) {
  const woff2 = readFileSync(path.join(fontsDir, file));
  const ttf = Buffer.from(await wawoff2.decompress(woff2));
  return fontkit.create(ttf).getVariation(axes);
}

const display = await loadVariable('bricolage-grotesque-latin-wght-normal.woff2', { wght: 480 });
const mono = await loadVariable('jetbrains-mono-latin-wght-normal.woff2', { wght: 460 });

function textPaths(font, text, size, ox, oy, { tracking = 0, fill = INK } = {}) {
  const scale = size / font.unitsPerEm;
  const run = font.layout(text);
  const parts = [];
  let x = ox;
  for (let i = 0; i < run.glyphs.length; i++) {
    const g = run.glyphs[i];
    const p = run.positions[i];
    const d = g.path.toSVG();
    if (d) {
      parts.push(
        `<path transform="translate(${(x + p.xOffset * scale).toFixed(1)} ${(oy - p.yOffset * scale).toFixed(1)}) scale(${scale.toFixed(5)} ${-scale.toFixed(5)})" d="${d}" fill="${fill}"/>`
      );
    }
    x += p.xAdvance * scale + tracking * size;
  }
  return { svg: parts.join(''), width: x - ox };
}

const eyebrow = textPaths(mono, 'SOFTWARE ENGINEER — AUCKLAND, NZ', 25, 84, 200, {
  tracking: 0.08,
  fill: SOFT,
});
const name = textPaths(display, 'Kristian de France', 92, 80, 302, { tracking: -0.03 });
const sub = textPaths(mono, 'SYSTEMS, ENGINES AND THE THINGS UNDERNEATH GAMES.', 22, 84, 372, {
  tracking: 0.08,
  fill: SOFT,
});

const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${PAPER}"/>
<rect x="24.5" y="24.5" width="1151" height="581" fill="none" stroke="${INK}" stroke-opacity="0.14"/>
<clipPath id="sheet"><rect x="25" y="25" width="1150" height="580"/></clipPath>
<g clip-path="url(#sheet)">${latticeGroup(942, 442, 108, 3)}</g>
${eyebrow.svg}
${name.svg}
${sub.svg}
</svg>`;

const png = new Resvg(og, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
writeFileSync(path.join(pub, 'og.png'), png);
console.log(`og.png written (${(png.length / 1024).toFixed(0)} KB)`);
