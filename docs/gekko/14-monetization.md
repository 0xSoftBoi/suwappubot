# Monetization

Why this matters for Gekko: a neobank that only charges swap fees caps its revenue at trading volume, which is lumpy and cyclical. Gekko needs a stack of recurring, low-volatility revenue lines — interchange, float, yield spread, credit, FX, wires, subscriptions — layered on top of Suwappu's existing swap-fee engine so the business survives quiet markets.

## Interchange

### What it is
Interchange is the fee a card network (Visa/Mastercard) charges merchants on every card swipe, a slice of which flows back to the issuing bank/program. It is the single largest recurring revenue line for consumer neobanks like Chime and Cash App.

### How it works / benchmarks
- Durbin-exempt debit interchange (issuers under $10B in assets, which covers nearly all neobank sponsor-bank partners): ~1.4-1.8% of transaction value (verify, varies by network/card-present vs not-present).
- Durbin-regulated large banks: capped at ~$0.21 + 0.05% + fraud adjustment (~0.3-0.5% effective) — irrelevant to Gekko since we'd use a small sponsor bank.
- Credit interchange: ~2-3% (verify), but requires a credit product and issuer risk appetite.
- Chime reportedly derives ~70-80% of revenue from interchange (verify, widely cited estimate).

### Gekko approach
Partner with a Durbin-exempt sponsor bank / BIN sponsor (Gnosis Pay B2B, Column, or a card-issuing processor like Marqeta/Lithic on top of a small bank) to issue a debit card funded from the user's on-chain stablecoin balance, auto-converted at spend time via Suwappu's existing swap engine. Interchange becomes the anchor revenue line; route card spend data into the existing XP/referral system to reward usage.

### Target / definition
- Definition: interchange revenue ÷ total card spend (basis points).
- Target: 1.5% blended take rate on card spend within 12 months of card launch.

## Deposit Float

### What it is
Float is the return an institution earns by holding customer deposits (or here, custodial/pooled stablecoin balances) before they're spent or withdrawn, e.g. via short-duration treasuries or overnight lending.

### How it works / benchmarks
- Traditional neobanks sweep FDIC deposits into partner banks and earn net interest margin, often 200-400bps on the fed funds spread (verify).
- Non-custodial architecture (Gnosis Pay, Zeal) largely forgoes float because funds stay in user-controlled Safes — Gekko must choose custodial vs non-custodial deliberately per product surface.
- On-chain equivalent: idle stablecoin auto-deposited into Aave/Morpho earns 4-6% APY, of which Gekko can retain a curator/referral spread (50-150bps, verify against Morpho vault fee terms).

### Gekko approach
Do not chase traditional fiat float — Gekko is not a bank. Instead, treat "float" as the spread on the existing idle-balance-to-yield-vault flow (see Treasury Yield below) and keep spendable balances non-custodial where possible to preserve the trust moat.

### Target / definition
- Definition: revenue captured from balances between deposit and spend, expressed as bps of average idle balance.
- Target: not a primary line for Gekko v1 — track only as a byproduct of the yield-vault fee.

## Treasury Yield

### What it is
Revenue earned by routing customer stablecoin balances into yield-bearing instruments — DeFi lending markets or (for KYC'd users) tokenized treasuries — and taking a spread or referral fee.

### How it works / benchmarks
- Aave V3 / Morpho stablecoin vaults: 4-6% APY, >$10B TVL (per NEOBANK_ROADMAP.md), fully permissionless, no KYC.
- Sky sUSDS: similar range, permissionless.
- Ondo USDY (tokenized treasuries): ~4.65% (per roadmap doc), but requires KYC at issuance.
- Morpho/Aave curator or vault-creator fees typically run 50-200bps of yield generated (verify exact terms per vault).

### Gekko approach
This is Gekko's core structural moat vs. Chime/Mercury: pay users near-market DeFi yield on idle balances (auto-deposit via `/save`, webapp Earn tab) while Gekko takes a curator/referral spread, not a large haircut. Dual-track: permissionless DeFi vaults by default, opt-in KYC'd treasury track (Ondo) for users who want lower volatility/regulatory comfort.

### Target / definition
- Definition: (vault APY paid to Gekko - APY passed to user) × average yield-bearing balance.
- Target: 75bps average spread, >30% of eligible balances opted into yield within 6 months.

## Lending / Credit

### What it is
Revenue from interest and fees on money Gekko lends or fronts to customers — overcollateralized crypto-backed credit lines, and eventually unsecured consumer credit if a partner bank underwrites it.

### How it works / benchmarks
- Aave GHO / Morpho borrow markets: overcollateralized, permissionless, borrow rates typically 5-9% (verify, variable).
- Undercollateralized consumer credit has no permissionless analog (per roadmap doc) — requires a licensed lender/bank partner and full underwriting stack.
- Ether.fi "Borrow Mode" and similar spend-without-selling products are the closest live comparable.

### Gekko approach
Ship overcollateralized "spend without selling" credit first (GHO/Morpho-backed line of credit against a user's crypto), fully permissionless, no underwriting risk on Gekko's balance sheet. Treat unsecured consumer credit as a Phase 2+ item requiring a bank partner (see `20-product-expansion.md`).

### Target / definition
- Definition: net interest margin on the collateralized credit book.
- Target: launch overcollateralized credit within 2-3 weeks of Savings shipping (per roadmap effort estimate); NIM target set after first cohort data.

## FX Spread

### What it is
Revenue from the spread applied when converting between currencies or assets — for Gekko, primarily stablecoin-to-token swap fees (already live) plus any fiat-to-stablecoin on/off-ramp spread.

### How it works / benchmarks
- Top Telegram trading bots charge ~1% platform fee as a structural floor (per roadmap doc); this is the existing Suwappu swap-fee baseline.
- Traditional fintech FX spreads on remittance/on-ramp: 0.5-3% depending on corridor and provider (verify).
- MoonPay/Transak on-ramp fees: typically 1-4.5% combined with network/card fees (verify).

### Gekko approach
Reuse Suwappu's existing swap-fee infrastructure unchanged as the core FX/trading revenue line; layer a modest on/off-ramp spread on top of whichever fiat partner (MoonPay/Transak/Monerium/Bridge) is integrated, disclosed pre-trade per the roadmap's "fee transparency" priority item.

### Target / definition
- Definition: blended fee % across swap + ramp volume.
- Target: hold the existing ~1% swap-fee floor; keep ramp spread under 2% to stay competitive with MoonPay/Transak direct.

## Wire Fees

### What it is
Flat or percentage fees charged for outbound/inbound wire transfers, ACH, or fast-payment rails (RTP/FedNow) — a minor but real line item for any bank-like product handling fiat rails.

### How it works / benchmarks
- Traditional bank wires: $15-45 outbound (verify), often free for premium tiers (Mercury, Ramp waive for most volume tiers).
- Neobanks increasingly waive wire fees to compete, monetizing float/interchange instead (verify, Mercury/Ramp positioning).

### Gekko approach
Not a near-term priority — Gekko's fiat rails are limited to on/off-ramp (item 7 in the roadmap), not full wire infrastructure. Revisit only if/when a sponsor-bank partnership brings ACH/wire rails in-house (see `20-product-expansion.md`, Banking section).

### Target / definition
- Definition: revenue per outbound wire/ACH transaction.
- Target: none set for v1; track as a Phase 2+ line once banking rails exist.

## Subscription Revenue

### What it is
Recurring flat fees for a premium tier — higher yield rates, lower swap fees, card perks, priority support — a proven lever at Chime (SpotMe/premium), Mercury (Plus/Pro), and most modern fintechs.

### How it works / benchmarks
- Mercury Plus/Pro: subscription tiers unlock higher-limit ACH, treasury features, priority support (verify exact pricing).
- Ramp: free core product, monetizes via interchange + spend-management upsells rather than subscription (verify).
- Typical consumer fintech premium tier: $5-15/mo (verify).

### Gekko approach
Launch a "Gekko Pro" tier gated by existing XP/referral tenure: reduced swap fees, boosted yield spread pass-through, and priority support, priced $9.99/mo or unlocked via XP threshold to reinforce the existing gamification loop rather than compete with it.

### Target / definition
- Definition: MRR from subscription ÷ total active users.
- Target: 5% of MAU converted to Pro within 12 months of launch.
