# ESQRD Web3 — full teardown

**Target:** https://web3.esqrd.co/ · **Captured:** 2026-08-31
**Method:** live fetch of the HTML, both stylesheets and the 1.9 MB JS bundle, then static analysis.
Everything below is **measured from the shipped code**, not inferred from screenshots. Where the
earlier `Top_Sites_Design_Analysis.md` guessed, this corrects it.

---

## 0. The one-line answer

It is a **six-chapter scrollable HUD**: one WebGPU scene lives behind the whole page, and 3D models
are **anchored to invisible DOM elements** so the layout drives the 3D. Motion is uniformly
`ease-in-out` / `sine.inOut`, glow is a *selective* bloom at **0.217 strength**, and background
particles sit at **0.005 opacity**. Nothing is loud. The luxury comes from restraint plus a
3-second scroll ease.

---

## 1. Stack (measured)

| Concern | What they actually use |
|---|---|
| Framework | **Astro** static (`data-astro-cid-*`, `/_astro/*` hashed bundles) |
| 3D | **Three.js WebGPU renderer** + **TSL** (Three Shading Language node system) |
| Scroll | **GSAP 3.14.2** + **ScrollSmoother** + **ScrollTrigger** + **Observer** |
| Carousels | **Swiper** |
| Models | **GLTF + DRACO** compression |
| Fonts | **Play** (400/700) and **Industry Light** (300), self-hosted woff2 + woff |
| CSS | Hand-written BEM. **Almost no custom properties** — colours are hardcoded |
| Pages | Exactly **two**: `/` (EN) and `/pl/` (PL). No sub-pages, no blog |

**Payload:** HTML 22 KB gzip (112 KB raw) · CSS 81 KB · **JS 538 KB gzip / 1.9 MB raw**.
The JS is the whole cost — a 3D engine, a heavy post-processing pipeline and GSAP.

> They ship a **Tweakpane debug panel** (`#debug-panel`, with a `"PostProcess"` folder) in
> production. Same mistake Butter made with its perf panel. Don't copy that.

---

## 2. Colour — hardcoded, warm, and tiny

| Value | Uses | Role |
|---|---|---|
| `#998963` | 16 | **The only accent.** Muted gold. Titles, key phrase in H1, icons, hatches |
| `#101010` | 7 | Page ground (plus `#10101000` for gradient fades) |
| `#0c0b0b` | 3 | Deeper black for vignettes |
| `#fff` | 6 | Primary type |
| `#d9d9d9` | 5 | Secondary type |
| `#9d9d9d` | 2 | Tick marks, muted rules |
| `#2b2b2b` `#3a3a3a` `#1b1b1b` `#141414` `#262525` | — | Panel shades |
| `rgba(124,117,108,.5)` | **17** | **The workhorse rule colour** — warm grey at 50% |
| `#d3232c` | 1 | Form error only |

**The single most transferable colour fact:** their hairlines are a **warm** grey
(`rgba(124,117,108,.5)`), never white-alpha. That is why the wireframe reads as *brushed metal*
rather than *cold UI*. One accent, about sixteen appearances on an entire page.

### Gradients (only nine in the whole sheet)
- `linear-gradient(to bottom, #101010 8.95%, #10101000)` and the `to top` twin — **edge vignettes**
  that fade every chapter into the background so the 3D feels embedded rather than pasted on.
- `radial-gradient(92.62% 172.31% at 39.05% 59.23%, #655c48cc, #2b2b2b)` — the gold wash inside a
  button on hover.
- `radial-gradient(... #FFFFFF 0%, #999999 100%)` — white-to-grey fill for large headings.

---

## 3. Type

```
Display / headings : Play (400, 700)      — squarish techno grotesk, ALL CAPS
Body / labels      : Industry Light (300) — narrow, technical
Fallback           : Roboto, sans-serif
```

- **Play** is free (Google Fonts / OFL). **Industry** is commercial (Fort Foundry).
  Substitutes for Industry Light: *Saira Condensed Light*, *Barlow Condensed Light*, *Chakra Petch Light*.
- **Sizes are fixed px, not fluid clamps**: 10, 11, 12, 14, 15, 16, 18, 20, 22, 24, 25, 30, 36, 40,
  50, 52, 60, 64, 80, 90, 100, 110. They step at breakpoints instead of scaling continuously.
- **Their letter-spacing is broken.** Every declaration is `letter-spacing: 7%` / `17%` / `-7%` —
  percentages are invalid for that property, so browsers drop all of them. The wide tracked look
  comes **from the typefaces themselves**. If you substitute fonts you must add real `em` tracking.

---

## 4. Layout and structure

Six `<section>` elements, each `position: relative; overflow: hidden`:

| # | id | Content |
|---|---|---|
| 1 | `#start` | 4 orbiting badges, two bracketed statements, H1, sound toggle |
| 2 | `#our-results` | 5 stats: 10+ Million Dollars · 10k+ Users · 50% Time Saved · 24/7 Support · 2x Faster Launch |
| 3 | `#our-services` | 5 services x 4 numbered deliverables |
| 4 | `#technology-stack` | 3 filter tabs, 13 logo cards in a Swiper |
| 5 | `#about-us` | 4 slides with an `0N / 04` counter |
| 6 | `#contact-us` | 4-field form plus socials |

### Navigation: there isn't any

There is **no `<nav>` element and no menu.** The header contains only: logo, sound toggle,
EN/PL switch, and one "Contact Us" scroll-link. Every other destination is reached **by scrolling**.
So, answering the question directly: it is **one linear document, not a PowerPoint**. You cannot
jump to an arbitrary chapter, and nothing is hidden behind a menu. The only in-page jumps are the
five `js-scroll-link` anchors — all of which point at `#contact-us`.

Off-site links (all `target="_blank"`): `esqrd.co`, Clutch, LinkedIn, X.

### The HUD grammar is dumb-simple markup
- Brackets: `.section__subtitle--left:before { content: "[" }` and `--right:before { content: "]" }`
- Hatches: a plain `<div class="lines">/////////</div>` — **literally typed slashes**, no SVG
- `01`–`04` numbering: `counter-reset` / `counter-increment` plus
  `counter(subservicesCounter, decimal-leading-zero)`
- `.lines:before` / `:after` add 1px vertical ticks at 50% height in `#9d9d9d`

---

## 5. The 3D system — the part worth stealing

### 5.1 Models are anchored to invisible DOM elements

```html
<div class="service js-service">
  <div class="service__model-target" id="service-model-1" aria-hidden="true"></div>
  <h3>Smart Contract Development and Audit</h3>
  <ol>...</ol>
  <div class="lines">/////////</div>
</div>
```

```js
_addModel("chainModel", "service-model-1", { scale: .4, rotationY: 0,
          emissiveTexture: "chainEmissiveTexture", opacityTexture: "chainOpacityTexture" })
```

and then every frame:

```js
const h  = anchor.getBoundingClientRect();
const cx = h.left + h.width  / 2;
const cy = h.top  + h.height / 2;
const x  =  (cx - halfW) / halfW * (worldW / 2);
const y  = -(cy - halfH) / halfH * (worldH / 2);
group.position.set(x, y, -depth);
```

**This is the key architectural idea of the whole site.** An empty `aria-hidden` div sits in the
normal document flow wherever the object should appear; the 3D object reads that element's screen
rect and converts it into world space. Consequences:

- The 3D **can never collide with content**, at any viewport, because CSS decides where it goes.
- Responsive work is free — move the div in a media query and the model follows.
- No magic numbers and no per-breakpoint 3D coordinates.

Anchors present: `service-model-1` … `service-model-5`, `about-model-1` … `about-model-4`.

### 5.2 The model inventory (all GLTF/DRACO)

```
/models/chain/chain.glb             + chain_Alpha.png,   chain_Emission.png
/models/lock/lock.glb               + lock_Alpha.png,    lock_Emission.png
/models/gear/gear.glb               + gear_Alpha.png,    gear_Emission.png
/models/ico/rhombus.glb             + rhombus_Alpha.png, rhombus_Emission.png
/models/Icosahedron/Ico.glb         + ico_Alpha.png,     ico_Emission.png
/models/sphere_2/{sphere_ico, icosphere_1..3, Nod}.glb
/models/sphere_3/{sphere, sphere_hexagons, hexagon, pentagon}.glb
/models/sphere_4/triangle.glb
/models/{hexagons, cross}.glb
/textures/{displacement.jpg, fluid-noise.png, grass/grid.png}
```

**Every model ships an `_Alpha` plus `_Emission` texture pair.** The gold glow is authored *into the
asset* as an emission map — it is not a shader guess and not a global filter. The alpha map drives
the dissolve.

### 5.3 Post-processing — why their glow is classy

```js
bloomPass:   { strength: 0.217, radius: 0, threshold: 0 }
godraysPass: { screenLightPos, samples, ... }
layers:      { BLOOM_SCENE, DOF_SCENE, DEFAULT }
passes:      scenePassColorMain, emissivePassMain, bloomPassMain,
             depthPassMain, transitionPass, dofPass, godraysPass
fog:         fogColor, fogNear, fogFar 47.83
```

Two rules make the difference:

1. **Bloom strength is 0.217** — barely more than a fifth. Not 1.0, not 2.0.
2. **Bloom is selective, via layers.** Only objects assigned to `BLOOM_SCENE` bloom at all. The
   wireframes, the particles and the type are *excluded*. Glow is a property of specific gold
   emissive objects, never of the whole frame.

There is also a **DOF pass** and **fog at 47.83 units**, so distant geometry falls off naturally —
which is what stops the scene reading as flat WebGL.

### 5.4 Particles — measured defaults

**Background plexus field** (GPU compute, WebGPU):

```js
nbParticles   : 450 desktop / 125 mobile
opacity       : 0.005      // five thousandths
particleSize  : 1.04
linksOpacity  : 0.011      // the connecting lines
linksWidth    : 0.005
maxLinkDist   : 5.3        // link particles closer than this
spawnArea     : X 16, Y 6, Z 16   // wide and flat, not a cube
oscFrequency  : 0.05       // very slow
oscAmplitude  : 1.8
```

**Surface / dissolve particles:**

```js
particlesColor         : #535252   // grey — NOT the gold accent
particlesSize          : 0.0229
particlesSizeRandom    : 0.6
particlesOpacity       : 0.6
particlesOffset        : 0.25
particlesOpacityRandom : 1
```

Takeaways: only **450** particles; they are **grey, never accent-coloured**; individual opacity is
**0.005**, so they register as atmosphere rather than as objects; and they are **linked** into a
plexus, which gives structure instead of random confetti. Positions are computed on the GPU
(`.compute()` / `computeAsync`) using `mx_noise`.

---

## 6. Motion — one easing, everywhere

| Measurement | Value |
|---|---|
| CSS `ease-in-out` | **94 uses** |
| CSS custom bezier | **0** |
| GSAP `sine.inOut` | **65 uses** |
| `power2.out` / `power2.in` | 2 each |
| Common CSS durations | `.3s` hover, `.5s` reveal, `1s` large reveal |
| ScrollSmoother | `smooth: 3`, `smoothTouch: 1`, `normalizeScroll: true` |
| ScrollTrigger scrub | `0.5` and `2` |
| Snap | `duration: { min: .8, max: 1.8 }`, `ease: "sine.inOut"` |

**Everything is symmetric and gentle.** No overshoot, no back-ease, no springs. A 3-second scroll
smoothing is extremely heavy — the page glides to a halt long after you stop scrolling, and that
single number is most of the "expensive" feeling.

### The reveal is a focus pull, not a slide

```css
transition: opacity ease-in-out 1s, filter ease-in-out 1s, transform ease-in-out 1s;
filter: blur(20px) -> blur(0px);      /* also 40px, 10px and 5px variants */
```

Content **comes into focus** as it enters. Combined with the blur, this reads cinematic rather than
"web animation".

### Their snap is smarter than CSS scroll-snap

```js
snap: {
  snapTo: (v) => { /* candidate points, but SKIP any section taller than the viewport */ },
  duration: { min: .8, max: 1.8 },
  ease: "sine.inOut"
}
```

Sections that do not fit the screen are **removed from the snap candidates**, so tall content is
never trapped. That is the correct solution to the problem CSS `scroll-snap: proximity` only
half-solves.

### Buttons are little instruments

```
.btn__lines          -> absolute overlay, border-top + border-bottom only (no side borders)
.btn__lines .line x6 -> 1px vertical ticks, height 50%, scaleY(.5) -> scaleY(1) on hover, .3s
.btn__lines:before   -> gold radial wash, opacity 0 -> 1, .3s
.btn__icon           -> inline SVG slot
```

So a button is: two horizontal rules, six tick marks that grow, a gold wash, a label and an icon.
Square corners, no fill at rest.

### Other motion
- `@keyframes randomTranslateX{First…Sixth}` — six variants, `10s alternate-reverse infinite
  ease-in-out`, drifting the decorative dot rows.
- Preloader: a hand-drawn SVG wireframe polyhedron (260x260 viewBox, `#D9D9D9` and white strokes).
- `<body class="content-ready">` gates the intro until assets load.
- Section state classes: `--intro --results --services --technology --about --contact-us --ready --animated`.

---

## 7. Responsive and input

```
@media (max-width: 1839px), (orientation: landscape) and (max-height: 800px)
@media (max-width: 1439px), (orientation: landscape) and (max-height: 750px)
@media (max-width: 1279px), (orientation: landscape) and (max-height: 700px)
@media (max-width: 1024px) / 767 / 575 / 359
@media (min-width: 2800px)
@media (pointer: coarse)
@media not (pointer: coarse), (hover: hover) and (pointer: fine)
```

Two things worth copying:

1. **Height-aware breakpoints.** On a full-viewport chapter site, a short laptop screen is as much a
   constraint as a narrow phone. They demote type and spacing by `max-height`, not only `max-width`.
2. **Proper hover gating** with `(hover: hover) and (pointer: fine)`, so touch devices never inherit
   hover-only states.

Particles halve on mobile (450 to 125).

---

## 8. How it feels, and why

- **Arrival.** Preloader wireframe, then content fades up through blur. You wait about a second and
  are rewarded with something obviously expensive to build. Sound is **off** by default with a
  visible toggle.
- **Scrolling.** The 3-second smoothing gives the page *weight* — it keeps moving after your fingers
  stop, like a heavy dial. Snap then settles you into the chapter. It never feels scroll-jacked,
  because snapping is skipped for tall sections.
- **Reading.** Each chapter is one screen with one job. The centre stays clear for the 3D; copy is
  pushed to corners and edges. Your eye goes object, then gold title, then numbered list.
- **Hovering.** Almost nothing moves. Tick marks grow, a gold wash appears, a colour shifts over
  0.3s. Restraint is the point — the page feels *precise* rather than *playful*.
- **Comprehension.** The `01`–`04` lists, `0N / 04` counters and `/////////` dividers imply
  instrumentation and sequence. Procurement-friendly: scannable, four bullets per service, numbers
  before adjectives.
- **The catch.** Because there is no menu, you must scroll the whole story. That works for a
  six-chapter sales narrative. It would fail for a reference site.

---

## 9. What to take, what to avoid

**Take**

1. **DOM-anchored 3D.** The single best idea here. Empty divs position the object; CSS owns layout.
2. **Selective bloom at about 0.2 strength**, on emissive objects only, never global.
3. **Emission maps authored into assets** instead of shader-guessed glow.
4. **One easing** (`ease-in-out` / `sine.inOut`) for everything.
5. **Blur-based focus-pull reveals** instead of slide-ups.
6. **Warm grey hairlines**, one accent used about sixteen times per page.
7. **Particles at 0.005 opacity, linked, grey, about 450 of them.**
8. **Height-aware breakpoints** and hover gating.
9. **Edge vignette gradients** to fuse chapters with the 3D layer.
10. **CSS counters** for `01`–`04`; literal `/////////` text for hatches.

**Avoid**

1. 1.9 MB of JS. Non-negotiable for a portfolio that has to score well on mobile.
2. WebGPU-first — support is still uneven; WebGL is the safe target.
3. The shipped Tweakpane debug panel.
4. `letter-spacing` in `%` (silently dropped by every browser).
5. No `<nav>` at all — fine for a six-chapter pitch, wrong for a site with case studies.
6. Background audio, even off by default, on a portfolio.
7. Their exact assets, logo, copy and the Industry typeface — those are theirs or licensed.

---

## 10. Numbers to copy directly

```
accent            #998963  (or your own single accent)
ground            #101010
rule              rgba(124,117,108,.5)
text / secondary  #ffffff / #d9d9d9 / #9d9d9d
bloom strength    0.217, threshold 0, radius 0, selective via layers
fog far           47.83
particles         450 desktop / 125 mobile
particle opacity  0.005      link opacity 0.011      maxLinkDist 5.3
spawn area        16 x 6 x 16
easing            ease-in-out (CSS) / sine.inOut (GSAP)
durations         0.3s hover · 0.5s reveal · 1s large reveal
scroll smooth     3.0 (touch 1.0)
snap duration     0.8-1.8s
reveal blur       20px -> 0
```
