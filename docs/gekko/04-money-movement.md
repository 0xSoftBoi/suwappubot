# Gekko Money Movement

Why this matters for Gekko: money movement is the plumbing that makes every product surface in `03-core-banking-product.md` actually work — a checking account is worthless without ACH, a card is worthless without real-time authorization settlement, and Gekko's specific edge (per `docs/NEOBANK_ROADMAP.md`) is being the first product to make stablecoin rails feel as fast and normal as a bank transfer. This doc scopes the rails themselves, separate from the account products they power.

## ACH Push / Pull

### What it is
Push moves money out of a Gekko account to an external bank; pull draws money into Gekko from an external linked account. This is the highest-volume, lowest-cost rail for account funding and everyday transfers, settling in 1-3 days standard or same-day for a premium.

### Vendor / provider options
- **Increase** — direct-to-bank API, low middleware overhead, strong ACH primitives.
- **Treasury Prime** — established middleware, multiple bank partner options.
- **Synctera** — bundled BaaS including ACH, trades flexibility for one-vendor simplicity.
- **Unit** — consumer-fintech-focused, fast to launch (verify current crypto-vertical risk appetite).

### Gekko default
**Increase**, consistent with `01-infrastructure.md` — same pick across the stack avoids reconciliation complexity between separate ACH and virtual-account vendors.

### Build checklist
- [ ] Push flow: external transfer initiation with same-day/standard speed selector
- [ ] Pull flow: external account funding with micro-deposit or instant (Plaid-style) verification
- [ ] Return code handling (R01 insufficient funds, R02 account closed, etc.) surfaced in plain language
- [ ] Daily/monthly ACH limits configurable per KYC tier
- [ ] Reconcile ACH settlement against internal ledger nightly

## Wires

### What it is
Same-day, high-finality transfers for large-value or time-sensitive transactions, both domestic (Fedwire) and potentially international (Swift, see below). Wires carry the highest fraud risk of any fiat rail because they're effectively irreversible once sent.

### Vendor / provider options
- **Increase** — supports wire origination alongside ACH (verify outbound wire capability specifically, not just inbound receipt).
- **Treasury Prime / Synctera / Unit** — alternative BaaS layers, wire support varies (verify per vendor).

### Gekko default
**Increase**, with mandatory manual review above a threshold amount (verify threshold with compliance — this is a policy decision, not a technical one).

### Build checklist
- [ ] Outbound wire flow with beneficiary bank verification step
- [ ] Manual compliance review queue for high-value wires
- [ ] Daily wire cutoff time surfaced clearly in-app
- [ ] Sanctions screening on every wire beneficiary before send (see `02-regulatory-compliance.md`)
- [ ] Wire recall/cancellation request flow (best-effort, since wires are largely irreversible once sent)

## RTP / FedNow / Swift

### What it is
RTP (The Clearing House's Real-Time Payments network) and FedNow (Federal Reserve's real-time rail, live since 2023) both settle domestic transfers in seconds, 24/7/365 — a meaningfully better UX than ACH's multi-day settlement for domestic transfers. Swift is the international wire messaging network for cross-border transfers where RTP/FedNow don't reach.

### Vendor / provider options
- **Increase** — has been expanding real-time rail support; confirm current RTP/FedNow coverage directly (verify — real-time rail support changes fast across BaaS providers).
- **Treasury Prime / Synctera** — check individually for RTP/FedNow participation (verify).
- Swift access is typically obtained indirectly through the sponsor bank's correspondent banking relationships rather than a direct fintech-facing API vendor.

### Gekko default
Adopt **FedNow via Increase** as soon as available for domestic instant transfers (verify current support status before committing a launch date around it), keeping ACH as the fallback rail. Route Swift/cross-border needs through the sponsor bank's correspondent network initially rather than building a direct Swift integration — defer to the Cross-Border Payments section below, which recommends stablecoins as the primary cross-border UX instead.

### Build checklist
- [ ] Confirm Increase's current RTP and FedNow participation status (verify — do not assume from vendor marketing)
- [ ] Instant-transfer UX for RTP/FedNow-eligible recipient banks, with ACH fallback for non-participating banks
- [ ] Real-time settlement reconciliation (different cadence than batch ACH reconciliation)
- [ ] Confirm sponsor bank's correspondent banking coverage for any Swift-routed wire needs
- [ ] Do not market "instant transfers" broadly until RTP/FedNow coverage is confirmed end-to-end (per CLAUDE.md live-verification standard)

## Push To Card

### What it is
Push-to-card (via Visa Direct or Mastercard Send) lets Gekko send funds directly to any debit card's card number, settling in minutes rather than days — useful for instant payouts, refunds, or P2P transfers to non-Gekko users who just have a debit card.

### Vendor / provider options
- **Lithic** — supports push-to-card issuance-side integration alongside its card issuing product.
- **Marqeta** — also supports push-to-card, heavier integration.
- Visa Direct / Mastercard Send are the underlying networks; access typically comes bundled through the card issuer/processor rather than a separate direct integration (verify Lithic's specific push-to-card product coverage).

### Gekko default
**Lithic**, reusing the same vendor already selected for fiat-rail card issuing in `01-infrastructure.md` — avoids adding a third card-network vendor relationship for what is a relatively low-volume feature (instant payouts, P2P-to-non-Gekko-user).

### Build checklist
- [ ] Scope initial use case: instant payouts vs. general P2P vs. refunds (affects volume/risk profile)
- [ ] Confirm Lithic's push-to-card product covers both Visa Direct and Mastercard Send (verify)
- [ ] Fee/limit structure for push-to-card sends (typically higher cost than ACH)
- [ ] Fraud controls specific to push-to-card (common abuse vector: stolen card testing)
- [ ] Recipient-side card validation before send confirmation

## Stablecoins

### What it is
Stablecoin transfers are Gekko's structural advantage over every incumbent bank rail — near-instant, low-cost, 24/7/365, cross-chain settlement using infrastructure Suwappu already operates in production. This is the rail the roadmap identifies as the biggest differentiator, not a compliance-driven afterthought like the fiat rails above.

### Vendor / provider options
- **Existing Suwappu wallet/swap infrastructure** — already live across 7+ chains.
- **Bridge (Stripe) / BVNK / Zerohash / Fern** — orchestration layer for minting/redeeming/moving stablecoins at scale (see `01-infrastructure.md`).
- **Monerium** — SEPA/IBAN-native stablecoin rail for EU users.

### Gekko default
Lead with stablecoin transfers as the **default** money-movement rail wherever both sender and receiver are Gekko users or crypto-native — instant, near-zero cost, no banking-hours limitation — and only fall back to ACH/wire/RTP when the counterparty requires a traditional bank rail. This inverts the usual neobank hierarchy (fiat primary, crypto secondary) and is exactly the differentiation the roadmap calls uncontested.

### Build checklist
- [ ] Default in-app "send" flow to stablecoin transfer when both parties have Gekko wallets
- [ ] name-based payments (`user.suwappu.eth` / `@handle`) reusing existing ENS/CCIP-Read work from the roadmap (item #5)
- [ ] Automatic fiat-rail fallback when recipient has no Gekko wallet
- [ ] Real-time cross-chain balance/fee display before send confirmation
- [ ] Live end-to-end test of a real stablecoin transfer before claiming this rail is "live" (per CLAUDE.md verification standard)

## Cross-Border Payments

### What it is
International money movement — traditionally slow (Swift, 1-5 days) and expensive (correspondent banking fees, FX spread). This is the use case where stablecoins have the clearest structural advantage over legacy rails, and where a WhatsApp-based flow (per roadmap) could reach underserved remittance corridors.

### Vendor / provider options
- **Stablecoin rail (self, via existing infra)** — near-instant, low-cost, works anywhere with internet access, no correspondent banking chain.
- **Bridge (Stripe) / BVNK / Zerohash / Fern** — orchestration for converting stablecoin to local fiat on the receiving end.
- **Swift, via sponsor bank correspondent network** — legacy fallback for corridors where stablecoin off-ramp isn't yet available.
- Reference point from prior research: **Félix** proved WhatsApp financial UX at remittance scale ($3B volume, 300K users) but is custodial and fiat-only — the roadmap flags this as the gap Gekko can fill with a non-custodial equivalent.

### Gekko default
**Stablecoin-first cross-border**, using Gekko's existing multi-chain infrastructure as the transfer rail and **Bridge/BVNK/Zerohash** (verify final pick per corridor) for the local off-ramp leg on the receiving end, with Swift/correspondent banking as the fallback only where no stablecoin off-ramp exists yet. This directly targets the roadmap's identified gap: non-custodial DeFi remittance UX, potentially delivered via WhatsApp given Suwappu's existing WhatsApp swap work.

### Build checklist
- [ ] Identify initial priority remittance corridors (e.g., US to Latin America, matching Félix's proven market)
- [ ] Confirm local off-ramp coverage (Bridge/BVNK/Zerohash) per target corridor before launch
- [ ] Reuse existing WhatsApp swap infrastructure (already code-complete per roadmap) as the initial cross-border UX surface
- [ ] FX rate transparency shown pre-send (stablecoin-to-local-fiat spread, not hidden in a blended rate)
- [ ] Compliance sign-off on cross-border sanctions/AML coverage per corridor (higher-risk corridors need extra review — see `02-regulatory-compliance.md`)
