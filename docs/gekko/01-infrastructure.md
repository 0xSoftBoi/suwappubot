# Gekko Infrastructure

Why this matters for Gekko: Gekko is a mobile-app neobank, not just a trading bot — it needs the regulated rails (sponsor bank, card issuer, virtual accounts) that Suwappu's existing DEX bot never required, wired around the wallet/KMS/stablecoin core we already run in production. Prior research (`docs/NEOBANK_ROADMAP.md`) concluded the durable moat is a permissionless, non-custodial core with regulated partners bolted on at the edges — so every pick below defaults to the option that keeps Gekko's wallet and yield layer non-custodial while outsourcing only what legally requires a license.

## Sponsor Bank

### What it is
A sponsor bank is the FDIC-insured chartered bank that actually holds fiat, issues account/routing numbers, and lets a fintech operate under its charter via a BaaS (banking-as-a-service) agreement. Gekko cannot hold customer USD deposits or issue ACH/wire rails without one. The sponsor bank is the compliance backstop of last resort and dictates program limits (KYC tier, transaction caps, prohibited business types).

### Vendor / provider options
- **Lead Bank** — API-first, fast onboarding, popular with crypto-adjacent fintechs; smaller balance sheet than legacy players (verify capacity for scale).
- **Column** — bank-as-API built by Plaid's founder; owns its own charter (no middleware layer), strong for direct integration but less white-glove support.
- **Cross River Bank** — largest/most established BaaS sponsor, deep fintech experience, but slower onboarding and pickier on crypto-touching programs post-2023 enforcement actions.
- **Grasshopper Bank** — fintech-friendly, digital-asset-forward positioning, mid-size.
- **Thread Bank** — smaller community bank turned BaaS sponsor, flexible but limited scale (verify).

### Gekko default
**Lead Bank**, with **Column** as a fallback/second rail. Lead Bank's API-first model and existing comfort with crypto-adjacent programs best matches Suwappu's stablecoin-native product; Column's direct-charter model reduces middleware risk if Lead's crypto risk appetite tightens (verify current risk posture before contracting — sponsor bank crypto tolerance shifts fast).

### Build checklist
- [ ] Get program terms in writing: transaction limits, prohibited-business list, crypto-specific restrictions
- [ ] Confirm FDIC pass-through insurance structure for customer funds (verify)
- [ ] Negotiate BaaS middleware vs. direct-to-bank integration (Column supports direct)
- [ ] Define escalation path for account freezes/holds before launch, not after
- [ ] Dual-track a second sponsor bank relationship for redundancy (banks exit crypto programs on short notice)

## Card Issuer

### What it is
The card issuer is the processor/program manager that issues physical and virtual debit (and eventually credit) cards, authorizes transactions in real time, and settles with card networks (Visa/Mastercard). This is separate from the sponsor bank (which holds the BIN/funds) — the issuer handles the technical card-issuing platform.

### Vendor / provider options
- **Lithic** — modern API-first card issuing, real-time authorization webhooks, popular with crypto/fintech; requires pairing with your own sponsor bank.
- **Marqeta** — largest incumbent, powers Cash App/DoorDash, mature but heavier integration lift and enterprise sales cycle.
- **Highnote** — newer, strong developer experience, credit + debit in one platform.
- **Gnosis Pay** — non-custodial Safe-smart-account card, spends directly from a wallet, EEA/UK only today; purest philosophical match to Suwappu's non-custodial thesis.
- **Immersve** — Mastercard-network, smart-contract pre-authorization straight from onchain balances, most aligned to "spend without a custodial intermediary" (per roadmap, most aligned philosophically).
- **Rain** — global scale, $1.95B valuation, but custodial card infra (funds move off-chain to spend).

### Gekko default
**Immersve** for the crypto-native/non-custodial card rail (matches roadmap's non-custodial thesis and gives Mastercard network reach beyond Gnosis Pay's EEA/UK limit), with **Lithic** as the fiat-rail issuer for the traditional debit card tied to the sponsor-bank checking account. Two issuers, one UX: crypto balance spends via Immersve pre-auth, fiat balance spends via Lithic.

### Build checklist
- [ ] Confirm Immersve's supported chains/stablecoins match Gekko's existing 7+ chain wallet support
- [ ] Scope Lithic integration against Lead Bank/Column's supported card programs (verify compatibility)
- [ ] Build unified card UX so users don't need to know which rail a given card draws from
- [ ] Define decline/insufficient-funds handling for the non-custodial pre-auth path (network latency risk)
- [ ] Physical card fulfillment vendor and timeline (verify — usually 3rd party via issuer)

## Yield Provider

### What it is
The protocol(s) that generate yield on idle stablecoin balances sitting in Gekko wallets between spending/trading — the roadmap's #1 identified white space, since no competitor pays yield on idle bot/terminal balances.

### Vendor / provider options
- **Aave V3** — largest, most battle-tested lending market, GHO borrow gives an overcollateralized "credit card" analog; permissionless, no KYC.
- **Morpho** — >$10B TVL, curated vaults, Coinbase uses it in production; often better rates than Aave via optimized matching.
- **Sky (ex-MakerDAO)** — sUSDS savings rate, simple and liquid.
- **Ondo USDY** — tokenized treasury yield (~4.65%), but requires KYC at issuance — not fully permissionless.
- **Superstate** — tokenized short-duration treasuries, institutional-grade, also KYC-gated.

### Gekko default
**Morpho vaults primary, Aave V3 secondary**, exactly as the roadmap concluded — fully permissionless, no KYC, auto-deposit idle USDC with withdraw-on-spend. Offer **Ondo USDY** as an optional KYC-gated "premium yield" dual-track for users who want treasury-backed rates and have already completed Gekko's account-opening KYC anyway (their KYC is already on file, so the marginal friction is near zero).
Do not integrate Mountain USDM (wound down Aug 2025, per prior research).

### Build checklist
- [ ] Auto-sweep idle balances into Morpho/Aave with instant withdraw-on-spend (session keys / ERC-7715)
- [ ] Surface real-time accrued yield in the account/statement view
- [ ] Add Ondo USDY as opt-in tier gated on completed KYC
- [ ] Yield disclosure/APY-not-guaranteed language reviewed by compliance before launch
- [ ] Confirm curator/referral fee terms with Morpho (roadmap notes this as a revenue line)

## Virtual ACH Accounts

### What it is
Virtual account numbers (VANs) let each Gekko user have a unique, dedicated account/routing number pair for receiving ACH deposits (payroll, transfers) even though funds ultimately pool at the sponsor bank. This is what makes "your Gekko account" behave like a real bank account for direct deposit.

### Vendor / provider options
- **Increase** — modern BaaS API, direct bank partnerships, strong for ACH/wire primitives, smaller company (verify scale for consumer volume).
- **Treasury Prime** — established BaaS middleware, multiple bank partners, more enterprise-oriented.
- **Synctera** — full BaaS platform including card issuing + compliance tooling bundled, one-stop-shop tradeoff (more vendor lock-in).
- **Unit** — consumer-fintech-focused BaaS, fast to launch, bundles compliance tooling, pulled back from some higher-risk verticals post-2023 (verify current crypto stance).

### Gekko default
**Increase**, paired with the Lead Bank sponsor relationship — Increase's direct-to-bank API model avoids an extra middleware layer and gives lower-latency ACH/wire primitives, important for a "instant-feeling" mobile neobank UX. Revisit Synctera if Gekko wants a single vendor bundling virtual accounts + card issuing + compliance tooling to reduce integration surface area at the cost of flexibility.

### Build checklist
- [ ] Confirm Increase supports same-day ACH and wire origination, not just receipt
- [ ] Map virtual account lifecycle to Gekko user lifecycle (KYC-gated activation, account closure/offboarding)
- [ ] Test direct-deposit flow end-to-end with a real payroll provider before claiming support (per CLAUDE.md live-verification standard)
- [ ] Reconcile virtual account ledger against sponsor bank pooled account nightly

## Wallets

### What it is
Gekko needs non-custodial (or hybrid) smart-contract wallets across 7+ chains for the crypto side of the product — this is the one layer Suwappu already has in production via its existing bot wallet infrastructure and KMS envelope encryption.

### Vendor / provider options
- **Existing Suwappu wallet stack** — `kms_aesgcm_v2` envelope encryption, already live across 7+ chains, zero net-new vendor risk.
- **Privy** — embedded wallet + OAuth login, powers Banana Pro's 1.3M-user onboarding (per roadmap), strong for mobile onboarding UX.
- **Turnkey** — non-custodial key infra with policy engine, popular for programmatic/session-key control.
- **Safe (Gnosis Safe)** — smart-account standard, what Gnosis Pay's card is built on; good for session-key/spend-limit patterns.

### Gekko default
**Reuse the existing Suwappu wallet + KMS envelope encryption stack** as the core, adding **Safe smart-account** wrapping for card-linked wallets to support session keys / spend limits (needed for the Immersve pre-auth flow and Morpho auto-sweep). Do not re-platform onto Privy/Turnkey unless mobile onboarding conversion data shows the existing flow is a blocker — avoid rebuilding what already works in production.

### Build checklist
- [ ] Audit whether current wallet infra supports Safe-style session keys (ERC-7715) or needs an upgrade path
- [ ] Confirm KMS envelope encryption model extends cleanly to mobile-app key storage (vs. Telegram bot server-side custody model)
- [ ] Define spend-limit / pre-auth policy engine for card-linked wallets
- [ ] Security-audit the mobile key-storage path before any KYC/funds go live (route through `money-path-reviewer`)

## Stablecoin Orchestrators

### What it is
Stablecoin orchestrators handle minting/redeeming, cross-chain movement, and fiat on/off-ramping of stablecoins at the infrastructure layer, so Gekko doesn't build bespoke integrations per issuer per chain.

### Vendor / provider options
- **Bridge (Stripe)** — acquired by Stripe, strong USD on/off-ramp and stablecoin orchestration API, well-capitalized backing.
- **BVNK** — global stablecoin payments infra, strong on cross-border settlement.
- **Zerohash** — crypto-as-a-service, handles custody + settlement + compliance bundled, used by several neobanks.
- **Fern** — newer entrant focused on stablecoin payment orchestration, smaller (verify scale/reliability track record).
- **Monerium** — SEPA/IBAN-native stablecoin issuance, EU-focused (per roadmap, best fit for EU fiat rails).
- **MoonPay / Transak** — on/off-ramp widgets, fastest to integrate (days of work per roadmap), not a full orchestrator.

### Gekko default
**Bridge (Stripe)** for US stablecoin orchestration given Stripe's balance sheet and the roadmap's identification of Bridge as the US fiat rail, **Monerium** for EU SEPA/IBAN, and **MoonPay/Transak** widgets as the fast-ship on/off-ramp for the initial mobile launch while the deeper Bridge integration is built. This mirrors the roadmap's staged approach: widget first (days), full orchestration later.

### Build checklist
- [ ] Ship MoonPay/Transak widget for v1 on/off-ramp (fastest path per prior research)
- [ ] Scope Bridge integration for direct USD stablecoin orchestration (post-v1)
- [ ] Scope Monerium for EU users needing SEPA/IBAN-native stablecoin rails
- [ ] Confirm which stablecoins (USDC/USDT/PYUSD) each orchestrator supports on Gekko's target chains
- [ ] Reconcile orchestrator settlement reporting against internal ledger nightly
