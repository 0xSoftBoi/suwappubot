# Gekko — Mobile Neobank Master Plan

Gekko is our mobile-app neobank: trading-grade crypto rails (Suwappu's existing
wallets, 7-chain swaps, stablecoin infra, KMS key management) fused with real
bank primitives (accounts, cards, ACH/wires, credit, treasury yield). Prior
competitive research lives in [`../NEOBANK_ROADMAP.md`](../NEOBANK_ROADMAP.md);
this directory is the full operating structure — every pillar of the business,
one doc each, with vendor options, a recommended Gekko default, and a build
checklist per subsection.

## Structure

| # | Pillar | Doc |
|---|--------|-----|
| 01 | Infrastructure (sponsor bank, issuer, yield, virtual ACH, wallets, stablecoin orchestration) | [01-infrastructure.md](01-infrastructure.md) |
| 02 | Regulatory & Compliance (KYC/KYB, AML, sanctions, monitoring, program) | [02-regulatory-compliance.md](02-regulatory-compliance.md) |
| 03 | Core Banking Product (checking, savings, debit, credit, ACH, wires, stablecoins, travel/concierge) | [03-core-banking-product.md](03-core-banking-product.md) |
| 04 | Money Movement (ACH, wires, RTP/FedNow/Swift, push-to-card, stablecoins, cross-border) | [04-money-movement.md](04-money-movement.md) |
| 05 | Cards (debit, credit, employee, controls, rewards, premium/metal) | [05-cards.md](05-cards.md) |
| 06 | Credit (underwriting, debt facility, working capital, revolving, term, collections) | [06-credit.md](06-credit.md) |
| 07 | Treasury (T-bills, MMFs, yield, liquidity, FDIC) | [07-treasury.md](07-treasury.md) |
| 08 | ICP & Positioning (consumer → UHNW, crypto-native beachhead) | [08-icp-positioning.md](08-icp-positioning.md) |
| 09 | Distribution (founder brand, organic, referral, partnerships, vertical SaaS, enterprise) | [09-distribution.md](09-distribution.md) |
| 10 | Customer Acquisition (social, SEO/GEO, paid, events, influencers, one-to-many) | [10-customer-acquisition.md](10-customer-acquisition.md) |
| 11 | Onboarding (signup → KYC → approval → first deposit → card → first txn → DD switch) | [11-onboarding.md](11-onboarding.md) |
| 12 | Activation (fund, link bank, wallet provisioning, DD/payroll move, first bill, first spend) | [12-activation.md](12-activation.md) |
| 13 | Primary Account Strategy (DD, payroll, AP/AR, bill pay, accounting, multi-product) | [13-primary-account-strategy.md](13-primary-account-strategy.md) |
| 14 | Monetization (interchange, float, treasury yield, credit, FX, wires, subscriptions) | [14-monetization.md](14-monetization.md) |
| 15 | Unit Economics (RPC, gross margin, CAC, LTV, rewards/fraud/credit cost) | [15-unit-economics.md](15-unit-economics.md) |
| 16 | Retention (stickiness, expansion, success, personalization, switching costs) | [16-retention.md](16-retention.md) |
| 17 | Risk (fraud, credit, ACH returns, chargebacks, reserves, loss prevention) | [17-risk.md](17-risk.md) |
| 18 | Operations (support, VIP, disputes, treasury/credit/fraud ops, sponsor bank mgmt) | [18-operations.md](18-operations.md) |
| 19 | Metrics (deposits, balances, TPV, card spend, funded accounts, PPC, margin, CAC/LTV, NRR) | [19-metrics.md](19-metrics.md) |
| 20 | Product Expansion (banking, credit, payments, treasury, accounting, payroll, wealth) | [20-product-expansion.md](20-product-expansion.md) |
| 21 | Scale (hiring, engineering, sales, partnerships, ops, risk/compliance, international, M&A) | [21-scale.md](21-scale.md) |
| 22 | Moats (distribution, brand, banking relationships, regulatory infra, data, credit, switching costs) | [22-moats.md](22-moats.md) |

## Sequencing (high level)

1. **Phase 0 — Permissionless core (now):** stablecoin accounts + on-chain yield
   (Aave/Morpho/Sky), cross-chain balance/statement views, ENS payments — all
   buildable on existing Suwappu rails with no bank partner.
   - [x] Earn: Aave V3 USDC savings — mobile Earn tab + `/v1/mobile/earn`
     (deposit/withdraw, money-path reviewed and hardened) — Aug 2026
   - [x] Statement framing: savings surfaced in Money + "Earning ~$X/day" on
     Today — Aug 2026
   - [x] Send/Receive: USDC-on-Base transfers (`/v1/mobile/send`, money-path
     reviewed: nonce reservation, DB-backed idempotency, gas precheck,
     contract-recipient guard) + Receive w/ copy (QR deferred) — Aug 2026
   - [x] Credit (read): Morpho position via `/v1/mobile/borrow` + health-factor
     Credit section on Money — Aug 2026
   - [x] Monthly statement: `/v1/mobile/statement` + statement screen — Aug 2026
   - [x] ENS payments: `name.eth` recipients in Send (`/v1/mobile/resolve`) — Aug 2026
   - [x] Savings goals: goals CRUD + progress on Earn tab (single-pot v0) — Aug 2026
   - [ ] Recurring transfers / auto-save DCA — not started (needs worker design
     + money-path review)
2. **Phase 1 — Card + on/off-ramp:** non-custodial debit (Gnosis Pay / Immersve
   track) + fiat ramps (Bridge/Stripe, Monerium SEPA), Apple/Google wallet
   provisioning.
3. **Phase 2 — US banking rails:** sponsor bank + BaaS (virtual ACH accounts,
   FDIC pass-through), KYC program, direct-deposit switch. This unlocks
   checking/savings, interchange at scale, and the primary-account strategy.
4. **Phase 3 — Credit + treasury:** secured/overcollateralized credit first,
   then underwritten revolving credit and T-bill/MMF treasury products.
5. **Phase 4 — Expansion:** SMB, payroll/AP-AR/accounting, wealth, international.

Each phase's exit criteria and metrics live in the pillar docs above.
