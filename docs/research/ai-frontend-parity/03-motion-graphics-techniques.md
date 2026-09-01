# Motion and graphics techniques used by top AI / AI-infra sites (2025-2026)

Research date 2026-09-01. How the effects are BUILT, not just how they look. Cells marked UNVERIFIED could not be confirmed from primary sources by search alone; a live view-source pass is needed to fill them.

## 1. Hero techniques
- **Vercel**: Ship-conf hero used **regl** (not Three.js/R3F) — a `baseFbo` multi-channel texture (R=logo/button mask, G=motion intensity, B=smooth falloff) plus a separate cursor "flow shader" (R/G = directional vector to mouse, B = magnitude). SVG placeholder animates while the shader compiles, then swaps to canvas so first paint isn't blocked. [basement.studio](https://basement.studio/post/shipping-ship-behind-the-particle-shader-effect-for-vercels-conf). Separately, `vercel-labs/nextjs-nights-shader` is a **WebGPU** galaxy shader (Three.js) with procedural sky, interactive hover fluid, bloom, and ordered dithering — [GitHub](https://github.com/vercel-labs/nextjs-nights-shader). Vercel's product pages generally use near-black bg + shader-driven animated gradients, now productized as v0 hero templates.
- **Stripe** ("Whatamesh"): fragment shader = fractal Brownian motion (layered simplex noise, increasing frequency/decreasing amplitude per octave) + UV coordinates warped by `sin`/`cos` mesh modulation (not raw noise) + real blend-mode math (multiply/screen/overlay) instead of `mix()` for color transitions. The signature diagonal edge is a **CSS trick**, not geometry: full-rect WebGL canvas inside a container with `transform: skewY(-12deg); overflow: hidden`. WebGL1-only (Chrome56+/FF51+/Safari11+/Edge12+). [bram.us writeup](https://www.bram.us/2021/10/13/how-to-create-the-stripe-website-gradient-effect/), [dithering/whatamesh gist](https://gist.github.com/dkaraush/6cbf93eac983c777314445437d495672).
- **Dithering as a hero effect (2025-2026 trend)**: Codrops has 3 separate pieces on this pattern — "Building a Real-Time Dithering Shader" (June 2025): GLSL, procedural 4×4 Bayer matrix (no texture lookups), wrapped as an `Effect` subclass of the **`postprocessing`** npm library so it composes with Three.js/`@react-three/postprocessing` bloom/blur passes — [Codrops](https://tympanus.net/codrops/2025/06/04/building-a-real-time-dithering-shader/); "Interactive WebGL Backgrounds: A Quick Guide to Bayer Dithering" (Jul 2025) — [Codrops](https://tympanus.net/codrops/2025/07/30/interactive-webgl-backgrounds-a-quick-guide-to-bayer-dithering/); "Efecto" real-time ASCII+dithering (Jan 2026) — [Codrops](https://tympanus.net/codrops/2026/01/04/efecto-building-real-time-ascii-and-dithering-effects-with-webgl-shaders/). Retro/dithered look is explicitly framed as reaction against glossy 3D. Also: "How to Animate WebGL Shaders with GSAP: Ripples, Reveals, Dynamic Blur" (Oct 2025) shows GSAP driving shader uniforms directly — [Codrops](https://tympanus.net/codrops/2025/10/08/how-to-animate-webgl-shaders-with-gsap-ripples-reveals-and-dynamic-blur-effects/).
- **Anthropic**: no shader/canvas hero found — visual identity is print/editorial, not motion-led: cream `#faf9f5` bg, near-black `#141413` text, dual-font system (Anthropic Serif for both 90px display *and* 24px body prose — serif-for-body is the distinctive move), zero `box-shadow` anywhere, elevation via color+border only, generous whitespace (up to 96px section padding), 10 responsive breakpoints. [DesignMD benchmark](https://designmd.cc/benchmarks/anthropic).
- **Runway**: full-bleed cinematic photo/video **as** the primary UI surface (dark, cool-neutral palette, zero shadows, minimal borders) — no shader hero found in engineering sources, this is a video-loop-driven design language, not WebGL. [Design system analysis](https://getdesign.md/runwayml/design-md).
- **Cursor**: confirmed via secondary source that **Framer Motion** drives cursor.com homepage animations; no confirmation of Three.js/canvas use. UNVERIFIED beyond that claim (single low-confidence source).
- **OpenAI, ElevenLabs, Midjourney, xAI, Cohere, Scale AI, Replicate, Hugging Face**: UNVERIFIED — general web search did not surface engineering blog posts or view-source teardowns naming their specific hero tech (no Codrops/Awwwards case study found for any of these). Would need direct browser/view-source inspection (not available to a search-only tool) to fill this in with confidence — flag for a follow-up pass using `claude-in-chrome` MCP if this matters for parity work.

## 2. Scroll choreography
- **Lenis** (`darkroom.engineering`) is the de facto smooth-scroll layer for this whole aesthetic category: few KB, zero deps, runs on native scroll, explicitly built to **sync WebGL scroll scenes and GSAP ScrollTrigger** to avoid glitching between DOM and canvas; has React/Vue/Framer adapters. [GitHub](https://github.com/darkroomengineering/lenis).
- **GSAP ScrollTrigger** is the dominant pinned/scrub library for this look (GSAP went **fully free**, including SplitText, in 2025). Standard pattern: `scrub: 1` ties animation progress directly to scrollbar position (not time-based), combined with `SplitText` for per-char/word stagger reveals tied to scroll. [GSAP forums](https://gsap.com/community/forums/topic/26359-scrolltrigger-horizontal-scroll-split-text-and-scrub/), [Builder.io "buttery scroll reveal"](https://www.builder.io/blog/gsap-reveal).
- Common combo pattern found repeatedly: **Lenis (scroll physics) + GSAP ScrollTrigger (pin/scrub) + SplitText (reveal)** — vertical section-snapping galleries with `clip-path` transitions between slides is a named example pattern.
- **Framer Motion / Motion.dev** offers `useScroll`/`useTransform` as the React-declarative alternative to ScrollTrigger for simpler parallax/reveal (no pinning primitive as robust as ScrollTrigger's `pin: true`).
- **Number counters**: modern CSS-native approach uses `@property` registered custom integer properties animated by the browser's style engine, printed via `counter()` — genuinely interpolated, not string-swapped, no JS needed. Odometer-style (each digit rolls independently, spring physics) is the richer JS variant. [Motion.dev text animation docs](https://motion.dev/docs/text-animation).

## 3. Micro-interactions
- **Magnetic buttons**: cursor-proximity translate of button toward pointer, spring-based snap-back on leave. Implemented via GSAP (`gsap.quickTo` + mousemove listener) or Framer Motion (`useMotionValue` + spring transition). Named/cloned from Luma's site pattern. [Olivier Larose tutorial](https://blog.olivierlarose.com/tutorials/magnetic-button), [GSAP forum thread](https://gsap.com/community/forums/topic/25319-magnetic-hover-interaction-with-cursor/).
- **Spotlight/glow-follows-cursor card**: `SpotlightCard` pattern (react-bits, Aceternity "Spotlight") — radial-gradient background-position or a masked overlay tracked to `mousemove` coordinates relative to card bounding box.
- **Border-beam**: a rotating/traveling gradient border, implemented as Magic UI's `BorderBeam` (animated conic-gradient masked to a 1px border) or Motion Primitives' animated border-beam card.
- **3D tilt card**: Aceternity's "3D Card Effect" — perspective transform driven by mouse position (rotateX/rotateY), the most-screenshotted Aceternity component per source.

## 4. Page transitions & load
- **View Transitions API**: same-document transitions reached **Baseline Newly Available Oct 14, 2025** (Chrome 111+, Edge 111+, Firefox 133+, Safari 18+). Cross-document (MPA) transitions: Chrome/Edge 126+, Safari 18.2+ — **Firefox not yet supported** (expected 2026). `:active-view-transition` pseudo-class went Baseline Jan 13, 2026. React added canary support for `<ViewTransition>`. [web.dev](https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available), [Chrome blog](https://developer.chrome.com/blog/view-transitions-in-2025). Practical implication for Suwappu: safe to ship same-document VT progressively-enhanced (feature-detect `document.startViewTransition`), but cross-doc MPA transitions still need a JS fallback (Framer Motion `AnimatePresence`/GSAP) for Firefox users.
- **Preloader pattern**: seen concretely at Vercel Ship — lightweight SVG/CSS animation shown immediately, canvas/shader swapped in only once compiled, so first paint is never blocked by GPU pipeline setup.

## 5. Motion tokens (cross-referenced against production design systems)
No single 2025 standard exists — **W3C DTCG 2025.10 spec does not yet cover motion tokens** ([GitHub issue](https://github.com/google-labs-code/design.md/issues/47)), so each company hand-rolls its own ladder. Concrete published values found:
- **IBM Carbon**: `productive` easing `cubic-bezier(0.2, 0, 0.38, 0.9)`, `expressive` easing `cubic-bezier(0.4, 0.14, 0.3, 1)` — [Carbon motion](https://carbondesignsystem.com/elements/motion/overview/).
- General guidance across systems: micro-interactions 70–700ms; common duration steps ~100/200/300/500/800ms; 2–3 named eases (`ease-in`, `ease-out`, custom default) is the recommended minimum vocabulary — [Medium survey](https://medium.com/@ogonzal87/animation-motion-design-tokens-8cf67ffa36e9).
- Uber Base and Atlassian publish motion tokens but the specific bezier values weren't extractable via fetch (JS-rendered docs) — UNVERIFIED numeric values, flagged rather than guessed.
- `prefers-reduced-motion` handling best practice: gate every non-essential animation behind the media query (CSS) or `window.matchMedia('(prefers-reduced-motion: reduce)')` (JS); swap scale/rotate/parallax for fade/dissolve/color-change rather than removing motion entirely; this is framed as "lowest-effort, highest-impact a11y win" — [web.dev](https://web.dev/learn/accessibility/motion), [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion).

## 6. Textures & polish
- **Grain/noise**: dominant technique is an inline **SVG `feTurbulence` filter** (fractal noise) + `feColorMatrix` for opacity, encoded as a data-URI, stacked as top background layer over a gradient — zero extra image requests. For authentic *film* grain (not static), apply it via an oversized pseudo-element that **jumps** position using `steps()` (not smooth tween) with `mix-blend-mode: soft-light; pointer-events: none`. Opacity bands: 2–4% subtle, 5–8% visible, 10–15% strong/analog. `baseFrequency` controls grain size, `numOctaves` adds detail layers. [CSS-Tricks "Grainy Gradients"](https://css-tricks.com/grainy-gradients/), [gist](https://gist.github.com/skeptrunedev/e1f0cf00641fb26bbd0acf937f57c6a5).
- Glass/backdrop-blur, hairline (1px) borders, and dark-mode-first palettes are consistent across every site sampled (Vercel, Anthropic-adjacent, Runway) — Anthropic is the notable **counter-example** (light cream bg, zero shadows/blur, flat-color elevation instead).

## 7. Performance discipline
- Font: `next/font` self-hosts + auto-subsets + applies `font-display: swap` (fallback shown instantly, swap on load — explicitly the recommended strategy for LCP) — [Vercel Academy](https://vercel.com/academy/nextjs-foundations/fonts-with-next-font). Consolidating to one **variable font** with `latin`-only subsetting + preload + WOFF2 measured at **500–1000ms LCP improvement** on text-LCP pages — [dev.to survey](https://dev.to/apogeewatcher/font-subsetting-for-web-performance-4-tools-to-reduce-font-file-size-and-improve-lcp-4n11). Subsetting drops in priority if body copy already uses a system-font stack.
- Canvas/shader lazy-load pattern: defer WebGL init until after first paint, show a cheap SVG/CSS placeholder first (Vercel Ship example above) — this is the concrete technique for reconciling "hero shader" with LCP budgets.

## 8. Component libraries for this look
| Library | Positioning | Notes |
|---|---|---|
| shadcn/ui | headless primitives baseline | pairs with Magic UI |
| Magic UI | 150+ components, Tailwind+Motion | utility-skewed: shimmer, sparkles, marquee, bento, `BorderBeam` |
| Aceternity UI | 200+ components, Tailwind+Framer Motion | hero-spectacle-skewed: Spotlight, Background Beams, 3D Card |
| React Bits | fastest-rising (#2 in JS Rising Stars 2025, ahead of shadcn/ui) | no Framer Motion dependency; `SpotlightCard` etc. |
| Motion Primitives | 110+ free animated components | includes animated `BorderBeam`/streaming-text card |
| Motion (motion.dev, née Framer Motion) | React declarative animation | `useScroll`, springs, text-animation docs |
| GSAP | now fully free incl. SplitText/MorphSVG (2025) | best for scrub/pin timelines |
| Three.js / R3F / drei, `postprocessing`, `regl` | WebGL layer | `postprocessing` npm lib is the standard way to compose dithering/bloom passes on top of R3F |
| Lenis | smooth-scroll physics layer | syncs DOM+WebGL+ScrollTrigger |

Source: [PkgPulse react-bits vs Aceternity vs Magic UI](https://www.pkgpulse.com/guides/react-bits-animated-components-2026), [designrevision Magic UI alternatives](https://designrevision.com/alternatives/magic-ui).

## Per-company table (confidence-flagged)
| Company | Hero tech | Scroll lib | Motion lib | Textures | Confidence |
|---|---|---|---|---|---|
| Vercel | regl particle shader (Ship); WebGPU Three.js galaxy shader w/ bloom+dithering (Labs) | UNVERIFIED | UNVERIFIED | near-black + gradient shaders | direct engineering post |
| Stripe | Whatamesh: simplex-noise FBM + blend-mode shader, skewed canvas trick | UNVERIFIED | UNVERIFIED | mesh gradient | reverse-engineered, well-documented |
| Anthropic | none found (no shader/canvas) | UNVERIFIED | UNVERIFIED | cream/flat, zero shadow, serif body | design-token scrape (DesignMD) |
| Runway | full-bleed cinematic video/photo as UI | UNVERIFIED | UNVERIFIED | dark, cool-neutral, zero shadow | design-system analysis, secondary |
| Cursor | UNVERIFIED (no canvas confirmed) | UNVERIFIED | Framer Motion (single low-confidence source) | UNVERIFIED | weak |
| Linear | N/A (app, not marketing motion) — local-first sync architecture, no-spinner UI | — | — | — | dev.to reverse-engineering series |
| OpenAI, ElevenLabs, Midjourney, xAI, Cohere, Scale AI, Replicate, Hugging Face | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | search returned no engineering/teardown sources |

## Recommended motion token set (synthesized, cite-backed)
- **Durations**: `100ms` (state flip: checkbox/toggle) / `200ms` (hover, button) / `300ms` (card/tooltip) / `500ms` (panel/section reveal) / `800ms` (page-level/hero stagger complete) — consistent with the 70–700ms micro-interaction range and Carbon/Material precedent.
- **Easings**: `ease-out` default for entrances `cubic-bezier(0.2, 0, 0.38, 0.9)` (Carbon "productive"); `cubic-bezier(0.4, 0.14, 0.3, 1)` for expressive/hero moments (Carbon "expressive"); linear only for scroll-scrubbed (`scrub: 1`) ScrollTrigger animations since scroll position *is* the timing function.
- **Stagger delta**: 40–80ms between siblings for word/char reveals (fast enough to read as "one motion," slow enough to see the wave).
- **Spring** (for magnetic/tilt/drag-return): stiffness ~300, damping ~20, mass 1 (Framer Motion default-adjacent) — snappy, one-bounce-max, no visible oscillation.
- **Reduced motion**: wrap every transform-based entrance in `@media (prefers-reduced-motion: reduce)` fallback to opacity-only fade at the same duration; gate JS-driven parallax/magnetic/tilt behind `matchMedia` check at init, not per-frame.
