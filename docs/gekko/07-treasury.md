# Treasury

"Idle balances earn 0%" is the roadmap's headline gap — hundreds of millions
in user USDC sits idle across every top bot/terminal while Aave/Morpho pay
4-6% APY, and item #1 on the prioritized roadmap is exactly this: auto-deposit
idle balances into yield. This file extends that into the full treasury
stack — what backs the yield, how Gekko manages its own liquidity, and where
a KYC'd T-bill track (Ondo USDY) fits as an optional, not default, layer.

## Treasury Bills

### What it is
Short-duration US government debt, the benchmark "safe yield" instrument
that both traditional neobanks (via sweep programs) and crypto platforms
(via tokenized T-bill funds) use to pay users a risk-free-ish rate on cash.

### Vendor / provider options
- **Ondo USDY** — tokenized T-bill yield (~4.65%, verify current rate), requires KYC at issuance per the roadmap's own conclusion.
- **Superstate** — on-chain tokenized short-duration Treasury fund, institutional-grade compliance wrapper (verify eligibility for retail).
- **OpenEden** — tokenized T-bill vault (OpenEden TBILL), another on-chain option.
- **BNY / Dreyfus sweep** — traditional off-chain T-bill sweep, relevant only if Gekko holds a real cash/custody relationship.

### Gekko default
Optional, KYC'd dual-track via **Ondo USDY**, exactly as the roadmap
concludes — never the default for a non-KYC'd user. The default yield
experience stays fully permissionless via Aave/Morpho (see Yield Products
below); USDY is an opt-in "verify your identity for a higher/more stable
rate" upgrade path.

### Build checklist
- [ ] KYC flow gated specifically to the USDY opt-in (not required for base product)
- [ ] USDY balance display alongside Aave/Morpho positions in portfolio view
- [ ] Redemption/liquidity terms disclosure (T-bill funds are not instant-redeem like a DeFi pool)
- [ ] (verify) Confirm Ondo USDY current yield and jurisdiction restrictions before launch copy

## Money Market Funds

### What it is
Pooled, professionally managed short-term debt funds — the traditional-finance
analog to a stablecoin yield vault, usually accessed through a bank/brokerage
sweep rather than directly by a retail app.

### Vendor / provider options
- **Treasury Prime partners** — banking-as-a-service network with money-market sweep options for partner banks.
- **Modern Treasury** — payments/ledger infrastructure that can orchestrate sweeps into MMF-backed accounts, not itself a fund manager.

### Gekko default
Not needed as a distinct product from Treasury Bills above — Gekko doesn't
need a separate fiat MMF relationship when USDY already tokenizes the
equivalent exposure. Revisit only if Gekko ends up holding meaningful fiat
cash balances (e.g. from a fiat on-ramp) that need a sweep destination.

### Build checklist
- [ ] (verify) None for v1 — explicitly deferred pending fiat cash balance need
- [ ] If triggered: evaluate Treasury Prime partner banks for sweep-eligible accounts
- [ ] Modern Treasury integration only if Gekko's own ledger needs multi-bank orchestration

## Yield Products

### What it is
The core "Savings" feature from roadmap item #1 — auto-depositing idle
stablecoin balances into permissionless lending/vault protocols and
crediting yield back to the user, with instant withdraw-on-trade.

### Vendor / provider options
- **Aave V3** — deepest liquidity, battle-tested, no KYC.
- **Morpho vaults** — curated vaults on top of Aave/Compound-style markets, >$10B TVL, used by Coinbase; often better rates via curator optimization.
- **Sky sUSDS** — savings-rate stablecoin, no KYC, simple integration.
- **Ondo USDY** — KYC'd, higher-touch alternative for users who opt in (see Treasury Bills above).

### Gekko default
**Morpho vaults as primary**, Aave V3 as fallback/diversification, matching
the roadmap's existing conclusion (Coinbase-validated, >$10B TVL). Auto-sweep
idle balances above a configurable threshold; instant withdraw on trade
intent so yield never blocks a swap. This is the single highest-priority
build in the whole Gekko roadmap per the source doc.

### Build checklist
- [ ] Idle-balance detection + auto-deposit trigger (session-key/smart-account powered, no per-action signature)
- [ ] Instant withdraw-on-trade path — yield position must never block a pending swap
- [ ] Morpho curator/referral fee capture (roadmap's stated revenue mechanism)
- [ ] `/save` bot command + webapp "Earn" tab + weekly "you earned $X" digest (ties to bank-statement item #3)
- [ ] Multi-vault diversification logic (split across Morpho/Aave/Sky by rate + risk)

## Liquidity Management

### What it is
Gekko's own operational treasury function — ensuring the platform has enough
liquid stablecoin/fiat on hand to cover card settlement, withdrawals, and
fee sweeps without being caught short, independent of what any individual
user is earning.

### Vendor / provider options
- **Modern Treasury** — ledgering, payment orchestration, and reconciliation across multiple bank/chain rails.
- **Fireblocks / Copper** — institutional custody + liquidity routing if Gekko holds material treasury balances on-chain (verify current vendor shortlist — not previously evaluated in this repo).
- In-house: extend the existing `fee_sweeper` background service (already in `api/main.py` lifespan).

### Gekko default
Extend the existing **`fee_sweeper`** service rather than bolting on a new
vendor immediately — it already handles sweep logic for the bot's fee flows.
Bring in Modern Treasury only once card settlement (via the debit rail in
`05-cards.md`) creates real multi-rail reconciliation complexity.

### Build checklist
- [ ] Extend `fee_sweeper` to include card-settlement liquidity buffer, not just protocol fees
- [ ] Define minimum-liquidity thresholds per chain/stablecoin
- [ ] Alerting via existing `alert_service` when buffer drops below threshold
- [ ] (verify) Evaluate Modern Treasury once card settlement volume is non-trivial

## FDIC Coverage

### What it is
US deposit insurance protecting fiat cash up to $250K per depositor per
bank — relevant only for the fiat-holding edges of Gekko (card settlement
account, any fiat on-ramp float), never for on-chain stablecoin/crypto
balances, which FDIC does not cover.

### Vendor / provider options
- Coverage comes through the sponsor/partner bank in a BaaS relationship (e.g. whichever bank backs the card issuer's settlement account) — not a vendor Gekko selects directly.
- **Treasury Prime partners** — BaaS layer that typically carries the FDIC-insured bank relationship.

### Gekko default
Inherit FDIC coverage through the card-issuing partner's sponsor bank
(Immersve/Gnosis Pay's banking relationship) rather than establishing a
direct bank relationship — Gekko is not a bank and should not present
itself as one. Any user-facing claim about "FDIC insured" must be scoped
precisely to the fiat float, never to crypto/stablecoin balances.

### Build checklist
- [ ] Confirm which entity in the card-partner stack actually holds FDIC-insured deposits (verify with Immersve/Gnosis Pay legal docs)
- [ ] Compliance review of any user-facing "insured" language before it ships
- [ ] Explicit UI disclaimer: stablecoin/DeFi balances are NOT FDIC insured
- [ ] (verify) Confirm coverage terms don't change under the Rain custodial alternative if that partner is used instead
