# /passport brand consistency review

Read-only. Compared `showcase/src/app/passport/passport.module.css` +
`.summer-page--passport` (globals.css:5811-5832) against the showcase
homepage (globals.css `:root` tokens, `.summer-nav__cta`) and
`packages/design-tokens`. Showcase-dev is editing the page in parallel —
nothing here has been applied.

## 0. Framing: which token system applies

`showcase/` does not import `packages/design-tokens` at all (confirmed:
no reference to `@suwappu/design-tokens` in `showcase/`). Showcase's real
token layer is the `:root` block in `showcase/src/app/globals.css`
(`--sw-accent`, `--sw-soil-*`, `--font-serif`, `--font-mono`, `--btn-cut`),
which is warm-persimmon and dark-cosmic on the homepage hero, distinct
from `packages/design-tokens`' cream/sakura palette used by
terminal/webapp/mobile. This is the System A/B split noted in my brief —
**escalate, don't silently pick one**. For this review I graded passport
against showcase's own local tokens (System B, since that's what it
composes from and what's actually live at suwappu.bot), not
`packages/design-tokens`, since applying the latter would be a much larger
rewrite than a brand-consistency pass.

## 1. Colors

Most of the page does pull from `--sw-accent*` / `--sw-soil-*` correctly
(orb, CTA gradient, checkmarks, spinner, receipt badges). Hard-coded hex
found:

| Severity | Location | Value | Should be |
|---|---|---|---|
| Low | `passport.module.css:38` `.h1` | `color: #fff` | Page ground is `--sw-soil-0/1` (near-black); `#fff` for max-contrast headline text is fine on this dark ground, but it's used inconsistently — `.lede` uses `rgba(244,244,246,0.72)` for the same "white text" family. Should be a single `--sw-ink-on-dark` (e.g. `#fff` or `#f4f4f6`) token, not two ad-hoc literals for what's meant to read as one text-color scale. |
| Low | `.orbCore` background (~line 108) | `#f7b2a0`, `#fbe3c4` | These are one-off gradient stops not derived from any `--sw-accent*` token. No token exists for this coral/peach mid-stop — propose `--sw-accent-warm: #f7b2a0` and `--sw-accent-pale: #fbe3c4` in globals.css `:root` so the orb's palette is named and reusable, not hidden in a single component. |
| Low | `.narrationLine[data-state='error']` (~line 220) | `#f2a5a0` | No `--sw-error*` token exists anywhere in globals.css — every error state on this page (`#f2a5a0`, `#e2726b`, `#f87171`, `#f2a5a0` again) is a distinct hard-coded red. Propose a single `--sw-danger` / `--sw-danger-bright` pair; collapse all four to it. |
| Low | `.narrationDotError` | `#e2726b` | Same as above — second, slightly different red. |
| Low | `.dot[data-state='down']` (statusStrip) | `#f87171` | Third distinct red for the same semantic "error/down" state on one page. |
| Low | `.dot[data-state='up']` / `pulse` keyframes | `#4ade80`, `rgba(74,222,128,…)` | No `--sw-success*` token exists. Same drift risk — this exact green is also likely reused ad hoc elsewhere in the showcase (worth a repo-wide grep by showcase-dev). |
| Info | `.modalBackdrop` | `rgba(6,7,8,0.66)` | Close to but not equal to `--sw-soil-0` (`#0D0F12`) with alpha — should be `color-mix(in srgb, var(--sw-soil-0) 66%, transparent)` so it tracks the ground if soil tokens ever shift. |
| Info | Whites/greys throughout (`rgba(244,244,246,0.XX)`) | consistent | These *are* consistently reused (12+ occurrences of the same `244,244,246` triplet at varying alpha) — good practice, just never promoted to a token. Propose `--sw-ink-dark-rgb: 244,244,246` so alpha variants become `rgba(var(--sw-ink-dark-rgb), 0.72)` instead of retyped literals; low severity, but it's the single value most at risk of a future fat-finger drift (14 independent literals of the same RGB triplet).

**Verdict on hue**: orb/CTA/accent correctly derive from `--sw-accent*`, no drift there. The real gap is **three unrelated hard-coded reds and one hard-coded green with zero semantic tokens backing them** — the exact "same value computed in two+ places" pattern flagged as a recurring bug class in this repo (watch-only filters, referral counting, card palettes). Recommend `--sw-danger`, `--sw-danger-bright`, `--sw-success` added to globals.css `:root` before this ships, and every literal above pointed at them.

## 2. Type

- `.h1` and `.resultName` use `var(--font-serif)` — matches homepage hero pattern (confirmed serif token used consistently for display headlines elsewhere in globals.css).
- Mono labels (`.poweredBy`, `.resultKicker`, `.techToggle`, `.techLabel`, `.statusStrip`) all use `var(--font-mono)` — consistent with the 30+ other `var(--font-mono)` usages in globals.css. No drift.
- Body copy (`.lede`, `.narrationLine`, `.hint`, `.modalHint`) has no explicit `font-family` — inherits page default, consistent with homepage body text. Fine.
- Sizes are all bespoke `rem`/`clamp()` values local to this module, not pulled from a shared type scale — but `packages/design-tokens` doesn't define a type scale showcase consumes either, and globals.css itself doesn't centralize one (its ~30 mono usages each hand-set their own `font-size`). This is **pre-existing showcase-wide practice, not something passport introduced** — no new drift, but also nothing to enforce against. Flag to showcase-dev as a backlog item (extract a `--fs-*` scale), not a passport-specific defect.

## 3. Voice

Headline/lede/error copy is on-brand in register — spare, no hype words, "Give your AI agent an identity people can trust" and error strings ("Couldn't reach the verification service. Give it another try.") match the restrained, infrastructure-grade tone used elsewhere. Technical-details-as-jargon-dump pattern (`.techSection` comment: "all jargon lives here") is a good, intentional voice split and worth keeping.

**One overclaim, Medium/High severity:**

`showcase/src/app/passport/PassportPageClient.tsx` (lede, ~line 155):

> "A human confirms they're real, and **every trade the agent makes after that is covered by that trust — automatically**."

This is not literally true against the current api-ts implementation:

- `api-ts/src/services/SwapService.ts:52-55` — the World ID field on the fee-quote type is documented in-code as "**World ID fee-discount lookup only** (agents.metadata.worldId.verified) — never trust this object for anything beyond selecting the fee rate."
- `api-ts/src/routes/agent.ts:599` — `worldIdAuth() middleware was superseded by the hackathon/tokyo2026/world-id` flow.
- `api-ts/src/routes/agent.ts:4425-4427` — the passport-linking nullifier is explicitly a **distinct action from the trade-approval gate**, "so nullifiers don't collide across features (same human verifying for a trade vs. for linking an agent must yield independent nullifiers)." I.e. per-trade approval is its own separate verification action, not something the one-time passport-link automatically extends to all future trades.

So the mechanism is: verify once → agent gets a name + (at most) a fee discount. Trade-level trust, if enforced at all, requires its own separate per-trade gate — it is not "automatically" inherited from the passport step. As written this reads like every subsequent trade is cryptographically guaranteed/covered, which overstates what the code does and risks a compliance read ("covered by that trust" adjacent to trading, on a page that also handles tokenized-asset flows) even though it isn't literally an equity/securities claim.

**Suggested honest rewording** (for showcase-dev, not applied):
> "A human confirms they're real, and the agent carries that proof with it — so counterparties and fee tiers can tell a verified human is behind it."

or, more minimal:
> "A human confirms they're real once, and the agent's identity carries that verification from then on."

Either drops "every trade… covered… automatically," which is the specific clause with no code behind it.

## 4. CTA / button silhouette

**Confirmed intentional-looking divergence, flag to escalate anyway.** Homepage CTAs (`.summer-nav__cta`, `.summer-nav__cta--ghost`, globals.css:449-467) use `clip-path: var(--btn-cut)` — the shared angular-cut silhouette — plus hard-coded `border: 1px solid #d17a1e` and a hard-coded gradient (`linear-gradient(180deg, #f6a93c, #e58d2b)`) that duplicate `--sw-accent-deep`/`--sw-accent-bright`/`--sw-accent` instead of referencing them (pre-existing drift in globals.css, not introduced by passport — worth its own follow-up).

`.cta` in passport.module.css (line ~172) uses `border-radius: 999px` (full pill) and **no** `--btn-cut` clip-path at all — a different silhouette family for the primary action button on a page that otherwise reuses every other homepage token. Given the page's own header comment calls this "a calm AI-product canvas, not a crypto dApp," the pill likely *is* a deliberate softer register for this one flow. But per standing rule ("two implementations of one rule is the bug"), a second CTA silhouette used nowhere else in the codebase is exactly the kind of divergence that should be a named decision, not an implicit one. **Escalating, not fixing**: confirm with product/design whether "AI-product canvas" pages are meant to diverge from `--btn-cut`, and if so, name it (e.g. a `--btn-cut-soft: 999px` token) so the next AI-product-style page reuses the decision instead of re-deriving it.

## Summary of asks for showcase-dev

1. Add `--sw-danger`, `--sw-danger-bright`, `--sw-success` tokens to globals.css `:root`; repoint the 5 hard-coded reds/greens in passport.module.css at them.
2. Reword the lede to drop the "every trade… covered… automatically" claim — it isn't backed by the trade-approval gate, which is a separate per-trade action per `agent.ts:4425`.
3. Confirm CTA pill-vs-`--btn-cut` divergence is a deliberate "AI-product canvas" decision; if yes, name it as a token so it's not a silent one-off.
4. Backlog (not blocking): promote the repeated `244,244,246` ink-on-dark RGB triplet to a `--sw-ink-dark-rgb` var.
