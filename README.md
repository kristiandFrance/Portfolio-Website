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

Pushes to `main` build and deploy via GitHub Actions
(`.github/workflows/deploy.yml`) to GitHub Pages, served on the custom
domain **kristiandfrance.com**.

> **One-time setup:** repo **Settings → Pages → Source** must be set to
> **GitHub Actions** (not "Deploy from a branch"). Until it is, the build
> job succeeds but the `deploy` job fails with a Pages-not-enabled error
> and the domain serves a 404. Changing the setting does not re-run past
> workflows — push a commit or use *Re-run all jobs*.

`public/CNAME` carries the domain into the build output — GitHub Pages
reads it from `dist/`, so it must stay in `public/`. `astro.config.mjs`
sets `site` to the custom domain and `base` to `/`.

### DNS (Cloudflare)

| Type | Name | Value | Proxy |
| --- | --- | --- | --- |
| A | `@` | `185.199.108.153` | DNS only |
| A | `@` | `185.199.109.153` | DNS only |
| A | `@` | `185.199.110.153` | DNS only |
| A | `@` | `185.199.111.153` | DNS only |
| CNAME | `www` | `kristiandfrance.github.io` | DNS only |

Grey-cloud (DNS only) until GitHub has issued the TLS certificate and
**Enforce HTTPS** is enabled; only then consider proxying. If you do
proxy, Cloudflare SSL/TLS mode must be **Full (strict)** — "Flexible"
causes a redirect loop with Pages.

`kdfr.nz` is a redirect domain (Cloudflare Redirect Rule → apex) and
carries email routing.

### Previewing from the raw github.io URL

```bash
PAGES_SITE=https://kristiandfrance.github.io PAGES_BASE=/Portfolio-Website/ npm run build
```

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
