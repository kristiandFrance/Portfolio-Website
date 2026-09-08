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

/* ── snap: tweened, not CSS ────────────────────────────────────
   The browser's own snap lands instantly, which reads as rigid, and it
   refuses to let the footer sit on screen. So we settle to the nearest
   stop ourselves, over a duration scaled by distance (ESQRD run 0.8s to
   1.8s the same way) on the site easing.

   Two things this must never do: refuse to move because the stop is
   "too far" (steps sit exactly one screen apart, so the midpoint is
   half a screen from either — that is what left it stuck halfway), and
   abort because a trackpad is still coasting (momentum keeps firing
   wheel events for about a second after your fingers stop). */
const SNAP_MIN = 780;
const SNAP_MAX = 1600;
const WHEEL_INTENT = 10; // px of deliberate input needed to take over
let snapRAF = 0;
let snapping = false;
let programmatic = false;
let idleTimer = 0;

function stops() {
  const y = window.scrollY;
  const list = [...document.querySelectorAll('.step')]
    .filter((el) => !el.classList.contains('too-tall'))
    .map((el) => el.getBoundingClientRect().top + y);
  const footer = document.querySelector('.ftr');
  if (footer) list.push(footer.getBoundingClientRect().top + y - 8);
  return list;
}

function cancelSnap() {
  if (snapRAF) cancelAnimationFrame(snapRAF);
  snapRAF = 0;
  snapping = false;
  programmatic = false;
}

function tweenTo(target) {
  const start = window.scrollY;
  const delta = target - start;
  if (Math.abs(delta) < 3) return;

  // longer trips take longer, so nothing ever feels yanked
  const span = Math.min(1, Math.abs(delta) / Math.max(window.innerHeight, 1));
  const dur = SNAP_MIN + (SNAP_MAX - SNAP_MIN) * span;

  const t0 = performance.now();
  snapping = true;
  const frame = (now) => {
    if (!snapping) return;
    const p = Math.min(1, (now - t0) / dur);
    const e = 0.5 - 0.5 * Math.cos(Math.PI * p); // sine.inOut
    programmatic = true;
    window.scrollTo(0, start + delta * e);
    programmatic = false;
    if (p < 1) snapRAF = requestAnimationFrame(frame);
    else cancelSnap();
  };
  snapRAF = requestAnimationFrame(frame);
}

function settle() {
  if (snapping || reduced) return;
  const vh = window.innerHeight;
  if (vh < 200 || !de.classList.contains('snap')) return;
  // leave the very bottom alone so the footer stays readable
  if (window.scrollY >= de.scrollHeight - vh - 4) return;

  const y = window.scrollY;
  let best = null;
  let bestD = Infinity;
  for (const t of stops()) {
    const d = Math.abs(t - y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  // always finish the journey — no reach limit, or you stall mid-step
  if (best !== null && bestD > 3) tweenTo(Math.round(best));
}

function onScroll() {
  if (programmatic) return; // our own tween must not restart the clock
  clearTimeout(idleTimer);
  idleTimer = setTimeout(settle, 170);
}

if (!reduced) {
  window.addEventListener('scroll', onScroll, { passive: true });
  // only deliberate input takes over; coasting momentum does not
  window.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) >= WHEEL_INTENT) cancelSnap();
    },
    { passive: true }
  );
  ['touchstart', 'keydown', 'pointerdown'].forEach((ev) =>
    window.addEventListener(ev, cancelSnap, { passive: true })
  );
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
