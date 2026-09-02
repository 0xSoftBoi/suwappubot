# Visual layer verification: art, graphics, video, motion, 3D (2026-09-02)

Scope: every non-text visual layer of the showcase homepage plus the repo's art and 3D
assets. Method: headless Chromium (Playwright, SwiftShader WebGL, autoplay allowed) against
the local production build at head `9fddfc0`, plus direct file inspection. Evidence PNGs sit
beside this file (`verify-*.png`).

## Verified working

| Layer | Evidence | Result |
|---|---|---|
| WebGL: DepthSurfaceGL (#routing ridge) | canvas 384x230 mounted, isolated at full opacity, `verify-gl-depthsurface-1440.png` | Renders the dot-grid ridge. No shader compile or link warnings on the console. Deliberately faint by design (see backlog). |
| WebGL: ToolConstellationGL (#terminal) | canvas 384x300 + 2D overlay canvas, `verify-gl-toolconstellation-1440.png` | Renders 22 tool nodes with persimmon centre and mono labels sourced from `stats.generated.json`. No GL warnings. |
| WebGL: QuoteRaceGL | grep | Not mounted anywhere on the page (known orphan, backlog). Nothing to verify. |
| Reveal motion (framer-motion) | `.reveal` count vs `.reveal--in` after a full scroll | 9 of 9 sections revealed. |
| Reduced motion | context `prefers-reduced-motion: reduce`, `verify-hero-reduced-motion-1440.png` | No `<video>` mounts; the WebP poster shows; GL figures mount but stay static. Correct per WCAG 2.3.3. |
| Motion pause control | click "Pause motion" | Sets `video.paused`, freezes `currentTime`, label flips to "Play motion", state persists for the session. Resume path not provable here (see below). |
| Ocean loop assets | MP4 box parse | Both files H.264 (`avc1`), fast-start (`moov` before `mdat`), 11.52 s each so the two variants loop identically; 1.3 MB (1080) and 464 KB (720); WebP poster 202 KB. Variant chosen by viewport width at 700px. |
| Layout stability | PerformanceObserver | CLS 0.001 with motion, 0.000 reduced. LCP 1.6 to 2.6 s locally with the 1080 loop preloaded. |
| Mobile | 390px pass | GL figures hidden below 1024px by CSS (slot collapses, no blank canvases). Pills clear the footer. No horizontal scroll. |
| Product plates | ProofShot + hero | Chamfered with hairline, mono captions, hero crop ends on a whole order-book row. The perps PNG itself is cropped mid-row (baked into the file; needs recapture). |

## Not verifiable in this sandbox (stated, not assumed)

- **Video playback.** Playwright's Chromium ships without the H.264 decoder, so the element stays at `readyState 0` and never advances. The files are valid and fast-start; playback must be confirmed in a real browser on the deployed URL (autoplay muted, loop seam, sound toggle, pause and resume).
- **Machined Bloom** (`art/machined-bloom/index.html`) loads p5.js from cdnjs, which the sandbox proxy resets; it rendered no canvas here. Runs in any normal browser.
- **Genesis Persimmon 3D** (`art/genesis-3d/scene.py`) is a real Blender Cycles scene (uses `bpy`); Blender is not installed here. The committed `render.png` (1.2 MB) shows the engine-turned amber persimmon with the acid-lime oracle rim and is consistent with the script's description.
- **PostHog** analytics script is blocked by the proxy here; irrelevant to the site.

## Where the art lives, and does not

None of `art/genesis-3d`, `art/genesis-persimmon` or `art/machined-bloom` is referenced by the showcase, the terminal or the NFT package. They are standalone works. If the founder wants the Genesis Persimmon render on the marketing site, it would fit the hero-adjacent "plate" system as a dated, captioned artwork rather than decoration; that is a product decision, not a verification item.

## Local-environment errors seen and explained

- `/api/quote` 503: no `SUWAPPU_DEMO_KEY` locally; production returns live quotes.
- Cream band above the sticky header in scrolled screenshots: smooth-scroll capture artefact, verified absent with `scroll-behavior: auto`.
