/**
 * Non-canvas motion. One system, one easing (CSS owns the curve):
 * blur focus-pull reveals, split lines, the chapter rail, and the step
 * choreography that drives the pinned scenes.
 */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const de = document.documentElement;

/* ── split the statement into masked lines ─────────────────── */
async function splitLines(el) {
  const text = el.textContent.trim();
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* measure with fallback metrics */
    }
  }
  const words = text.split(/\s+/);
  el.textContent = '';
  const frag = document.createDocumentFragment();
  const spans = words.map((w) => {
    const s = document.createElement('span');
    s.textContent = w + ' ';
    frag.appendChild(s);
    return s;
  });
  el.appendChild(frag);

  const lines = [];
  let lastTop = null;
  for (const s of spans) {
    const top = s.offsetTop;
    if (top !== lastTop) {
      lines.push([]);
      lastTop = top;
    }
    lines[lines.length - 1].push(s.textContent);
  }

  el.textContent = '';
  lines.forEach((ws, i) => {
    const outer = document.createElement('span');
    outer.className = 'split-line';
    const inner = document.createElement('span');
    inner.style.setProperty('--line', i);
    inner.textContent = ws.join('');
    outer.appendChild(inner);
    el.appendChild(outer);
  });
}

/* ── reveal on scroll ──────────────────────────────────────── */
const revealIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      revealIO.unobserve(e.target);
    }
  },
  { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
);

function initReveals() {
  document.querySelectorAll('[data-reveal]').forEach((el) => revealIO.observe(el));
}

/* ── steps: which part of a scene you are on ───────────────────
   The active step gets `.on` (everything else sits back through the
   focus-pull), its scene's ticks update, and the step index is
   published on <html> so the 3D scene can roll the object to match. */
function activate(step) {
  if (!step || step.classList.contains('on')) return;
  const scene = step.closest('.scene');
  if (!scene) return;

  scene.querySelectorAll(':scope > .step').forEach((s) => s.classList.remove('on'));
  step.classList.add('on');

  document.querySelectorAll('.scene--on').forEach((el) => {
    if (el !== scene) el.classList.remove('scene--on');
  });
  scene.classList.add('scene--on');

  const idx = Number(step.dataset.step || 0);
  scene.dataset.activeStep = String(idx);
  de.dataset.octStep = String(idx);

  scene.querySelectorAll('.stage__ticks li').forEach((t, i) => {
    t.classList.toggle('on', i === idx);
  });
}

/* Which step is live is computed from geometry on every scroll frame,
   not inferred from observer callbacks. An observer can miss; measuring
   cannot, and a wrong answer here used to blank the page. */
let allSteps = [];
let stepTick = 0;

function syncSteps() {
  stepTick = 0;
  const vh = window.innerHeight;
  if (vh < 200 || allSteps.length === 0) return;
  const mid = vh / 2;

  let best = null;
  let bestD = Infinity;
  for (const s of allSteps) {
    const r = s.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= vh) continue; // off screen entirely
    const d = Math.abs(r.top + r.height / 2 - mid);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (!best) return;

  activate(best);

  // dim only the other steps of the SAME scene, and only while their
  // own scene is the live one
  const scene = best.closest('.scene');
  for (const s of allSteps) {
    const same = s.closest('.scene') === scene;
    s.classList.toggle('off', same && s !== best);
  }
}

function onScrollSteps() {
  if (stepTick) return;
  stepTick = requestAnimationFrame(syncSteps);
}

function initSteps() {
  allSteps = [...document.querySelectorAll('.step')];
  if (allSteps.length === 0) return;
  syncSteps();
  window.addEventListener('scroll', onScrollSteps, { passive: true });
  window.addEventListener('resize', onScrollSteps, { passive: true });
}

/* ── chapter rail ──────────────────────────────────────────── */
function initRail() {
  const rail = document.querySelector('.rail');
  if (!rail) return;
  const items = new Map();
  rail.querySelectorAll('li[data-rail]').forEach((li) => {
    const t = document.getElementById(li.dataset.rail);
    if (t) items.set(t, li);
  });
  if (items.size === 0) return;

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        items.forEach((li) => li.classList.remove('on'));
        items.get(e.target)?.classList.add('on');
      }
    },
    { rootMargin: '-48% 0px -48% 0px' }
  );
  items.forEach((_, t) => io.observe(t));
}

/* a step taller than the screen leaves the stop list entirely */
let snapTries = 0;
function fitSnap() {
  const vh = window.innerHeight;
  if (vh < 200) {
    if (snapTries++ < 60) setTimeout(fitSnap, 250);
    return;
  }
  snapTries = 0;
  document.querySelectorAll('.step').forEach((s) => {
    s.classList.toggle('too-tall', s.offsetHeight > vh + 8);
  });
  de.classList.add('snap-ready');
}

let snapTimer;
function fitSnapSoon() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(fitSnap, 120);
}

/* ── boot ──────────────────────────────────────────────────── */
initReveals();
initSteps();
initRail();
fitSnap();

window.addEventListener('resize', fitSnapSoon, { passive: true });
// catches size changes that never fire a window resize (panes, emulation)
new ResizeObserver(fitSnapSoon).observe(de);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') fitSnapSoon();
});
window.addEventListener('load', fitSnapSoon);
document.addEventListener('site:ready', fitSnapSoon);
document.fonts?.ready?.then(fitSnapSoon).catch(() => {});

const splits = [...document.querySelectorAll('[data-split]')];
if (splits.length && !reduced) {
  Promise.all(splits.map(splitLines)).then(() => {
    document.querySelectorAll('.split').forEach((el) => revealIO.observe(el));
    fitSnapSoon();
  });
} else {
  document.querySelectorAll('.split').forEach((el) => el.classList.add('in'));
}
