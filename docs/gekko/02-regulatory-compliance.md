# Gekko Regulatory & Compliance

Why this matters for Gekko: unlike the Suwappu DEX bot — which never custodies fiat or issues cards — Gekko touches regulated money movement (ACH, wires, card issuance) the moment it opens the first checking account, which means KYC/AML/sanctions screening are not optional add-ons but launch blockers. Prior research (`docs/NEOBANK_ROADMAP.md`) is explicit that the trading/wallet layer stays permissionless and KYC-free, but every regulated edge (card, fiat ramp, treasury yield) requires a real compliance program — this doc scopes that program.

## KYC / KYB

### What it is
Know Your Customer (individual identity verification) and Know Your Business (entity verification, for any B2B/merchant accounts Gekko offers) are required before opening a checking account, issuing a card, or granting access to KYC-gated yield products like Ondo USDY. This typically includes government ID capture, liveness/selfie match, and address verification.

### Vendor / provider options
- **Persona** — highly configurable verification flows, strong mobile SDK, popular with consumer fintech.
- **Alloy** — orchestration layer that chains multiple KYC/fraud data sources, good if Gekko wants to swap underlying data providers without rebuilding flows.
- **Footprint** — newer, positions itself as identity + secure vaulting combined, smaller track record (verify).
- **Sumsub** — strong international/global KYC coverage, good KYB support, popular outside the US.

### Gekko default
**Persona** for core KYC given its mobile-native SDK (matches Gekko's mobile-app form factor) and configurability for tiered verification (light KYC for basic wallet use, full KYC for checking account + card). Add **Alloy** as an orchestration layer only if/when Gekko needs to run multiple identity data sources for fraud lift — don't add this complexity at launch.

### Build checklist
- [ ] Define KYC tiers: wallet-only (none/light) vs. checking+card (full) vs. KYC-gated yield (full + treasury eligibility)
- [ ] Mobile SDK integration for ID capture + liveness check
- [ ] Store verification results/audit trail per sponsor bank's requirements (verify retention period, likely 5 years)
- [ ] Define re-verification triggers (address change, large transaction, periodic refresh)
- [ ] KYB flow scoped only if Gekko launches any business/merchant accounts (defer if consumer-only at launch)

## AML

### What it is
Anti-Money-Laundering covers the ongoing program — not just onboarding — that monitors customer behavior, flags suspicious activity, and files required reports (SARs) with FinCEN. This is a standing program requirement under the Bank Secrecy Act, typically owned jointly by Gekko and its sponsor bank but Gekko must operate the actual monitoring.

### Vendor / provider options
- **Unit21** — no-code rules engine for AML case management, popular with crypto-touching fintechs.
- **Sardine** — combines fraud + AML signal, device/behavioral risk scoring, strong crypto-specific coverage.
- **ComplyAdvantage** — data-heavy, strong PEP/adverse-media screening, integrates into case management.
- **Hummingbird** — case management and SAR-filing workflow tooling, pairs well with a separate screening data provider.

### Gekko default
**Sardine** as the primary signal provider given its crypto-native risk scoring (directly relevant to onchain-linked accounts), paired with **Unit21** for case management and rules orchestration. This combination gives both the crypto-specific detection Gekko needs and a mature case-management workflow the compliance team can actually operate day to day.

### Build checklist
- [ ] Define AML rule set covering both fiat rails (ACH/wire) and stablecoin on/off-ramp events
- [ ] Wire Sardine risk scores into the transaction approval/hold pipeline
- [ ] Build SAR filing workflow with a named compliance officer of record (verify who holds this role at launch)
- [ ] Establish look-back review cadence for flagged accounts
- [ ] Confirm sponsor bank's AML program requirements are mirrored, not just Gekko's own (verify — dual programs must reconcile)

## Sanctions Screening

### What it is
Real-time and batch screening of customers, counterparties, and transactions against OFAC SDN lists and other global sanctions/watchlists, required before account opening and on an ongoing basis for every transaction — including onchain counterparties, which is the piece a traditional neobank doesn't have to think about but Gekko does.

### Vendor / provider options
- **ComplyAdvantage** — strong sanctions/PEP list coverage, real-time API screening.
- **Sardine** — bundles sanctions screening alongside its AML/fraud signal (see AML section).
- **Chainalysis / TRM Labs** — onchain-specific sanctions screening (wallet address risk scoring against OFAC-designated addresses) — **not listed in the vendor set above but necessary (verify)** given Gekko's onchain wallet exposure; flag as an additional required vendor beyond the standard neobank stack.

### Gekko default
**ComplyAdvantage** for fiat-side/identity sanctions screening (real-time OFAC/PEP checks at onboarding and per-transaction), plus an **onchain wallet-screening vendor** (Chainalysis or TRM Labs — verify final selection) for any wallet address Gekko's system interacts with, given the roadmap's cross-chain wallet exposure. This is the one place Gekko's compliance stack must go beyond a standard neobank's, because of the DEX/wallet heritage.

### Build checklist
- [ ] Screen every new account against OFAC SDN + PEP lists at onboarding
- [ ] Real-time transaction screening on ACH/wire counterparties
- [ ] Add onchain wallet risk-scoring for any address a user sends to or receives from (verify vendor selection: Chainalysis vs. TRM Labs)
- [ ] Define auto-block vs. manual-review thresholds
- [ ] Document escalation path to compliance officer for confirmed sanctions hits

## Transaction Monitoring

### What it is
Ongoing, pattern-based monitoring across all money movement — ACH, wires, card spend, and stablecoin transfers — to detect structuring, velocity abuse, and other suspicious patterns that single-transaction screening misses. This is where fiat-rail and crypto-rail monitoring must be unified into one view, which most vendors don't natively support.

### Vendor / provider options
- **Unit21** — rules + ML-based monitoring, flexible enough to define custom crypto+fiat combined rules.
- **Sardine** — real-time behavioral monitoring across both fiat and crypto flows, purpose-built for this hybrid case.
- **Hummingbird** — monitoring case management, typically paired with a separate detection engine rather than doing detection itself.

### Gekko default
**Sardine** as the unified monitoring layer across fiat (ACH/wire/card) and crypto (stablecoin transfer, onchain swap) activity — this is the core reason to pick a crypto-native vendor over a legacy AML shop, since Gekko is the rare product where a single user's "suspicious velocity" pattern can span both rails in one session.

### Build checklist
- [ ] Define combined fiat+crypto velocity rules (e.g., rapid ACH-in → stablecoin-out → card-spend cycles)
- [ ] Set alert thresholds calibrated to Gekko's expected transaction size distribution (not generic defaults)
- [ ] Route confirmed suspicious activity into the AML SAR workflow (see AML section)
- [ ] Quarterly rule-tuning review to reduce false-positive rate as real usage data accumulates
- [ ] Log monitoring coverage gaps explicitly (e.g., swaps executed outside Gekko's own wallet infra)

## Compliance Program

### What it is
The overall governance structure — written policies, a designated compliance officer, board/management oversight, independent testing, and training — that ties together KYC, AML, sanctions, and monitoring into something a regulator and sponsor bank will actually approve. Sponsor banks require Gekko to have this in place, in writing, before go-live, not as a post-launch cleanup item.

### Vendor / provider options
- No single "vendor" covers this — it's typically built from: sponsor bank's compliance requirements (mandatory baseline) + a named BSA/AML Compliance Officer (internal hire, not outsourced) + the tooling above (Persona, Sardine, Unit21, ComplyAdvantage) + outside compliance counsel for policy drafting (verify — likely a specialized fintech/banking law firm).
- **Alloy** and **Unit21** both offer some compliance-program-adjacent workflow tooling (policy documentation, audit trails) that can supplement but not replace the above.

### Gekko default
Build the program around the **sponsor bank's required compliance framework** (Lead Bank's program requirements are the floor, per `01-infrastructure.md`), hire or designate an internal BSA/AML Compliance Officer before any account opens, and use **Unit21 + Sardine + ComplyAdvantage** as the operational tooling stack underneath written policies drafted with outside fintech-banking counsel (verify counsel selection).

### Build checklist
- [ ] Draft written AML/BSA policy, sanctions policy, and CIP (Customer Identification Program) before requesting sponsor bank approval
- [ ] Designate a named BSA/AML Compliance Officer (internal, verify hire timeline)
- [ ] Schedule independent compliance program testing/audit (required annually by most sponsor banks — verify cadence)
- [ ] Build employee training program covering AML/sanctions obligations
- [ ] Get sponsor bank sign-off on the full program in writing before go-live, not verbally
