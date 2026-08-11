# Credit

The roadmap is explicit: undercollateralized consumer credit has no
permissionless version and Suwappu should skip it. Gekko's credit stack
therefore starts from the one permissionless credit primitive that exists —
overcollateralized borrow via Aave GHO / Morpho — and only reaches for
off-chain debt facilities and fiat underwriting if/when Gekko needs to serve
users who want a real, larger, undercollateralized line. Treat every H2 below
as "if we ever go past overcollateralized crypto credit," not a v1 mandate.

## Underwriting

### What it is
The process of deciding how much credit to extend and at what terms — for
overcollateralized crypto credit this collapses to an LTV/health-factor
calculation; for any future fiat/undercollateralized line it means real
credit-bureau and cash-flow underwriting.

### Vendor / provider options
- **Plaid** — bank-account and cash-flow data for income/expense underwriting signal.
- **Prism Data** — cash-flow underwriting models built specifically for thin-file/non-prime borrowers.
- **Nova Credit** — cross-border credit history, relevant if Gekko serves users without a US credit file.
- **Pagaya** — AI-driven underwriting/loan-approval infrastructure, usually paired with a funding partner.

### Gekko default
No third-party underwriting vendor for v1 — the GHO/Morpho collateral ratio
*is* the underwriting model, computed on-chain and requiring no personal data.
Only bring in Plaid/Prism Data/Nova Credit/Pagaya if Gekko launches a
fiat-backed undercollateralized tier, and treat that as a distinct regulated
product line, not an extension of the crypto-native default.

### Build checklist
- [ ] On-chain collateral-ratio calculator reused from `05-cards.md` credit line
- [ ] Health-factor tiers mapped to credit-limit tiers (e.g. 150% LTV = X limit)
- [ ] (verify) Scope a fiat-underwriting spike only after overcollateralized product has real usage data
- [ ] Document decision gate: which metric triggers "build fiat underwriting"

## Debt Facility

### What it is
A wholesale funding line (warehouse facility) that lets Gekko lend out capital
at scale rather than only re-lending user collateral — needed only if Gekko
originates loans off its own balance sheet rather than routing purely through
Aave/Morpho pools.

### Vendor / provider options
- **Coventure** — fintech-focused debt capital, works with early-stage lending programs.
- **Atalaya** — asset-based lending capital, larger facility sizes.
- **i80 Group** — consumer/fintech credit facilities, has done crypto-adjacent deals (verify).
- **Victory Park Capital** — fintech debt facilities at scale, well-known fintech-lender backer.

### Gekko default
Not needed for v1. Aave/Morpho liquidity pools *are* the debt facility for
the overcollateralized product — Gekko borrows no balance-sheet capital.
Revisit only if Gekko originates undercollateralized loans directly, at which
point this becomes a real fundraising conversation, not an engineering task.

### Build checklist
- [ ] (verify) None for v1 — explicitly out of scope
- [ ] If triggered later: term sheet comparison across Coventure/Atalaya/i80/Victory Park
- [ ] Legal/compliance review before any balance-sheet lending begins

## Working Capital

### What it is
Short-term credit for a business or power-user to smooth cash flow — e.g. a
market maker or merchant drawing against expected inflows rather than a
fixed collateral pool.

### Vendor / provider options
- Same debt-facility vendors as above (Coventure, Atalaya, i80, Victory Park) if fiat-denominated.
- On-chain: flash-loan-adjacent or short-duration Morpho markets for crypto-native working capital (verify feasibility for this use case).

### Gekko default
Defer. No signal yet that Gekko's user base (retail swap/trading users) needs
business working-capital products distinct from the standard credit line.
Revisit if/when the B2B treasury or market-maker segment materializes
alongside the Employee Cards line in `05-cards.md`.

### Build checklist
- [ ] Validate demand with at least 2 prospective business users before scoping
- [ ] Define what "working capital" means for a crypto-native user (draw-against-inflow model)
- [ ] No vendor selection until demand is validated

## Revolving Credit

### What it is
An open-ended credit line the user draws down and repays repeatedly, as
opposed to a single fixed-term loan — this is the model that maps directly
onto the GHO/Morpho borrow-against-collateral line described in `05-cards.md`.

### Vendor / provider options
- **Aave GHO / Morpho** — permissionless revolving line, no KYC, variable rate set by protocol utilization.
- **Ether.fi Cash Borrow Mode** — closest production analog for UX patterns (verify current terms).

### Gekko default
This *is* the Gekko credit default — a GHO/Morpho-backed revolving line drawn
down via the card in `05-cards.md`. No fiat revolving-credit vendor needed
unless the roadmap's undercollateralized-credit line item changes status.

### Build checklist
- [ ] Draw/repay flow wired to card spend (shared with `05-cards.md` Credit section)
- [ ] Interest accrual display (protocol variable rate, not a Gekko-set APR)
- [ ] Auto-repay from Savings yield toggle
- [ ] Minimum-payment / liquidation-warning notifications via `alert_service`

## Term Loans

### What it is
A fixed-amount, fixed-duration loan with a set repayment schedule — distinct
from revolving credit, typically used for larger, planned purchases.

### Vendor / provider options
- Off-chain: same debt-facility partners as above, paired with an underwriting vendor (Plaid/Prism/Pagaya).
- On-chain: fixed-term lending markets (e.g. Morpho fixed-term markets where available) (verify current availability).

### Gekko default
Out of scope for the current roadmap horizon. No incumbent trading bot or
terminal offers this, and it requires either real underwriting or a
fixed-term on-chain market Gekko doesn't yet have exposure to. Note as a
phase-3+ idea, not a build target.

### Build checklist
- [ ] (verify) None for v1 — explicitly out of scope
- [ ] Re-evaluate after revolving credit line has 6+ months of production data

## Collections

### What it is
The process of recovering funds from delinquent or defaulted credit —
for overcollateralized crypto credit this is largely automated liquidation;
for any fiat product it becomes a real collections/recovery operation.

### Vendor / provider options
- **TrueAccord** — automated, compliant digital collections workflows.
- **January** — consumer-friendly collections/recovery platform, positions itself as borrower-friendly (verify current focus).
- On-chain: liquidation bots / keeper networks already built into Aave/Morpho — no vendor needed for the crypto-native line.

### Gekko default
For the GHO/Morpho line, "collections" is just **protocol liquidation** —
Aave/Morpho's existing liquidation engine handles under-collateralized
positions automatically, no vendor required. Only bring in TrueAccord or
January if/when a fiat, undercollateralized product exists with real
delinquency risk.

### Build checklist
- [ ] Liquidation-risk push notification before a position hits threshold (via `alert_service`)
- [ ] Post-liquidation user-facing statement (what got sold, at what price, remaining balance)
- [ ] (verify) TrueAccord/January evaluation deferred until fiat credit exists
- [ ] Internal dashboard tracking liquidation frequency as a product health metric
