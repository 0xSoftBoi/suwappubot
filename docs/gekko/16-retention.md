# Retention

Why this matters for Gekko: acquisition is cheap when it's cross-sold from Suwappu's existing trading base, but a neobank's economics only work if customers stay and deepen usage — retention is the multiplier on every other number in `15-unit-economics.md`. Gekko's retention strategy leans on financial-primitive stickiness (savings, yield, card) rather than trading activity alone, since trading is inherently spiky.

## Product Stickiness

### What it is
The degree to which a product becomes embedded in a user's regular financial life — recurring balances, scheduled flows, and habitual usage that make switching costly and unlikely.

### How it works / benchmarks
- Direct deposit / payroll linkage is the single strongest stickiness lever in consumer banking — once a paycheck lands somewhere, churn drops sharply (verify magnitude, well-established fintech heuristic).
- Recurring auto-invest/DCA and auto-save features correlate strongly with retention in fintech apps generally (verify, directionally well supported).
- Trading-only products (top Telegram bots) have notoriously low stickiness — users chase whichever bot has the best latency/fee that week (per NEOBANK_ROADMAP.md competitive notes).

### Gekko approach
Anchor stickiness in "Savings" (auto-deposit idle USDC into yield) and scheduled DCA — both already scoped in the roadmap as build items 1-2 — rather than trading volume. A user with money parked earning yield and a recurring buy scheduled is far stickier than a one-off swapper.

### Target / definition
- Definition: % of active users with at least one recurring/standing flow (auto-save, DCA, subscription) active.
- Target: 40% of MAU with ≥1 recurring flow within 6 months of Savings + DCA launch.

## Multi-Product Expansion

### What it is
Growing revenue and retention by getting existing customers to adopt additional products (savings → card → credit → payments) rather than only acquiring new customers.

### How it works / benchmarks
- Retention correlates strongly with products-per-customer in most fintech/banking models — customers with 2+ products churn markedly less than single-product customers (verify magnitude, standard banking heuristic).
- Ether.fi, Zeal, Gnosis Pay all pursue the same wallet → yield → card sequencing Gekko is following (per roadmap competitive snapshot).

### Gekko approach
Sequence expansion deliberately: swap (existing) → savings/yield → scheduled DCA → card → overcollateralized credit → payments (see `20-product-expansion.md`). Use in-app/in-bot nudges keyed off XP milestones to cross-sell the next product rather than generic marketing.

### Target / definition
- Definition: average number of distinct Gekko products (of: swap, save, DCA, card, credit) an active user touches per month.
- Target: 2.0 products/customer average within 12 months (see `19-metrics.md` for the tracked KPI).

## Customer Success

### What it is
Proactive engagement — onboarding help, usage nudges, at-risk-user outreach — distinct from reactive support (see `18-operations.md`), aimed at maximizing activation and reducing silent churn.

### How it works / benchmarks
- Fintech onboarding drop-off is typically steep in the first session; well-designed activation flows (e.g., first successful swap/save within minutes) materially improve day-30 retention (verify exact figures, directionally standard).
- Automated "you earned $X this week" digest messages (already scoped in roadmap item #3) double as a retention/engagement lever, not just a UX nicety.

### Gekko approach
Reuse the roadmap's bank-statement/weekly-digest feature as the core customer-success touchpoint (bot digest + terminal dashboard), supplemented by XP-driven milestone nudges ("you're 200 XP from Gekko Pro"). No dedicated human CS team needed at launch — automate first, hire only once volume justifies it (see `18-operations.md`, `21-scale.md`).

### Target / definition
- Definition: % of new users who complete a "core action" (first save, first scheduled DCA, or first card swipe) within 7 days of signup.
- Target: 50% activation within 7 days.

## Personalization

### What it is
Tailoring the product experience — yield recommendations, spend insights, fee tiers — to individual user behavior rather than a one-size-fits-all interface.

### How it works / benchmarks
- Personalized nudges (spend categorization, savings suggestions) are a standard retention lever in consumer fintech apps (verify specific lift numbers, but directionally well established).
- Crypto-native personalization is underdeveloped industry-wide — none of the top trading bots or terminals personalize beyond basic watchlists (per roadmap competitive notes), which is a white-space opportunity.

### Gekko approach
Use existing XP/activity data to personalize: surface yield-vault suggestions based on idle-balance size, DCA suggestions based on trading history, and card-perk suggestions based on spend category — all computable from data Suwappu already collects, no new data pipeline required at launch.

### Target / definition
- Definition: % of users who received and acted on a personalized in-app/in-bot recommendation in the last 30 days.
- Target: 20% recommendation-to-action conversion within 9 months.

## Switching Costs

### What it is
The friction — real or psychological — that makes it costly for a user to move to a competing product: portability of funds, loss of accrued rewards/XP, re-onboarding effort elsewhere.

### How it works / benchmarks
- Non-custodial architecture (Gnosis Pay, Zeal, Gekko's likely model) inherently lowers switching costs on the "funds are trapped" axis compared to custodial neobanks — funds are always portable. This means Gekko cannot rely on custodial lock-in the way Chime can.
- Loyalty/points programs (XP, tiered fee discounts) are the standard substitute switching-cost lever when funds themselves aren't locked in (verify general applicability).

### Gekko approach
Because Gekko is (mostly) non-custodial, switching costs must come from earned value, not locked funds: XP tier benefits (fee discounts, yield boosts), referral network effects, and the convenience of a unified swap+save+spend+credit surface rather than stitching together multiple apps. Lean into this explicitly rather than trying to manufacture artificial lock-in — see `22-moats.md`.

### Target / definition
- Definition: % of churned-then-returned users who cite "came back for XP/fee tier" in exit/return surveys (qualitative, supplement with churn-cohort analysis).
- Target: no hard number for v1 — instrument return-user surveys once churn cohorts exist (~6 months post-launch).
