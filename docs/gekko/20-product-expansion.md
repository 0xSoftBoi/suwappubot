# Product Expansion

Why this matters for Gekko: the roadmap already sequences a wallet → yield → card → credit build path; this doc extends that sequencing into the full neobank product surface so later expansion (payroll, accounting, wealth) has a deliberate order instead of ad hoc feature sprawl. Each section states what's realistically permissionless-buildable today vs. what needs a regulated partner, per the roadmap's "permissionless line."

## Banking

### What it is
Core account primitives — holding balances, sending/receiving, a unified balance view — the foundation every other product sits on.

### How it works / benchmarks
- Gnosis Pay, Zeal, and Daimo all built the non-custodial-wallet-as-bank-account pattern Gekko is following (per roadmap competitive snapshot).
- Full fiat banking (FDIC-insured accounts, ACH/wire origination) requires a sponsor bank; non-custodial crypto balances do not.

### Gekko approach
Already largely built via Suwappu's existing wallet infra; the incremental work is the bank-statement/portfolio view (roadmap item #3) and name-based payments (item #5), both fully permissionless and already scoped.

### Target / definition
- Definition: unified cross-chain balance view live across all surfaces (bot, WhatsApp, terminal).
- Target: ship items #3 and #5 within the existing 1-week / 3-5 day estimates in the roadmap.

## Credit

### What it is
Lending products — starting with overcollateralized crypto-backed credit, potentially expanding to unsecured consumer credit via a bank partner.

### How it works / benchmarks
- Overcollateralized (GHO/Morpho borrow): permissionless today, per roadmap item #9.
- Undercollateralized consumer credit: no permissionless version exists (per roadmap) — must be integrated via a licensed lender.

### Gekko approach
Ship overcollateralized credit first (2-3 week estimate, roadmap item #9). Treat unsecured credit as a multi-year Phase 3+ item requiring a bank/lending partner and full underwriting — do not attempt to shortcut this with on-chain reputation scoring alone; regulatory risk is too high.

### Target / definition
- Definition: overcollateralized credit line live and usable for card-funded spend.
- Target: ship per roadmap's 2-3 week estimate, immediately following Savings + DCA.

## Payments

### What it is
Person-to-person and merchant payment flows — name-based sends, recurring transfers, and eventually point-of-sale/QR payments.

### How it works / benchmarks
- Daimo proved non-custodial P2P payment UX at meaningful scale (per roadmap snapshot); name-based payments (`user.suwappu.eth`) via ENS/CCIP-Read are the direct analog, already scoped as roadmap item #5.

### Gekko approach
Ship name-based P2P sends first (3-5 days per roadmap), then layer recurring transfers/true scheduled DCA (roadmap item #2) as the "payments" expansion. Merchant/POS payments are a later-stage item gated on the card partnership maturing.

### Target / definition
- Definition: % of transfers sent via handle/name rather than raw address.
- Target: 30% of P2P sends using name-based payments within 6 months of launch.

## Treasury

### What it is
Cash-management features for power users and, eventually, businesses — yield optimization, multi-account structuring, and (long-term) B2B treasury tooling akin to Mercury/Ramp.

### How it works / benchmarks
- Mercury and Ramp built large B2B businesses on treasury/cash-management tooling for startups, a fundamentally different customer than Gekko's consumer target (verify applicability before pursuing).

### Gekko approach
Consumer-first: treasury for Gekko v1 means the yield-vault allocation described in `14-monetization.md` and `18-operations.md`, not a B2B product. Revisit B2B treasury only if Suwappu's existing user base shows meaningful DAO/small-business-treasury usage patterns worth a dedicated build.

### Target / definition
- Definition: not a distinct product surface in v1 — folded into Savings/yield.
- Target: none set; revisit after 12 months of consumer-product data.

## Accounting

### What it is
Tools to help users (or businesses) categorize transactions, generate tax reports, and reconcile books — a known gap called out across the roadmap's competitive research ("no tax reporting" listed as a gap for top trading bots).

### How it works / benchmarks
- Tax reporting is a well-known unmet need across the entire crypto trading-bot category (per roadmap gap analysis); no incumbent bot or terminal offers it.

### Gekko approach
Build a transaction-export / cost-basis report feature reusing existing swap/transfer history data — this is a pure UX/data layer, no new financial infrastructure, and directly addresses a gap none of Gekko's direct competitors close. Scope as a mid-roadmap item once card + credit are live and transaction history is rich enough to be useful.

### Target / definition
- Definition: users able to export a tax-ready transaction report (CSV/PDF) covering all supported chains.
- Target: ship within 3-6 months of card launch.

## Payroll

### What it is
The ability to receive recurring salary/payroll deposits directly into a Gekko account — the single strongest retention lever per `16-retention.md`, but requiring fiat rails and employer-side integration.

### How it works / benchmarks
- Direct deposit is a proven stickiness lever industry-wide (see `16-retention.md`) but requires ACH origination/receiving capability, which sits squarely in the "requires a regulated partner" bucket per the roadmap.

### Gekko approach
Do not attempt to build payroll receiving directly — instead, ensure the fiat off-ramp/on-ramp partner (item #7, MoonPay/Transak/Monerium/Bridge) supports ACH deposits into the linked account, so payroll can land via standard direct-deposit setup at the user's employer without Gekko building anything payroll-specific. Long-term/optional: crypto-native payroll for DAOs/crypto-native employers is a more permissionless-friendly variant worth exploring later.

### Target / definition
- Definition: users able to set up ACH direct deposit into their Gekko-linked account via the fiat partner.
- Target: dependent on fiat ramp partner's ACH capability; evaluate as part of item #7 partner selection.

## Wealth Management

### What it is
Investment products beyond stablecoin yield — index-style crypto baskets, automated portfolio rebalancing, or eventually access to tokenized equities/treasuries for long-term holdings.

### How it works / benchmarks
- Ondo USDY and similar tokenized-treasury products are the nearest permissionless-adjacent wealth product (per roadmap, requires KYC at issuance).
- Robo-advisor-style automated rebalancing is a mature fintech pattern (verify applicability to a volatile-asset context) but largely unexplored in crypto-native neobanks.

### Gekko approach
Longest-horizon item on this list. Start with the already-scoped KYC-optional dual-track treasury yield (Ondo) for risk-averse users, then evaluate a simple automated-rebalancing "basket" product only after Savings, Credit, and Payments are mature and retained. Do not pursue tokenized equities without a clear regulatory path.

### Target / definition
- Definition: not scoped for v1; tracked as a Phase 3+ exploration item.
- Target: none set; revisit after Treasury Yield (see `14-monetization.md`) shows sustained adoption.
