/**
 * Non-canvas motion. One system, one easing (CSS owns the curve):
 * blur focus-pull reveals, split lines, and the chapter rail.
 */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  lines.forEach((words_, i) => {
    const outer = document.createElement('span');
    outer.className = 'split-line';
    const inner = document.createElement('span');
    inner.style.setProperty('--line', i);
    inner.textContent = words_.join('');
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

/* ── snap hygiene: a chapter taller than the screen leaves the
   snap candidates, so it can never trap the scroll ─────────── */
function fitSnap() {
  const vh = window.innerHeight;
  document.querySelectorAll('.chapter').forEach((c) => {
    c.classList.toggle('too-tall', c.offsetHeight > vh + 8);
  });
}

/* ── boot ──────────────────────────────────────────────────── */
initReveals();
initRail();
fitSnap();
window.addEventListener('resize', fitSnap, { passive: true });

const splits = [...document.querySelectorAll('[data-split]')];
if (splits.length && !reduced) {
  Promise.all(splits.map(splitLines)).then(() => {
    document.querySelectorAll('.split').forEach((el) => revealIO.observe(el));
  });
} else {
  document.querySelectorAll('.split').forEach((el) => el.classList.add('in'));
}
