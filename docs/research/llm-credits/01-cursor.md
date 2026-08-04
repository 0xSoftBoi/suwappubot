# Cursor (Anysphere) pricing & inference economics

Researched 2026-08-04. Every claim dated with source; UNVERIFIED items flagged explicitly.

## 1. Pricing timeline

- **Pre-June 2025:** Pro = 500 "fast" requests/month on frontier models, then unlimited
  "slow" requests. Sonnet-class counted as 2 requests.
  ([Cursor blog, 2025-07-04](https://cursor.com/blog/june-2025-pricing))
- **2025-06-16 — the shift.** Pro moved from request-counting to a **$20/mo
  dollar-denominated credit pool priced at raw API rates**, plus unlimited Tab and unlimited
  "Auto" model usage. Same day: **$200/mo Ultra** (20x Pro usage) for power users wanting
  predictability. Ultra explicitly credited multi-year compute partnerships with OpenAI,
  Anthropic, Google and xAI. ([Cursor blog](https://cursor.com/blog/new-tier))
- **June–July 2025 — backlash.** Users found the $20 pool exhausted after a handful of
  agentic prompts; **effective per-workflow cost jumps of "20x or more"** were reported.
  Root causes cited: no customer segmentation, no grandfathering, inconsistent messaging
  about what "unlimited" meant.
  ([FinTech Weekly](https://www.fintechweekly.com/magazine/articles/cursor-pricing-change-user-backlash-refund),
  [HackerNoon](https://hackernoon.com/cursors-credit-based-plans-leave-developers-puzzled-frustrated))
- **2025-07-04 — apology + refunds.** Cursor admitted the rollout "was not clear enough and
  came as a surprise," and offered usage refunds for the June 16 – July 4 window.
  ([Cursor blog](https://cursor.com/blog/june-2025-pricing))
- **2025-10 — Cursor 2.0 + Composer.** First proprietary coding LLM, built for agentic
  workflows. Explicit goals: lower per-inference cost, reduce dependence on third-party API
  pricing. ([MindStudio](https://www.mindstudio.ai/blog/what-is-cursor-composer-model-frontier-lab))
- **2026-04-17 — the margin story.** TechCrunch reported Cursor in talks to raise $2B+ at
  $50B. Same reporting: Cursor **operated at negative gross margins** through most of
  2024–early 2025, with COGS dominated by Anthropic/OpenAI inference and power users
  representing direct pass-through losses.
  ([TechCrunch](https://techcrunch.com/2026/04/17/sources-cursor-in-talks-to-raise-2b-at-50b-valuation-as-enterprise-growth-surges/))
- **2026-06-16 — SpaceX acquires Anysphere for $60B in stock.** Strategic purpose includes
  routing Cursor onto xAI's Colossus to further cut third-party inference dependence.
  ([TechCrunch](https://techcrunch.com/2026/06/16/spacex-to-acquire-cursor-for-60b-in-stock-days-after-blockbuster-ipo/),
  [Bloomberg](https://www.bloomberg.com/news/articles/2026-06-16/spacex-cements-60-billion-deal-to-take-over-ai-startup-cursor))
- **2026-07-22 — "Cursor Router" ships**, formalizing Auto-mode routing (see §4).
  ([Cursor blog](https://cursor.com/blog/router))

### Current plan structure (as of 2026-08-04)

Synthesized from secondary sources; treat exact dollars as approximate.

| Plan | Price | Included |
|---|---|---|
| Hobby | $0 | Limited Auto usage, no premium pool |
| Pro | $20/mo | Unlimited Tab + Auto, **$20 credit pool** at API rates |
| Pro+ | $60/mo | 3x the Pro pool |
| Ultra | $200/mo | 20x the Pro pool (~4,500 Sonnet-class req/mo at launch) |
| Teams | $40/user/mo | Centralized billing, SSO, admin |
| Teams Premium | $120/mo (reported) | 5x Standard usage — **UNVERIFIED** (secondary only) |

## 2. Unit economics

- **Negative gross margins confirmed** through most of 2024–early 2025, because heavy
  agentic users cost more in API pass-through than their subscription covered. This was the
  direct driver of the June 2025 overhaul. ([TechCrunch, 2026-04-17](https://techcrunch.com/2026/04/17/sources-cursor-in-talks-to-raise-2b-at-50b-valuation-as-enterprise-growth-surges/))
- **Bifurcated margins in 2026:** slight gross-margin profitability on *large enterprise*
  accounts only, driven by Composer routing and cheaper models (e.g. Kimi). **Free and
  Pro-tier individual accounts remained loss-making.** (same source)
- **COGS ratio:** at ~$2B ARR, an estimated 40–70 cents of every revenue dollar went to
  inference — *UNVERIFIED*, Anysphere is private and publishes no COGS.
- **No markup on overage.** Cursor bills pay-as-you-go "at the same API rates." The margin
  lives in the **subscription price vs. included-pool ratio**, not in per-token overage.

## 3. Mechanics of "unlimited with rate limits"

- **Two-tier limiter:** burst limits (short-term ceiling for spiky work, slow refill) and
  sustained limits (full refill every few hours).
  ([SessionWatcher](https://sessionwatcher.com/guides/cursor-rate-limits-explained))
- **At exhaustion:** falls back to **unlimited Auto mode** (cheap routed model) by default.
  If the user enabled usage-based billing, it continues at raw API rates. There is **no hard
  stop** for users opted into overage — the wall only exists for those who never enable it.

## 4. Model routing — the big lever

- **Cursor Router (2026-07-22):** a classifier trained on 600k+ live requests, validated by
  online A/B test across millions of production requests, assigning each request to a model
  by query complexity, context needs, and provider availability.
- **Claimed economics: "frontier-quality output at 60% lower cost"** vs routing everything
  to Opus-class. Three high-volume pilots saved 30–50% vs all-Opus with no quality decrease
  per Cursor. ([Cursor blog](https://cursor.com/blog/router))
- **Three user-visible modes** on a cost/intelligence frontier: Intelligence, Balance, Cost.
- **This is the mechanism** that lets Auto be "unlimited" while Opus-class draws down the
  paid pool: simple tasks route cheap, complex tasks route expensive and get metered.
- Known friction: users can't always tell which model wrote their code; mid-conversation
  model switches cause cache misses that add cost and latency.

## 5. BYOK

- Historically, a personal API key unlocked **only standard chat completions**. Agent/Edit
  features explicitly could not be billed to a user key: *"Agent and Edit rely on custom
  models that cannot be billed to an API key."*
  ([Apidog](https://apidog.com/blog/cursor-byok-ban-alternative/))
- **Late 2025:** BYOK reportedly removed entirely — **UNVERIFIED**; no Cursor-authored
  announcement found, and an active community thread asking "when will Cursor fully support
  BYOK?" suggests the situation is partial/contested rather than a clean deprecation.
- **Reading:** BYOK threatens the margin model once a company depends on premium-model
  bundling for revenue. Cursor restricted it precisely at the boundary where it would bypass
  margin, while leaving it for basic chat.

## 6. Postmortems

Only one Cursor-authored: **"Clarifying our pricing," 2025-07-04** — acknowledges poor
communication, offers refunds, explains the pool rationale ("the hardest requests cost an
order of magnitude more than simple ones").

## Lessons for Suwappu

1. **Don't silently swap the unit of account.** Cursor's core mistake: changing "requests" →
   "dollars at raw API rates" without re-pricing user expectations. A 20x effective jump
   blindsided users and forced a public apology plus refunds.
2. **Segment before you throttle.** Grandfather existing heavy users or give a transition
   window when tightening any limit.
3. **Loss-making cheap tiers are normal — but know your bifurcation.** Cursor is *still*
   loss-making on individual accounts in 2026. Know which tier loses money deliberately.
4. **Route cheap by default, reserve expensive for flagged-complex work.** The 60% saving
   claim is the shape of savings available to anyone mediating LLM calls.
5. **No markup on overage; markup lives in the included-pool ratio.** Cleaner mental model,
   avoids "surprise premium fee" complaints.
6. **BYOK is existential-risk only where it bypasses your margin.** Restrict at that
   boundary, don't blanket-ban.
7. **A hard stop is bad UX; silent fallback to a cheap model is good UX.** Avoids the "your
   bot stopped working" failure mode while capping cost exposure.
