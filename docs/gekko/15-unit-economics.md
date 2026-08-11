# Unit Economics

Why this matters for Gekko: monetization lines only matter if the per-customer math works — Gekko must know what it costs to acquire, serve, and reward a user against what that user is worth, or growth just accelerates cash burn. This doc sets the model Gekko tracks from day one, reusing Suwappu's existing user base as a low-CAC acquisition channel.

## Revenue Per Customer

### What it is
The blended revenue Gekko earns per active customer per period, summing interchange, yield spread, swap fees, credit NIM, and subscriptions.

### How it works / benchmarks
- Chime ARPU estimates: ~$100-150/year (verify, widely cited range from interchange-heavy model).
- Crypto trading bots monetize almost entirely on swap fees; Suwappu's existing swap-fee revenue per active trader is the internal baseline (pull from `bot/services` fee ledger).
- Mercury/Ramp (B2B) ARPU is much higher (thousands/year) but not a comparable consumer benchmark.

### Gekko approach
Track ARPU as swap fees + yield spread + interchange (once card ships) + subscription, computed monthly per active wallet. Use Suwappu's existing fee/referral tables as the source of truth rather than building new instrumentation.

### Target / definition
- Definition: total monthly revenue ÷ monthly active customers.
- Target: $8-12/month blended ARPU within 12 months of card + yield launch (verify against early cohort data before treating as firm).

## Gross Margin

### What it is
Revenue per customer minus direct costs to serve them — card processing/network fees, KYC/compliance vendor costs, custody/infra, support costs.

### How it works / benchmarks
- Neobank gross margins on interchange-heavy models: typically 40-60% after processor and fraud costs (verify).
- On-chain yield spread is near-100% gross margin (protocol does the work); this is a structural advantage vs. pure fintech.
- Card issuance/processing (Marqeta/Lithic-style) fees: typically a few bps to low single-digit dollars per active card per month (verify).

### Gekko approach
Model gross margin per revenue line separately: yield spread and swap fees are high-margin (reuse existing infra, near-zero marginal cost); interchange and credit carry processor/compliance costs that compress margin. Report blended and per-line margin monthly.

### Target / definition
- Definition: (revenue - direct COGS) ÷ revenue, blended and per product line.
- Target: 55%+ blended gross margin at steady state; yield/swap lines held to 90%+.

## CAC

### What it is
Customer acquisition cost — fully loaded spend (marketing, referral rewards, onboarding incentives) divided by new customers acquired in a period.

### How it works / benchmarks
- Neobank consumer CAC benchmarks: Chime historically ~$50-100 (verify, has risen over time with competition); challenger banks broadly range $20-200 depending on channel.
- Crypto-native CAC via existing community/referral loops is typically far lower than paid acquisition (verify, no hard public number, but referral-driven fintechs like Cash App/Chime cite referral CAC well under $20).
- Suwappu already has an existing user base + referral/XP system — this is a materially lower-CAC starting position than a cold-start neobank.

### Gekko approach
Treat existing Suwappu traders as CAC-zero (or near-zero) conversions into Gekko via in-bot/in-app prompts; reserve paid CAC budget only for net-new-to-crypto users, funneled through the existing referral program with XP-boosted incentives instead of cash bounties where possible.

### Target / definition
- Definition: total acquisition spend (incl. referral payouts) ÷ new funded accounts.
- Target: blended CAC under $25, with cross-sell-from-Suwappu CAC under $5.

## LTV

### What it is
The total discounted revenue (net of direct costs) Gekko expects to earn from a customer over their lifetime with the product.

### How it works / benchmarks
- Standard fintech target ratio: LTV:CAC ≥ 3:1 (verify, common SaaS/fintech heuristic, not crypto-specific).
- Neobank customer lifetimes vary widely by retention cohort — see `16-retention.md`; a 24-36 month average lifetime is a reasonable planning assumption (verify).

### Gekko approach
Compute LTV as (blended monthly gross margin per customer) × (expected lifetime months), where lifetime is derived from actual Suwappu/Gekko retention curves, not assumed. Revisit quarterly as cohort data matures — do not publish an LTV number built on fewer than 3 months of real retention data.

### Target / definition
- Definition: cumulative gross-margin revenue per customer over expected tenure.
- Target: LTV:CAC ≥ 3:1 within 18 months; report as a range with confidence bounds until cohorts mature.

## Rewards Cost

### What it is
The cost of XP, referral bonuses, cashback, or yield-boost promotions used to acquire and retain customers — a direct hit to gross margin that must be tracked separately from "marketing."

### How it works / benchmarks
- Crypto-native reward programs (points/airdrop-style) can run hot early (10%+ of revenue) then taper as the program matures (verify, no universal benchmark).
- Cash App/Chime cashback and referral bonus programs are typically capped as a fixed % of qualifying spend (verify).

### Gekko approach
Reuse Suwappu's existing XP/points/referral engine rather than building a new rewards ledger — extend it to cover card spend and yield-boost promos. Cap total rewards spend as a % of gross revenue (not a fixed dollar budget) so it scales down automatically if revenue underperforms.

### Target / definition
- Definition: total rewards cost (XP redemption value + referral payouts + promos) ÷ total revenue.
- Target: keep under 15% of gross revenue after the first 6 months (higher is acceptable during initial launch incentive period).

## Fraud Losses

### What it is
Losses from card fraud, account takeover, chargebacks, and scam-induced transfers — a standard neobank cost line that is structurally different in a crypto-native product (on-chain transfers are irreversible; card fraud follows traditional patterns).

### How it works / benchmarks
- Card-not-present fraud rates industry-wide: often cited around 0.05-0.15% of transaction volume for well-controlled programs (verify).
- Crypto-specific risk: on-chain transfers have no chargeback mechanism, so social-engineering/scam losses can be worse per-incident even if lower in frequency — social-engineering scam losses are a known growth area industry-wide (verify magnitude).

### Gekko approach
Split fraud monitoring into two tracks: card-rail fraud (standard velocity/device/geo rules via the card processor) and on-chain scam-transfer detection (address risk-scoring, large-transfer confirmation friction, referencing patterns from `bot/utils` rate limiting). Do not assume card-fraud tooling covers on-chain risk — it doesn't.

### Target / definition
- Definition: fraud losses ÷ total transaction volume (card + on-chain).
- Target: under 0.15% of card volume; on-chain scam losses tracked as a separate metric with a target set after 2 quarters of baseline data.

## Credit Losses

### What it is
Losses from borrowers defaulting or collateral value dropping below the loan balance faster than liquidation can occur — for Gekko, primarily overcollateralized crypto-credit liquidation slippage rather than traditional unsecured default.

### How it works / benchmarks
- Aave/Morpho overcollateralized lending: historically near-zero protocol-level bad debt in liquid markets, but liquidation slippage/bad debt spikes during high volatility (verify, has happened in isolated market crashes).
- Unsecured consumer credit losses (if ever added via bank partner): typically 2-8% of receivables depending on underwriting quality (verify) — not applicable to Gekko's permissionless credit product.

### Gekko approach
Because Gekko's v1 credit product is overcollateralized and permissionless (GHO/Morpho-backed), Gekko itself carries no direct credit risk — the protocol's liquidation engine does. Track liquidation-shortfall events as an operational metric, not a balance-sheet loss, unless/until Gekko adds a proprietary lending pool.

### Target / definition
- Definition: unrecovered collateral shortfall ÷ total credit extended.
- Target: 0% direct balance-sheet credit loss for v1 (protocol-absorbed); revisit if Gekko originates proprietary credit.
