# /passport — art direction review

Reviewed live https://suwappu.bot/passport on 2026-09-26 with headless Playwright (Chromium).
Evidence lives in the session scratchpad `…/scratchpad/art/`:
`d1440-fold.png`, `d1440-full.png`, `d1280-fold.png`, `m390-fold.png`, `m360-fold.png`,
`d1440-qr.png`, `m390-qr.png`, `orbzoom.png`, motion sheets `sheet-{d1440,m390}-{idle,click}.png`,
plus the existing `e2e-4-result.png` / `e2e-5-technical.png`.

Benchmark: Anthropic / Linear / Vercel / Arc launch pages.
Known issues were excluded: red provider dots, header CTA wrap at 1280, cream footer.

## What is already right (keep it)

- **Restraint.** There is one idea, one CTA, and all the jargon is kept inside Technical details. That instinct is correct, so don't add anything to the hero.
- **Palette is on-brand.** The orb and CTA use the persimmon `--sw-accent*` tokens on the soil canvas. This page and `/` read as the same company.
- **Modal and card entrance easing** (`0.35s`/`0.55s`, `[0.22,1,0.36,1]`) is the right curve. Reduced motion is honoured.
- The serif headline paired with the Archivo lede is the right pairing. Only its scale and weight are off (see #3).

## Findings (ranked by consequence)

### 1. P0: The CTA sits on the fold line, and the orb takes 40% of the first screen
**Evidence:** In `d1280-fold.png` (1280x800) the CTA spans y=733–785 and "Powered by" is below the fold. A real 13" laptop viewport (~1280x720 once browser chrome is subtracted) pushes the CTA **off screen**. At 360x740 (`m360-fold.png`) the CTA touches the bottom edge. The orb stage uses y=90–440 on desktop and ~220 CSS px on mobile before any words appear.
**Fix:** Size the orb from viewport height, not width, and tighten the top.
```css
.shell     { padding: clamp(20px, 4vh, 48px) 18px 96px; }
.hero      { padding-top: 0; gap: 0; }
.orbStage  { max-width: clamp(180px, 24vh, 280px); margin-bottom: clamp(4px, 1vh, 16px); }
```
**Acceptance:** the CTA's bottom edge is ≤ 640px at 1280x720 and ≤ 680px at 360x740.

### 2. P0: The orb reads as an out-of-focus light bulb, not something alive
**Evidence:** `orbzoom.png` shows a soft beige disc with a pink smudge, no edge, no depth and no internal motion. Idle frames 250ms apart differ by a mean of **0.06/255** at 1440, so it is effectively a still image. The 18s conic spin is invisible under `blur(14px)`. The halo also has a visible circular boundary: luminance jumps 19→59 between x=540 and x=600 on the centre row, which reads as a disc rather than atmosphere.
**Fix:** Give the core a surface (rim plus highlight), make the internal motion perceptible, and dissolve the halo.
```css
.orbCore {
  filter: blur(5px) saturate(1.15);                 /* was 14px */
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,.10),
    inset 10px 12px 28px rgba(255,244,228,.45),      /* top-left light */
    inset -14px -18px 36px rgba(110,36,0,.45);       /* bottom-right depth */
  animation: orbMorph 7s ease-in-out infinite, orbSpin 10s linear infinite; /* was 11s / 18s */
}
/* add a 4th span: counter-rotating sheen so the surface visibly moves */
.orbSheen {
  position:absolute; inset:18%; border-radius:inherit; mix-blend-mode:screen; opacity:.55;
  background: conic-gradient(from 90deg, transparent 0 30%, rgba(255,236,210,.7) 40%, transparent 55%);
  filter: blur(8px); animation: orbSpin 13s linear infinite reverse;
}
.orbLayer { filter: blur(44px); opacity: .38; inset: -45%; }   /* was 28px / .55 / -30% */
.orbLayer:nth-child(2) { opacity: .22; }
```
**Acceptance:** re-record 8 frames at 250ms. Mean frame-to-frame diff over the orb crop should be ≥ 1.0/255, and no luminance step greater than 6 should appear anywhere across the halo radius.

### 3. P1: The headline is timid. It's capped at 48px, set in three lines inside a ~370px column, at weight 700
**Evidence:** In `d1440-fold.png`, `.heroCopy { max-width: 44ch }` resolves at 16px to about 370px, so a 48px serif breaks into three ragged lines ("Give your AI / agent an identity / people can trust."). Top-tier pages run display serifs at 64–80px, in two balanced lines, at a book or medium weight. At 700 weight this reads like a newspaper, not an AI product.
**Fix:**
```css
.heroCopy { max-width: none; }
.h1 {
  font-size: clamp(2.2rem, 1.1rem + 3.6vw, 4.25rem);
  font-weight: 500;
  line-height: 1.03;
  letter-spacing: -0.025em;
  max-width: 15ch; margin: 0 auto 18px;
  text-wrap: balance;
}
```
At 1440 the headline should break as "Give your AI agent / an identity people can trust."

### 4. P1: The lede is clunky copy with a bad rag
**Evidence:** At 1440, "automatically." sits alone on its own line. At 390 (`m390-fold.png`) a line starts with "— automatically." The phrase "covered by that trust" is vague.
**Fix:** Copy: **"Prove you're human once. Every trade your agent makes after that carries the proof."**
```css
.lede { max-width: 34ch; margin: 0 auto; font-size: 1.0625rem; color: rgba(244,244,246,.64); text-wrap: pretty; }
```
Update all four locales together.

### 5. P1: The orb "reacts to state", but nobody can see it react
**Evidence:** `sheet-d1440-click.png`. Once the CTA is clicked, the QR modal's scrim (`rgba(6,7,8,.66)` + `blur(6px)`) covers the orb at the exact moment it switches to `thinking`. Frames 1–7 differ by only 0.06–0.28, so the reaction is invisible. The nav also stays fully lit above the scrim (`z-index: 60` is below the nav), so the orange "Launch Terminal" button is the brightest thing on screen during the flow's key moment.
**Fix (preferred):** On desktop ≥ 768px, drop the modal and render the QR **inline in `.flowStage`**, replacing the CTA, with the orb shimmering directly above it. That is one continuous stage, which is how Arc and Linear handle a step change. If the modal stays, make the scrim leave the orb visible and cover the nav:
```css
.modalBackdrop { z-index: 1000; align-items: flex-end; padding-bottom: 8vh;
  background: linear-gradient(180deg, rgba(6,7,8,.15) 0%, rgba(6,7,8,.72) 45%); backdrop-filter: none; }
```

### 6. P1: The QR sheet is generic and wrong on phones
**Evidence:** `d1440-qr.png` shows a 200px QR in a 340px sheet with no World mark, no instruction and an ASCII "...". "Use the simulator instead" is a full-weight underlined link at the same visual rank as Copy link. `m390-qr.png` shows the real bug: **on a phone the user is shown a QR code to scan with the same phone.**
**Fix:**
- Title "Scan with World App". Add a subline at .82rem: "Open World App → Scan. Takes about 10 seconds."
- QR: 232px, with a 12px white quiet zone inside a 16px-radius tile.
- Status: an 8px persimmon dot pulsing at 1.6s, then "Waiting for your phone…" using a true ellipsis character.
- Demote the simulator to .75rem at .45 alpha with the copy "Testing without World App? Use the simulator".
- **At ≤ 640px, the primary action is an "Open World App" deep-link button** (the same pill style as the hero CTA). Collapse the QR behind "Show QR code instead".

### 7. P1: The result card breaks the name mid-hyphen and has no sense of arrival
**Evidence:** `e2e-4-result.png` / `e2e-5-technical.png` show "f4c68576.suwappu-" and "agents.eth" split across two lines by `word-break: break-word`. The hero doesn't change after success, and at 1280x800 the card's top edge is at y=733, so the payoff lands **below the fold** and the user has to scroll to find out they succeeded.
**Fix:**
```html
<h2 class="resultName"><span class="label">f4c68576</span><span class="parent">.suwappu-agents.eth</span></h2>
```
```css
.resultName { white-space: nowrap; word-break: normal; display:flex; flex-direction:column; align-items:center; gap:4px; }
.resultName .label  { font-family: var(--font-serif); font-size: clamp(2rem, 5vw, 2.75rem); letter-spacing: -.02em; }
.resultName .parent { font-family: var(--font-mono); font-size: .82rem; color: rgba(244,244,246,.55); }
.resultCard { border-top: 1px solid color-mix(in srgb, var(--sw-accent-bright) 45%, transparent); }
```
On success, swap the H1 to **"Your agent has a passport."**, collapse the lede (height→0, 300ms), and shrink the orb stage to 140px so the card lands inside the first viewport. Product note for the lead: a hex label is weak as "an identity people can trust". A deterministic, pronounceable label derived from the same hash (e.g. `amber-kite-42`) would earn the headline.

### 8. P1: Two orange CTAs in two different shapes
**Evidence:** In `m390-fold.png` the nav's chamfered orange "Launch Terminal" (~220x76 device px) competes with the page's pill CTA and appears first. The shapes disagree (chamfer vs. pill), so the "single CTA" promise is broken at the top of the screen.
**Fix:** On `.summer-page--passport`, render the nav CTA with the existing `.summer-nav__cta--ghost` treatment. The only saturated persimmon fill on the page should be "Get your agent a passport".

### 9. P2: The pending CTA turns to mud
**Evidence:** In the first frame of `sheet-d1440-click.png`, `.cta:disabled { opacity: .6 }` over near-black makes the orange a brown pill reading "Starting…".
**Fix:** Keep opacity at 1. Set `cursor: progress`, show a 14px inline spinner (dark stroke `#14100a` at 35%/100%), and change the label to "Opening World ID…". Better still, morph the button into the first narration line with a framer `layout` transition over 0.4s.

### 10. P2: The narration doesn't feel like a voice
**Evidence (code + frames; I did not capture a full live narration sequence):** Lines are .94rem at .62 alpha in a left-aligned list under a centred composition. The voice is mixed ("Verified — you're human" next to a bare ENS name as its own line). Lines appear as fast as the backend responds, so a fast run feels like a log dump.
**Fix:** Use one voice, the agent speaking in first person:
"Checking you're a real person…" → "You're verified as human." → "Choosing my name…" → "I'm **f4c68576**.suwappu-agents.eth" → "Protected trading is on."
Enforce a **minimum 650ms between lines** client-side. Constrain the list to `max-width: 320px; margin: 0 auto`. Replace the spinner on the active line with a text shimmer (`background: linear-gradient(90deg, .5α, 1α, .5α); background-size: 200%; background-clip: text; animation 1.6s linear infinite`).

### 11. P2: The vertical rhythm is uniform, so hierarchy is flat
**Evidence:** `.hero { gap: 28px }` puts the same distance between orb→headline, headline block→CTA and CTA→powered-by (`d1440-fold.png`). Nothing is grouped.
**Fix:** Use explicit spacing: orb→H1 12px (the halo already supplies air), H1→lede 18px, lede→CTA 36px, CTA→"Powered by" 32px. Drop `.poweredBy` to .66rem at .38 alpha so it reads as a signature, not a fourth line of copy.

### 12. P2: Technical details contains internal hackathon language
**Evidence:** `e2e-5-technical.png`. The footnote reads "…out of scope for tonight's three sponsor tracks (World ID, ENS, Uniswap)." That's accurate for judges tonight, but it reads as a status note and will outlive the event on a public URL.
**Fix:** Change the copy to "Intercepta pre-trade risk scoring plugs into this same gate. Coming next." Set it at .8rem, .5 alpha, with 20px top margin.

## Order of work for showcase-dev
Do #1 and #2 first. Together they fix the first impression at every viewport. Then #3 and #4 (type), then #5, #6 and #7 (the flow). #8–#12 are cheap polish.
Re-render at 1440/1280/390/360 and re-record the 8-frame idle and click sequences after each group.
