/**
 * All non-canvas motion, one system: IntersectionObserver toggling classes,
 * CSS custom properties doing the timing, plus one rAF-throttled scroll
 * parallax for the handful of [data-parallax] elements.
 */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---- Split the statement into masked lines (sr-only copy is static) ---- */
async function splitLines(el) {
  const text = el.textContent.trim();
  // measure word positions with the real font
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* measure with fallback metrics */
    }
  }
  const words = text.split(/\s+/);
  el.textContent = '';
  const probe = document.createDocumentFragment();
  const spans = words.map((w) => {
    const s = document.createElement('span');
    s.textContent = w + ' ';
    probe.appendChild(s);
    return s;
  });
  el.appendChild(probe);

  // group by rendered line
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
  lines.forEach((lineWords, i) => {
    const outer = document.createElement('span');
    outer.className = 'split-line';
    const inner = document.createElement('span');
    inner.style.setProperty('--line', i);
    inner.textContent = lineWords.join('');
    outer.appendChild(inner);
    el.appendChild(outer);
  });
}

async function initSplits() {
  const els = document.querySelectorAll('[data-split]');
  for (const el of els) {
    if (!reducedMotion) await splitLines(el);
  }
}

/* ---- Reveal-on-scroll ---- */
const revealIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      if (e.target.classList.contains('has-col-rule')) e.target.classList.add('in-view');
      revealIO.unobserve(e.target);
    }
  },
  { threshold: 0.2, rootMargin: '0px 0px -5% 0px' }
);

function initReveals() {
  document.querySelectorAll('[data-reveal], .has-col-rule').forEach((el) => revealIO.observe(el));
}

/* ---- Depth rail: mark the section the viewport centre is inside ---- */
function initDepthRail() {
  const rail = document.querySelector('.depth-rail');
  if (!rail) return;
  const items = new Map();
  rail.querySelectorAll('a[href^="#"]').forEach((a) => {
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (target) items.set(target, a.parentElement);
  });

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        items.forEach((li) => li.classList.remove('active'));
        items.get(e.target)?.classList.add('active');
      }
    },
    { rootMargin: '-45% 0px -45% 0px' }
  );
  items.forEach((_, target) => io.observe(target));
}

/* ---- Scroll parallax: element drifts against scroll, centre-relative ---- */
function initParallax() {
  if (reducedMotion) return;
  const els = [...document.querySelectorAll('[data-parallax]')].map((el) => ({
    el,
    speed: parseFloat(el.dataset.parallax) || 0.05,
  }));
  if (els.length === 0) return;

  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = window.innerHeight;
    for (const { el, speed } of els) {
      const r = el.getBoundingClientRect();
      const mid = r.top + r.height / 2 - vh / 2;
      el.style.setProperty('--py', `${(-mid * speed).toFixed(1)}px`);
    }
  };
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true }
  );
  update();
}

/* reveals first (nothing waits on fonts), then the statement split
   joins the same observer once its lines exist */
initReveals();
initSplits().then(() => {
  document.querySelectorAll('.split').forEach((el) => revealIO.observe(el));
});
initDepthRail();
initParallax();
