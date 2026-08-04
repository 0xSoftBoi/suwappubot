---
name: design-iterate
description: One iteration of the showcase design-improvement loop - render the site locally, screenshot desktop + mobile, critique against the taste rubric, fix the top findings, verify the build, commit and push. Use via /loop for continuous improvement, or invoke once for a single pass. Usage: /design-iterate [focus-hint]
---

# Design-iterate: test -> critique -> improve -> verify

One bounded iteration of showcase quality improvement. Each run must produce either
(a) a pushed commit that fixes concrete findings, or (b) a clean-pass report saying the
rubric found nothing above the fix threshold. Never end a run with unverified edits.

## Ground rules

- Branch: work on the current branch (never main directly). All copy claims must trace
  to `docs/design/proof-material.md` - no invented numbers, no unverifiable claims.
- Patterns from reference sites are adapted, never copied (no external assets, copy, or brand).
- Budget: fix at MOST the top 3 findings per iteration. Small verified steps beat big
  unverified leaps. If a finding needs >30 min of work, file it in the backlog instead.
- The loop STOPS improving when a full critique pass yields zero findings at severity
  "fix" for 2 consecutive iterations - then report "converged" and recommend ending the loop.

## The iteration

### 1. Render + capture (evidence first)
```bash
cd showcase && bun run build   # timeout 600000; must pass before anything else
bun run start -- -p 3459 &     # then screenshot with the Playwright pattern below
```
Playwright (chromium at /opt/pw-browsers, import playwright-core from the global npm root):
capture viewport frames every ~850px at 1440x900 AND a full-page + 3 targeted frames at
390x844 with `reducedMotion: 'reduce'`. Pre-scroll the whole page first to fire reveal
observers. (See `docs/design/visual-study.md` header for the known-good script shape;
mobile-emulation screenshot mode gives false void artifacts - use plain viewport.)

### 2. Critique (three lenses, all mandatory)

**Lens A - mechanical taste checks** (grep-able, from the taste-skill pre-flight):
- Em/en-dashes in any user-visible string (JSX text, i18n json, aria-labels): ZERO allowed.
  `grep -n "—\|–" src/app/page.tsx src/components/*.tsx messages/*.json` (ignore code comments).
- Eyebrow count: uppercase-tracking labels above headlines <= ceil(sectionCount/3), and
  never on consecutive sections.
- Duplicate CTA intent: one label per intent across nav/hero/sections/footer.
- CTA wrap at desktop; button/text contrast >= 4.5:1; focus rings visible on clipped buttons.
- No scroll cues, version labels, section-number eyebrows, decorative status dots,
  photo-credit-style captions, locale strips.
- Section layout families: >= 4 distinct families; no family repeated adjacent.

**Lens B - visual comparison**: Read 2-3 captured frames side by side with the reference
observations in `docs/design/visual-study.md` (G1-G6, E1-E7, color addendum). Ask: where
does our page look LESS considered than the reference standard? Texture, type contrast,
color-role discipline (persimmon=primary/swap, leaf=secondary/success/bridge, cream=inverted/sign),
section-boundary design, whitespace confidence.

**Lens C - honest-content check**: every number on the page still traces to
`docs/design/proof-material.md`; captured-quote labels still honest; custody wording
still mechanism-based (never "non-custodial"); FAQ answers still literal.

### 3. Fix (top 3 max)
Rank findings: (1) taste-skill hard bans, (2) broken/regressed rendering, (3) visual-gap
items, (4) nice-to-haves. Implement the top <= 3. Keep each fix small and reviewable.
Append anything unfixed to `docs/design/backlog.md` with a one-line repro.

### 4. Verify + ship
- `bun run build` passes; re-screenshot the changed sections at 1440 AND 390; eyeball them.
- Commit with a message listing the findings fixed; push to the current branch
  (`git push -u origin <branch>`). HUSKY=0 prefix in worktrees.
- Report: findings found / fixed / backlogged, before-after evidence, converged? yes/no.

## Current seeded backlog (from 2026-08-04 audit)
1. Em-dashes in user-visible copy: FAQ answers (page.tsx ~223, ~235) + LiveQuote captured
   label. Replace with period/comma restructures.
2. Eyebrow overuse: 6 eyebrows, several on consecutive sections. Keep hero + 2 strongest
   (Proof-not-promises, Security); drop the rest - headlines carry the meaning.
3. Serif choice: Instrument Serif is on the taste-skill banned-default list. Evaluate a
   swap to a rotation-pool serif (or keep with explicit justification note in visual-study).
4. Micro-text strips (QUOTE - SIMULATE - SIGN): borderline "decoration text strip" tell.
   Keep only if it reads as semantic product-stage wayfinding; consider limiting to one.
5. Vendor-chip categorization (needs verified DEX/bridge/aggregator source first).
6. Footer band literal-cream retint (deferred from color pass).
