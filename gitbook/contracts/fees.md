# Fees & Revenue Sharing

Suwappu charges a tier-based fee on executed swaps and shares that revenue with referrers. One fee engine is the single source of truth across every chain and venue, so the rate you see here is the rate applied everywhere.

## Swap fee tiers

| Tier | Fee | In bps |
|------|-----|--------|
| Free | 1.0% | 100 bps |
| Pro | 0.5% | 50 bps |
| Premium | 0.3% | 30 bps |
| Enterprise | 0.1% | 10 bps |

Swaps are accepted from $1 to $100,000 (USD notional). See the pricing page for what each tier includes.

## Discounts (stack in this order)

1. **Points discount** — earned via XP; capped at 60% of your tier rate, and floored so it can match but never beat the Enterprise rate (10 bps).
2. **Position-card discount** — holding a Suwappu Positions card grants a proportional discount of up to 40% off the post-points rate.
3. **Referee rebate** — joined via a referral link? 10% off your first 5 swaps.
4. **Absolute floor** — the final effective fee never drops below 2 bps (0.02%), which guarantees referral fee-sharing can never be zeroed.

## Referral revenue sharing

Referrers earn from three independent streams.

**Swap commission** — a share of every swap fee your referred users pay: 30% for Standard and Power referrers, 40% for Elite.

**Perps commission** — a share of the Suwappu builder fee on your referred users' HyperLiquid orders, tiered on each referee's 14-day rolling perps volume:

| 14-day referee perps volume | Share of builder fee |
|-----------------------------|----------------------|
| Under $10k | 20% |
| $10k – $50k | 30% |
| $50k – $250k | 40% |
| $250k – $1M | 55% |
| $1M and above | 80% |

**Milestone bonuses** — one-time payouts at 5 ($5), 10 ($15), 20 ($40), 50 ($125), and 100 ($300) verified referrals.

Every payout is idempotent at the database level — keyed per swap, per perp order, and per milestone — so retries and replays can never double-pay.

## How fees are collected

Fees are charged at execution through each venue's native mechanism: a builder fee on HyperLiquid perps (1 bp default, user-approved cap 0.1%), integrator fees on aggregators like AVNU, and referral accounts on Jupiter. Collected fees are consolidated hourly by an automated sweeper with a $1 minimum threshold, keeping collection overhead amortized as volume grows.
