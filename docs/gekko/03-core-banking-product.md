# Gekko Core Banking Product

Why this matters for Gekko: the product surface is what turns Suwappu's existing trading infrastructure into something a normal user calls "my bank" — the roadmap's headline finding is that no incumbent (trading bot or DeFi neobank) combines trading with real bank-like primitives, and this doc scopes exactly which primitives Gekko ships and how each maps to the infrastructure and vendor choices in `01-infrastructure.md`.

## Checking Accounts

### What it is
A checking account is the everyday-spend account with a real account/routing number (via virtual ACH accounts), instant balance visibility, and no lockup — the anchor product that makes Gekko feel like a bank rather than a wallet app. It's funded by direct deposit, ACH pull, or stablecoin conversion.

### Vendor / provider options
- **Increase / Treasury Prime / Synctera / Unit** — see `01-infrastructure.md` Virtual ACH Accounts section for the full tradeoff breakdown; checking accounts are built directly on top of whichever virtual-account provider Gekko selects.

### Gekko default
Build checking on **Increase + Lead Bank** (per infra doc), with the account balance itself optionally auto-swept into Morpho/Aave yield when idle — turning a normally 0%-APY checking account into the roadmap's #1 identified white-space feature, applied to fiat-rail balances instead of just crypto.

### Build checklist
- [ ] Instant account opening flow gated on KYC completion (see `02-regulatory-compliance.md`)
- [ ] Real-time balance + transaction feed in the mobile app
- [ ] Idle-balance auto-sweep into yield (opt-in, with clear APY-not-guaranteed disclosure)
- [ ] Direct deposit setup flow (routing/account number display + verification)
- [ ] Account closure/offboarding flow that unwinds any yield position first

## Savings Accounts

### What it is
A separate, goal-oriented balance with a visibly higher yield than checking, matching the roadmap's "Acorns-for-crypto" savings-goals concept — funds here are meant to sit and grow, not spend, and can be vault-wrapped with time locks for stickiness.

### Vendor / provider options
- **Aave V3 / Morpho / Sky sUSDS** — permissionless base yield, no KYC (see `01-infrastructure.md` Yield Provider section).
- **Ondo USDY / Superstate** — KYC-gated treasury yield, higher perceived "legitimacy" for risk-averse users.

### Gekko default
**Morpho vaults** as the default savings engine (matches roadmap conclusion), with **savings-goal wrappers** (vault + lock, e.g. "save $500 for a trip by December") as the differentiating UX layer no competitor has. Offer **Ondo USDY** as an opt-in "treasury-backed" tier for KYC'd users who want lower volatility perception even though yield may be similar or lower.

### Build checklist
- [ ] Savings-goal creation flow (target amount, target date, optional lock)
- [ ] Auto-contribution rules (e.g., "save 20% of every profit," per roadmap item #8)
- [ ] Visible real-time yield accrual, distinct from checking balance
- [ ] Early-withdrawal handling for locked goal vaults (penalty vs. free — product decision)
- [ ] Goal progress notifications (push/bot digest, reusing existing weekly-summary infra)

## Debit Cards

### What it is
A physical/virtual card that spends directly from checking balance (fiat rail) or, for the non-custodial path, pre-authorizes spend straight from an onchain stablecoin balance without an off-ramp step — this is the "gains to spending" gap the roadmap identifies as the #2 biggest white space after yield.

### Vendor / provider options
- **Lithic / Marqeta / Highnote** — fiat-rail card issuing platforms (see `01-infrastructure.md` Card Issuer).
- **Gnosis Pay / Immersve / Rain** — crypto-native card options, Immersve being the most philosophically aligned per roadmap (non-custodial, Mastercard network, smart-contract pre-auth).

### Gekko default
Dual-rail as scoped in `01-infrastructure.md`: **Immersve** for spend-directly-from-wallet, **Lithic** for the traditional checking-account debit card — one physical card, routed intelligently by the app depending on which balance the user selects to spend from.

### Build checklist
- [ ] Unified card issuance flow (single physical card, dual backend rails)
- [ ] In-app balance-source selector (crypto wallet vs. checking) for each spend
- [ ] Real-time authorization webhook handling for both Immersve and Lithic
- [ ] Card freeze/replace flow reachable from the app in under 3 taps
- [ ] Live end-to-end test: real card swipe against both rails before claiming "live" (per CLAUDE.md verification standard)

## Credit Cards

### What it is
A revolving credit product; in Gekko's context the roadmap concludes there is no permissionless undercollateralized credit option, so the only viable "credit card" is an **overcollateralized** analog — borrow against crypto collateral (Aave GHO / Morpho) and spend the borrowed stablecoin via the debit-card rail, functioning like a credit card without a credit check.

### Vendor / provider options
- **Aave GHO** — native overcollateralized stablecoin borrow, permissionless, no KYC.
- **Morpho borrow markets** — similar overcollateralized borrow, often better rates via curated markets.
- **Traditional credit issuers (Marqeta/Highnote credit rails)** — true undercollateralized credit requires a real credit-underwriting partner and bureau data; not scoped for Gekko v1 (verify if a later phase adds this).

### Gekko default
**Aave GHO / Morpho borrow**, spent via the same Immersve pre-auth card rail used for debit — this is the "Ether.fi Borrow Mode analog" the roadmap calls out (item #9), giving Gekko a credit-card-shaped product with zero credit risk to Gekko itself, since it's fully overcollateralized onchain.

### Build checklist
- [ ] Collateral management UI (loan-to-value ratio, liquidation risk warnings)
- [ ] Borrow-and-spend flow that routes borrowed stablecoin through the Immersve card rail
- [ ] Liquidation alerting (push notification before LTV threshold breach)
- [ ] Clear in-app disclosure this is collateralized borrowing, not a credit line (avoid regulatory mischaracterization)
- [ ] Explicitly flag true undercollateralized credit as out of scope for v1 (verify against product roadmap)

## ACH

### What it is
Automated Clearing House transfers — the standard US bank-to-bank rail for direct deposit, bill pay, and account funding. Both push (send money out) and pull (pull money in from a linked external account) are needed for checking accounts to function like a real bank account.

### Vendor / provider options
- **Increase / Treasury Prime / Synctera / Unit** — see `01-infrastructure.md`; ACH capability is a function of the virtual-account/BaaS provider chosen.

### Gekko default
**Increase**, consistent with the infra doc pick — same-day ACH support is the bar for "feels instant" mobile UX; standard ACH (1-3 day) as the default free tier with same-day as a paid/priority option (product decision, verify pricing model).

### Build checklist
- [ ] External account linking (Plaid or similar for account/routing verification — verify vendor, not yet scoped)
- [ ] ACH pull flow with micro-deposit or instant verification fallback
- [ ] ACH push flow for bill pay / external transfers
- [ ] Return/failure handling (NSF, account closed, etc.) surfaced clearly in-app
- [ ] Same-day ACH as opt-in priority tier (verify cost pass-through to user)

## Wires

### What it is
Wire transfers move larger sums same-day with finality, typically used for high-value transactions (real estate, large transfers) where ACH's multi-day settlement or transaction limits don't work. Wires are lower-volume but higher-stakes — mistakes are largely irreversible.

### Vendor / provider options
- **Increase / Treasury Prime / Synctera / Unit** — same BaaS layer as ACH; wire support varies by provider (verify each supports outbound wire origination, not just receipt).

### Gekko default
**Increase**, gated behind manual review for any wire above a threshold (verify threshold with compliance) — wires are the highest-fraud-risk rail in consumer banking, so this is the one flow where Gekko should deliberately add friction rather than optimize for speed.

### Build checklist
- [ ] Outbound wire origination flow with mandatory beneficiary verification step
- [ ] Manual review queue for wires above threshold amount
- [ ] Same-day wire cutoff time clearly surfaced in-app (banks have hard daily cutoffs)
- [ ] Sanctions screening applied to wire beneficiary before execution (see `02-regulatory-compliance.md`)
- [ ] Wire fee disclosure shown before user confirms send

## Stablecoins

### What it is
Native stablecoin balances (USDC/USDT/PYUSD) across Gekko's 7+ supported chains — the layer Suwappu already operates in production via its existing wallet and swap infrastructure, and the bridge between the crypto-native and fiat-native halves of the product.

### Vendor / provider options
- **Existing Suwappu wallet/swap stack** — already live, 7+ chains, KMS envelope encryption.
- **Bridge (Stripe) / Monerium** — orchestration layer; **Coinbase Onramp (MoonPay fallback)** — on-ramp widget (see `01-infrastructure.md` On-Ramp and Stablecoin Orchestrators sections).

### Gekko default
Reuse the existing wallet/swap stack as-is; stablecoins are the one product surface where Gekko starts from a position of strength rather than building from zero. Focus new build effort on the UX layer (unified balance view across chains, single "spend" action regardless of chain) rather than the underlying rails.

### Build checklist
- [ ] Unified cross-chain stablecoin balance view (multicall3, already available per roadmap)
- [ ] One-tap "convert to spendable" flow bridging stablecoin balance to card-ready state
- [ ] Chain-abstraction so users never have to think about which of the 7+ chains they're on
- [ ] Stablecoin de-peg monitoring/alerting (operational, not user-facing)
- [ ] Confirm which stablecoins each downstream rail (card, ramp, yield) actually supports before promising cross-compatibility

## Travel & Hotels / Concierge VIP

### What it is
A premium, white-labeled travel-booking and concierge layer (flights, hotels, VIP experiences) bundled into a top-tier Gekko account — a differentiation and retention play for high-balance users, not a core banking primitive, modeled on premium card programs (Amex Platinum-style concierge).

### Vendor / provider options
- **Selfbook** — modern hotel booking API built for fintech/card issuer integrations.
- **Duffel** — flight booking API, developer-friendly, used by several travel-fintech integrations.
- **Impala** — hotel connectivity/booking infrastructure, strong direct-booking coverage.
- **Ten Lifestyle** — white-label luxury concierge service (travel, dining, events), used by premium card programs.
- **John Paul** — white-label luxury concierge, LVMH-backed, strong European/luxury-brand positioning.

### Gekko default
**Duffel + Selfbook** for the self-serve flight/hotel booking layer inside the app, with **Ten Lifestyle** as the white-label human-concierge layer for a top-tier "Gekko Black" account tier (verify naming/tier structure with product). This is explicitly a v2+ feature — sequence it after checking/savings/card/yield are live and generating the balance data needed to identify which users qualify for a VIP tier.

### Build checklist
- [ ] Scope this as post-v1 (verify against overall launch sequencing — not a day-one blocker)
- [ ] Duffel integration for in-app flight search/booking
- [ ] Selfbook integration for in-app hotel search/booking
- [ ] Ten Lifestyle white-label concierge contract and tier-eligibility criteria (verify balance/spend threshold)
- [ ] Card-linked travel perks (e.g., lounge access, booking credits) tied to the credit/debit card product
