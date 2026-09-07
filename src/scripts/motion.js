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

  const idx = Number(step.dataset.step || 0);
  scene.dataset.activeStep = String(idx);
  de.dataset.octStep = String(idx);

  scene.querySelectorAll('.stage__ticks li').forEach((t, i) => {
    t.classList.toggle('on', i === idx);
  });
}

function initSteps() {
  const steps = [...document.querySelectorAll('.step')];
  if (steps.length === 0) return;

  // mark whatever is already on screen so nothing flashes in blurred
  const vh = window.innerHeight || 800;
  let best = null;
  let bestDist = Infinity;
  for (const s of steps) {
    const r = s.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - vh / 2);
    if (r.bottom > 0 && r.top < vh && d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  activate(best || steps[0]);

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) activate(e.target);
      }
    },
    { rootMargin: '-45% 0px -45% 0px' }
  );
  steps.forEach((s) => io.observe(s));
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

/* ── snap hygiene ──────────────────────────────────────────────
   A step taller than the screen leaves the snap candidates so it can
   never trap the scroll. Guarded against a zero-height viewport — a
   hidden or bfcached tab reports 0, which would otherwise mark every
   step too-tall and silently kill snapping. */
let snapTries = 0;
function fitSnap() {
  const vh = window.innerHeight;
  // A hidden or bfcached tab reports 0 and would mark every step
  // too-tall. Don't measure — but don't give up either, or snapping
  // never arms once the tab becomes visible.
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
