# Operations

Why this matters for Gekko: a neobank fails operationally long before it fails on product — support backlog, unresolved disputes, or a sponsor bank relationship going sideways can kill the business regardless of feature quality. This doc scopes the operational surfaces Gekko must staff or automate, sequenced to match the roadmap's build-vs-integrate split.

## Customer Support

### What it is
The frontline function handling user questions, transaction issues, and account problems across bot, WhatsApp, and terminal surfaces.

### How it works / benchmarks
- Consumer neobanks typically run majority-automated support (chatbot/FAQ deflection) with human escalation only for account-security or money-movement issues (verify deflection rates, commonly cited 60-80% for mature fintech support).
- Crypto-native support has a unique failure mode: irreversible on-chain transfers mean "I sent to the wrong address" is unresolvable by support, unlike a traditional bank reversal — this must be set as an explicit user expectation, not discovered in a support ticket.

### Gekko approach
Start with bot/WhatsApp-native structured support flows (command-based, per the roadmap's WhatsApp policy note on staying "command-structured") plus an FAQ/deflection layer; route to human support only for card disputes, KYC issues, and security incidents. Do not promise reversibility on on-chain sends anywhere in the UX copy.

### Target / definition
- Definition: % of support contacts resolved without human escalation.
- Target: 70% automated deflection within 6 months of card launch.

## VIP Support

### What it is
Priority, higher-touch support for high-value or high-XP customers — larger balances, heavier card spend, or top referral-tier users.

### How it works / benchmarks
- Tiered support (standard vs. priority queue) is standard across Mercury, Ramp, and most challenger banks for their higher-value segments (verify specific SLAs).

### Gekko approach
Gate VIP support behind the existing XP/referral tier system rather than building a separate segmentation model — reuse Suwappu's existing tier logic. Pair with the `14-monetization.md` subscription tier (Gekko Pro) as a bundled perk.

### Target / definition
- Definition: median first-response time for VIP-tier tickets vs. standard tier.
- Target: VIP median response under 1 hour; standard under 24 hours.

## Disputes

### What it is
The process for handling card chargebacks, unauthorized-transaction claims, and merchant disputes — a regulated, process-heavy function distinct from general support.

### How it works / benchmarks
- Visa/Mastercard chargeback processes carry strict timelines (typically 10-45 days depending on reason code, verify exact figures) and require documented evidence submission.
- Card-issuing processors (Marqeta, Lithic) typically provide dispute-management tooling/workflow as part of the platform (verify per-processor).

### Gekko approach
Disputes on the card rail follow the card processor/sponsor bank's mandated workflow — do not build custom dispute logic; use the tooling the processor provides and staff a small ops function to manage the queue. On-chain "disputes" (scam transfers, wrong-address sends) are explicitly out of scope for reversal — handle as fraud-education/support cases only.

### Target / definition
- Definition: % of card disputes resolved within network SLA.
- Target: 100% filed within network deadline (this is a compliance floor, not an aspiration).

## Treasury Ops

### What it is
The operational function managing where customer stablecoin balances sit — yield vault allocation, rebalancing, liquidity for redemptions/spend, and reconciliation.

### How it works / benchmarks
- DeFi vault operators (Morpho curators, Aave allocators) run active risk monitoring on vault health, utilization, and liquidation risk (verify per-protocol specifics).
- Redemption liquidity is the key operational risk: if too much balance sits in yield vaults with withdrawal delays, spend/card funding can fail.

### Gekko approach
Keep a defined "liquid buffer" — a fixed % of a user's balance stays instantly spendable/withdrawable, with only the surplus auto-deposited into Morpho/Aave vaults (mirrors the roadmap's "withdraw-on-trade" savings design). Automate rebalancing; monitor vault health via existing on-chain read infra (multicall3 balance reads already in use).

### Target / definition
- Definition: % of card/spend transactions that succeed without a liquidity-triggered delay.
- Target: 99.9% instant-settlement rate for spend against yield-parked balances.

## Credit Ops

### What it is
Operational management of the overcollateralized credit product — monitoring collateralization ratios, liquidation triggers, and borrower notifications.

### How it works / benchmarks
- Aave/Morpho handle liquidation execution at the protocol level; the operational burden on Gekko is monitoring and proactive user notification before liquidation (verify protocol-specific liquidation mechanics).

### Gekko approach
Since credit is overcollateralized and protocol-managed, Gekko's Credit Ops role is monitoring + notification, not underwriting: alert users approaching liquidation thresholds via bot/push notification well before the protocol acts, reusing the existing alert_service background task already running in `api/main.py`.

### Target / definition
- Definition: % of users notified before hitting a liquidation threshold (vs. notified only after).
- Target: 95% of at-risk positions flagged at least 1 warning threshold before liquidation.

## Fraud Ops

### What it is
The team/process actively monitoring for and responding to fraud patterns — card fraud, account takeover, and on-chain scam activity — distinct from the automated detection tooling described in `15-unit-economics.md`.

### How it works / benchmarks
- Mature fintech fraud ops run 24/7 monitoring queues with escalation runbooks for account freezes (verify staffing models, varies widely by scale).

### Gekko approach
At launch scale, Fraud Ops is a shared responsibility of the on-call engineering rotation (reusing existing incident-responder patterns from `docs/deployment/monitoring.md`) rather than a dedicated team; graduate to dedicated fraud-ops staffing once card volume justifies it (see `21-scale.md`).

### Target / definition
- Definition: median time from fraud-signal detection to account action (freeze/hold).
- Target: under 15 minutes for high-confidence signals.

## Sponsor Bank Management

### What it is
The relationship management function overseeing Gekko's regulated partners — the sponsor/BIN-sponsor bank, card processor, and ramp providers — who own the licensed layer the roadmap explicitly says Gekko should never try to build itself.

### How it works / benchmarks
- Sponsor bank relationships require ongoing compliance reporting, BSA/AML program alignment, and periodic audits (verify exact cadence per partner).
- Partner risk is existential: a sponsor bank exiting the relationship (as has happened industry-wide to several fintechs) can halt card/ramp operations overnight — this is the single largest operational tail risk for any neobank built on a partner-bank model.

### Gekko approach
Treat sponsor-bank relationship health as a standing risk item reviewed at the same cadence as security/compliance reviews, not a "set and forget" integration. Maintain a documented contingency plan (backup processor/sponsor candidates) given the roadmap already names multiple viable partners (Gnosis Pay B2B, Immersve, Column-style sponsor banks).

### Target / definition
- Definition: existence and freshness of a documented sponsor-bank contingency plan.
- Target: contingency plan reviewed quarterly starting from card launch.
