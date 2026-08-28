# kristiandefrance — portfolio

Portfolio site for **Kristian de France**, software engineer, Auckland NZ.

The concept is **subdivision**: the hero object is a real sparse voxel octree,
built in the browser over a displaced mesh. Only cells that intersect the
surface subdivide; empty space stays whole. The node counts in the hero
readout are the actual counts, and the A* agent crossing the lattice is a
real A* over the real cell graph. The same structure Kristian built as a
Unity navigation plugin (OctNav) is the structure the site is drawn with —
the octree isn't a project on the site, it *is* the site.

## Stack

- [Astro](https://astro.build) 5, static output — no client framework
- [Three.js](https://threejs.org) for the hero object (one scene, one canvas)
- Hand-rolled IntersectionObserver + CSS custom properties for motion — no
  animation library
- Plain CSS with design tokens; no Tailwind
- Self-hosted variable fonts (Bricolage Grotesque + JetBrains Mono, OFL —
  licenses in `src/assets/fonts/`)

## Local dev

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # static build into dist/
npm run preview    # serve the build
npm run assets     # regenerate public/poster-octree.svg + public/og.png
```

`npm run assets` re-renders the static octree poster (the no-JS / no-WebGL /
reduced-motion fallback) and the Open Graph image from the same octree code
the live scene uses (`src/lib/octree-build.js`). Outputs are committed, so
you only need it after changing the object.

## Deploying

Pushes to `main` deploy via GitHub Actions (`.github/workflows/deploy.yml`)
to GitHub Pages. One-time setup: repo **Settings → Pages → Source →
GitHub Actions**.

`astro.config.mjs` derives `site`/`base` from `GITHUB_REPOSITORY`, so the
project works unchanged from either:

- `kristiandFrance/Portfolio-Website` → `https://kristiandfrance.github.io/Portfolio-Website/`
- `kristiandFrance/kristiandFrance.github.io` → `https://kristiandfrance.github.io/`

> ⚠ GitHub rejects any file over 100 MB — keep large raw video out of the
> repo (`Assets/` holds curated source media; the site serves compressed
> copies from `public/media/`).

## Where things live

| Path | What |
| --- | --- |
| `src/lib/octree-build.js` | The octree: mesh gen, triangle/AABB tests, sparse subdivision, A*, Chaikin smoothing |
| `src/scripts/octree-scene.js` | Three.js scene: load animation, per-section states, A* traversal + goal, pointer lens |
| `src/scripts/motion.js` | Reveals, split-text, depth rail, scroll parallax (one system) |
| `src/content/work/` | Project entries — cards and case-study pages render from one source |
| `src/styles/global.css` | Design tokens and the shared visual system |
| `scripts/generate-assets.mjs` | Build-time poster SVG + OG PNG from the same octree |
| `Assets/` | Raw source media (originals); processed copies live in `public/media/` |
