# Cards

Gekko's card is the "gains to spending" bridge the roadmap flags as the #2 gap
across every trading bot and terminal (realize → withdraw → CEX → bank → days).
A card that spends directly off a Suwappu wallet — non-custodial where possible,
overcollateralized credit before fiat credit — is the single feature most likely
to convert a trading user into a daily-active banking user. Everything in this
file assumes the debit rail launches first (roadmap item #10) and credit
follows once GHO/Morpho borrow (item #9) is live and proven.

## Debit

### What it is
A Visa/Mastercard-branded debit card that spends directly from wallet balance,
authorized in real time against on-chain or custodial funds. This is the
regulated layer the roadmap says Suwappu must integrate, never build — Visa is
~97% of crypto-card volume and card issuance itself is never permissionless
(verify — figure is from the roadmap's competitive sweep, not a primary Visa
source).

### Vendor / provider options
- **Gnosis Pay B2B** — non-custodial Safe-account architecture, EEA/UK coverage; purest philosophical fit but geo-limited.
- **Immersve** — Mastercard rail with smart-contract pre-auth holds; closest to "spend straight from a wallet" without full custody.
- **Rain** — global scale, custodial model, fastest partner-integration path but gives up the non-custodial story.
- **Marqeta / Lithic / Highnote** — traditional card-issuing processors if Gekko ever needs a fiat-first fallback rail alongside the crypto-native one.

### Gekko default
Lead with **Immersve** for the pre-auth-from-wallet model (closest match to
Suwappu's non-custodial wallet architecture), keep **Gnosis Pay B2B** as the
EEA/UK track since it's the most proven non-custodial card in production today.
Do not build a custodial Rain-style ledger as the default path — offer it only
as an opt-in KYC'd tier, mirroring the Ondo/USDY "dual-track" pattern from the
roadmap.

### Build checklist
- [ ] Partner diligence call + commercial terms with Immersve and Gnosis Pay B2B (BIN sponsor, settlement currency, supported chains)
- [ ] Pre-auth hold flow: reserve stablecoin balance at swipe time, settle to card network T+1/T+2
- [ ] Card issuance UX in webapp + bot (`/w card`) — virtual card first, physical mailed later
- [ ] Spend webhook → Suwappu ledger reconciliation, retried and idempotent
- [ ] Declines-on-insufficient-yield-locked-balance handling (don't let a Savings lock cause a false decline)

## Credit

### What it is
A credit line the user draws down at swipe time instead of spot balance,
backed by collateral rather than a FICO score. Per the roadmap, undercollateralized
consumer credit has no permissionless version and should be skipped entirely —
Gekko's "credit card" is functionally a borrow against locked collateral.

### Vendor / provider options
- **Aave GHO / Morpho borrow** — permissionless overcollateralized credit line, no KYC, matches roadmap item #9 exactly.
- **Ether.fi Cash Borrow Mode** — closest live analog to copy (verify current terms/rates).
- **Coventure, Atalaya, i80 Group, Victory Park** — off-chain debt facilities, only relevant if Gekko later fronts fiat credit lines and needs warehouse funding (see `06-credit.md`).

### Gekko default
Ship the **GHO/Morpho overcollateralized line** first — user locks ETH/BTC/LST
collateral, draws a stablecoin credit line, spends it through the debit card
rail above. This needs zero credit underwriting and zero new regulatory
surface. Fiat-backed revolving credit (undercollateralized) is explicitly
out of scope until/unless a later phase brings in a debt-facility partner —
see `06-credit.md`.

### Build checklist
- [ ] Collateral lock UI (ETH/BTC/LST → GHO or Morpho stablecoin credit line)
- [ ] Liquidation-risk banner on card spend screen when LTV crosses a threshold
- [ ] Auto top-up / auto-repay from linked Savings yield (optional toggle)
- [ ] Route card pre-auths against the credit line balance, not spot wallet
- [ ] Health-factor alerts via existing `alert_service`

## Employee Cards

### What it is
Sub-cards issued under a primary account or company treasury, with per-card
spend limits, merchant-category restrictions, and centralized reporting —
the B2B/treasury-management use case rather than consumer spend.

### Vendor / provider options
- **Highnote** — program management built for multi-card-under-one-entity issuance.
- **Marqeta** — mature multi-card programs, heavier integration lift.
- **Ramp / Brex-style in-house builds** — not vendors Gekko would buy, but the UX bar to match (verify).

### Gekko default
Defer. Employee cards are a B2B treasury feature with no crypto-native
version and low relevance until Gekko has business/DAO-treasury customers.
Revisit once `07-treasury.md`'s treasury-management line has real demand.

### Build checklist
- [ ] Validate demand with 2-3 DAO/business treasury customers before building
- [ ] Sub-account + spend-limit data model (extends existing wallet model)
- [ ] Admin console for limit/merchant-category controls
- [ ] Consolidated statement export per employee card

## Card Controls

### What it is
User-facing controls to freeze/unfreeze, set spend limits, restrict merchant
categories or geographies, and manage single-use virtual card numbers —
table stakes for any modern card product and a direct trust signal for a
non-custodial audience.

### Vendor / provider options
- **Sardine, Unit21, Alloy Fraud** — velocity/limit rules engines that double as fraud control (see `17-risk.md`).
- Native issuer-processor controls (Immersve/Gnosis Pay/Lithic all expose freeze/limit APIs) — usually the fastest path, no separate vendor needed.

### Gekko default
Use the card issuer's native controls API (Immersve/Gnosis Pay) rather than a
separate controls vendor for v1 — freeze, per-transaction limit, and
merchant-category block cover the 80% case. Layer Sardine/Unit21 in once
volume justifies a dedicated risk engine (see `17-risk.md`).

### Build checklist
- [ ] Freeze/unfreeze toggle in bot (`/w freeze`) and webapp
- [ ] Per-transaction and daily spend limit settings
- [ ] Merchant-category-code block list (gambling, cash advance by default)
- [ ] Single-use virtual card number generation for online purchases

## Rewards

### What it is
Cashback, points, or token rewards on card spend — a retention lever that,
for a crypto-native card, can plausibly be denominated in yield or protocol
tokens rather than fiat cashback.

### Vendor / provider options
- **Kard** — card-linked offers/cashback network, plug-in rewards without building merchant deals.
- **TripleUp** — crypto-cashback-specific rewards infra (verify current product scope).
- Native token/points system (build in-house) — full control, matches Suwappu's existing XP/`/xp` system.

### Gekko default
Extend the existing **`/xp` points system** to card spend rather than
standing up a new vendor immediately — it's already built, and "earn XP on
every swipe" is a cheap, on-brand differentiator. Add **Kard** later if fiat
merchant cashback becomes a competitive requirement.

### Build checklist
- [ ] Map card-spend webhook events into existing XP/points ledger
- [ ] Define reward tiers (spend threshold → XP multiplier)
- [ ] Evaluate Kard integration once merchant cashback demand is validated
- [ ] Rewards redemption flow (XP → fee discount or yield boost)

## Premium / Metal Cards

### What it is
A physical metal card tier signaling status, usually gated behind an AUM,
staking, or subscription threshold — a proven neobank/crypto-card monetization
lever (Coinbase Card, Crypto.com metal tiers).

### Vendor / provider options
- **CompoSecure** — dominant metal-card manufacturer, used by Chase Sapphire/Amex/Coinbase-tier programs.
- **Arculus** — metal card with embedded secure element, doubles as a hardware key/NFC auth factor (verify current specs).

### Gekko default
Defer to phase 2. If pursued, prefer **Arculus** over plain CompoSecure metal
since the embedded secure element could double as a hardware signer for
wallet auth — more aligned with Gekko's non-custodial story than a purely
cosmetic metal card.

### Build checklist
- [ ] Define AUM/staking threshold for metal-tier eligibility
- [ ] Vendor quote + MOQ from CompoSecure or Arculus
- [ ] Evaluate Arculus secure-element as a 2FA/signing hardware key, not just card stock
- [ ] Fulfillment/mailing logistics (likely via issuer partner, not in-house)
