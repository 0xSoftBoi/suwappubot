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
3. DONE (iter 4): serif swapped to EB Garamond after an A/B render. See
   docs/design/serif-decision.md, including the hero-wrap consequences.
4. DONE (iter 2): micro-strips reduced to one placement.
5. DONE (iter 3): vendor chips classified from bot service code, 6 bridge / 5 dex / 8 aggregator.
6. DONE (iter 3): footer cream retint, incl. dark-context contrast fixes.

7. CLOSED (iter 5, no change needed): mobile 3-line hero verified by screenshot -
   it does not crowd the demo card; subhead, CTAs and card all remain reachable.
8. DONE (iter 5): .sw__vendors-big and .stages__chain moved to weight 500; all four
   serif roles (h1, h2, vendors-big, stages-chain) now report 500.

Open: none. Iteration 5 was the first pass with no open fix-level findings beyond
item 8. Per the convergence rule, ONE more clean full pass and the loop reports
converged and should be stopped with ScheduleWakeup/CronDelete.

## Iteration log
- iter 1: em-dashes removed, eyebrows 6 -> 3, rubric v2 added
- iter 2: :active press states, easing tokenized, micro-strips 2 -> 1
- iter 3: venue chips classified from code, --sw-term-* tokens, footer cream retint
          (+ caught a .sw override and a dark-context contrast bug)
- iter 4: display serif Instrument -> EB Garamond via A/B render; fixed the 3-line
          hero regression it caused (clamp + grid ratio)
- iter 5: full regression sweep after the face change (no overflow at 1440/390,
          Lens A clean); serif weight unified at 500; backlog emptied

## Rubric v2 (from design-engineering research, 2026-08-04)
Additional checkable criteria for Lens A/B (sources: Emil Kowalski's animation tips,
Rauno Freiberg's interaction-design essays, Anthropic frontend-design skill, shadcn theming):
- Motion budget: UI transitions <= 300ms; enter/exit uses ease-out or custom cubic-bezier,
  never bare `ease`/`linear`. Press feedback: `:active` scale ~0.97 on every clickable.
- Frequency rule: HIGH-frequency UI (nav, menus, accordion toggles) gets zero/near-zero
  animation; motion flourish is reserved for LOW-frequency moments (hero, one orchestrated
  reveal). One memorable moment beats scattered micro-animation.
- Never animate scale from 0 (start >= 0.9). transform-origin = trigger, not center.
- Type roles: >= 2 faces with named CSS vars (--font-*), no literal font-family strings in
  component CSS. Palette: 4-6 named hex tokens, every component color traces to a token
  (`grep` raw hex literals in components = drift).
- Line length 50-75ch on body; `text-wrap: balance` on headlines / `pretty` on body.
- Shadows tinted toward bg hue, one light direction; no `rgba(0,0,0,.1)` boilerplate.
- Focus: no `outline:none` without a `:focus-visible` replacement.
- Dead-end audit: zero `href="#"` / no-op buttons; 404 page exists.
- Next-specific: fonts via next/font with CSS-var export (never <link>/@import);
  check per-route `opengraph-image.tsx` (next/og Satori pattern) exists for key pages.
- CWV: no CLS from font swap or unsized images; hero image priority-loaded.
- Guard: restyling EnterpriseContactForm must never touch its submit handler without
  flagging MONEY-PATH (lead-data path to support_notifier).
