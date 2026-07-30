# Suwappu Card Feature: Cozy Card Parity — Scoping & Decision Document

**Status:** Pre-engineering decision gate. Nothing below is built.
**Purpose:** Give the founder a single document to decide on a card-issuing partner, scope an MVP, and understand every non-code blocker before any engineering starts.

---

## 1. What Cozy Card (Cwallet) Actually Delivers — the Parity Target

Cozy Card is a virtual Visa/Mastercard debit card issued by Cwallet (Hong Kong + Singapore). Users top up with 17+ cryptocurrencies (including USDC, ETH, SOL, BTC), the platform converts to USD/HKD at time of spend, and the card is accepted at 80M+ merchants worldwide, including AI subscription services (ChatGPT, Midjourney), PayPal, and in-store NFC via Apple Pay / Google Pay on qualifying tiers.

Key specs from their published docs and Medium posts:

- Four tiers: HKD Pro (10 USDT activation), USD Pro/Master (12 USDT), USD Premium (79.9 USDT, physical card, ATM withdrawals, no foreign FX fee)
- Card validity: 3 years from issuance
- PCI DSS certified with fraud monitoring
- Issuing entity: Hong Kong and Singapore regulated entities (exact EMI / MSO license not publicly disclosed — UNVERIFIED: whether they hold a full HK MSO or operate under a banking partner)
- No explicit public KYC tier disclosed in docs; likely light KYC (email + selfie) for virtual tiers
- Top-up: user sends crypto to Cwallet custodial wallet; Cwallet holds the float

**The parity gap Suwappu closes:** Suwappu users already have custodial USDC/ETH balances on 7+ chains. The gap is the last mile: spending that balance at a Visa/Mastercard terminal without going through a CEX withdraw-to-bank cycle. That gap is real and under-served across every Telegram trading bot today. (Sources: [Cwallet Cozy Card docs](https://docs.cwallet.com/cozy-card/what-is-cozy-card), [Cwallet Medium May 2025](https://cwallet.medium.com/cozy-card-new-feature-launch-direct-crypto-top-ups-with-multiple-tokens-for-seamless-global-3a7cd8b87006))

---

## 2. Card-as-a-Service Provider Landscape

### 2.1 Rain (rain.xyz) — Recommended for MVP

**What they do:** Full-stack stablecoin card issuing platform. Rain is both a Visa and Mastercard Principal Member, meaning they sponsor the BIN directly — no intermediary bank needed. They handle issuance, program management, KYC/AML, transaction monitoring, dispute adjudication, and on-chain settlement in USDC. Partners get a single API integration that works across regions.

**Crypto/stablecoin support:** Native. Settlement in USDC on-chain, 7 days/week. Supports custodial and non-custodial wallet models. Cards draw on stablecoin balances at point of sale with real-time conversion. Also supports AI agent card issuance (programmatic single-use virtual cards) — directly relevant to Suwappu's agent-first architecture.

**Geographic coverage:** 150+ jurisdictions, 200+ live partners. North America, LAC, APAC, CEMEA. Cards accepted at 175M+ Visa merchant locations globally.

**KYC handling:** Rain embeds KYC/AML/KYB in the platform. The partner does not need to build their own identity stack — Rain handles compliance, fraud, and dispute adjudication. The partner still needs their own BSA/AML program and a Compliance Officer; Rain's tooling operationalizes the screens.

**Virtual + physical:** Both. Apple Pay and Google Pay provisioning included.

**Integration model:** Single API. Programs reportedly launching in under two weeks for integrations (UNVERIFIED: actual minimum lead time with commercial agreement in place). Dev docs exist but are behind a sales conversation.

**Pricing:** Not public. Rain captures interchange (1–2%), FX spread, and reserve yield. Partners typically pay a per-card fee, a per-transaction fee, and potentially a platform/minimum commitment. UNVERIFIED: specific fee schedule requires NDA-gated term sheet.

**Signals:** $250M Series C (Jan 2026) at $1.95B valuation. Mastercard + Visa principal member simultaneously. $3B+ annualized volume, ~38x growth in 2025. Western Union partnership for remittances. (Sources: [Fortune](https://fortune.com/2026/05/04/mastercard-rain-stablecoin-startup-institutional-customers-partnership/), [rain.xyz/cards](https://www.rain.xyz/cards), [BusinessWire](https://www.businesswire.com/news/home/20250324739515/en/Rain-Announces-$24.5-Million-in-Funding-Led-by-Norwest-to-Expand-Stablecoin-Powered-Card-Issuing-Globally))

**Fit for Suwappu:** High. Global coverage, custodial USDC wallet model matches our existing architecture, no need for us to manage BIN sponsorship or compliance tooling infrastructure. They handle the regulated layer; we own the product surface.

### 2.2 Bridge (bridge.xyz) + Stripe Issuing

**What they do:** Bridge (acquired by Stripe for $1.1B in 2024) provides stablecoin wallet infrastructure; Stripe Issuing provides the card program. The combination lets you issue Visa debit cards funded by USDC from a Bridge custodial wallet, a Privy non-custodial wallet, or any third-party wallet via smart contract pre-authorization. JIT (just-in-time) funding pulls stablecoin at the moment of authorization.

**Crypto/stablecoin support:** USDC on Solana and EVM chains. On-chain approval required at card creation; Bridge pulls funds at point-of-sale. Physical cards (2-day ship), digital wallets (Apple/Google Pay), spending controls, 3DS fraud, Radar.

**Geographic coverage:** 30 countries today, expanding to 100+ by end of 2026.

**KYC handling:** Split. Bridge handles KYC for consumer customers (government ID, proof of address, PEP/sanctions screening, selfie, 18+ age gate). Stripe handles cardholder KYC once the Bridge KYC is complete. KYC endorsement expires 24 hours after completion if no card is issued.

**Integration model:** Relatively clean for developers. Bridge API + Stripe API, with a 6-8 week onboarding timeline (sandbox → 10 internal test users → unlimited production). Stripe Issuing docs are thorough.

**Critical caveat:** Stripe's Prohibited Businesses list explicitly includes cryptocurrency exchanges and wallets. The stablecoin card product is in private preview and appears to be scoped for "SaaS platforms, marketplaces, and crypto-native businesses" — but whether a DEX trading bot qualifies requires explicit written approval from Stripe. This is a hard risk: Stripe has terminated accounts for crypto exchange activity. Do not start building on Bridge/Stripe without a written use-case clearance letter. (Sources: [Stripe stablecoin card docs](https://docs.stripe.com/issuing/bridge-stablecoin-cards), [Stripe prohibited businesses](https://stripe.com/en-th/legal/restricted-businesses))

**Fit for Suwappu:** Medium. Best developer experience and most transparent docs in this space. But the "crypto exchange" prohibition is a serious legal/contractual risk that must be resolved before any engineering commitment.

### 2.3 Immersve

**What they do:** Mastercard Principal Member offering non-custodial card infrastructure. The defining feature: users authorize a smart contract to access their on-chain stablecoin balance; no funds leave the wallet until the moment of purchase. If a transaction is declined, funds return immediately. Wallet custody is never transferred.

**Crypto/stablecoin support:** USDC, smart-contract based. Current live deployments include Algorand (Pera Wallet). EVM and other chain support appears to be in progress.

**Geographic coverage:** Australia, New Zealand, UAE, UK, US listed on homepage. 90M+ Mastercard merchant locations.

**KYC handling:** UNVERIFIED from public docs. Given the non-custodial model, KYC likely falls heavily on the partner application layer, with Immersve providing compliance tooling.

**Virtual + physical:** Both. Apple Pay / Google Pay ("xPays") supported.

**Pricing:** Not publicly disclosed.

**Fit for Suwappu:** Architecturally appealing for a non-custodial future state. However, chain support is still limited (Algorand-first), and the integration is less mature than Rain. Better as a medium-term option if Suwappu moves toward smart account / non-custodial architecture. (Sources: [Immersve.com](https://immersve.com/), [Algorand Pera blog](https://algorand.co/blog/spend-usdc-from-algorand-instantly-how-immersve-and-pera-wallet-enable-real-world-payments))

### 2.4 Baanx / W3C Corp (now Exodus subsidiary)

UK/EU EMI-licensed white-label card infrastructure. Acquired by Exodus Wallet (~$175M, late 2025). EU/UK-only coverage; post-acquisition partner intake uncertain. **Not recommended as primary** — EU-only limits a global Telegram user base and strategic direction is unclear. (Sources: [Architect Partners](https://architectpartners.com/exodus-to-acquire-baanx-for-175m/), [Baanx API docs](https://docs.baanx.com/guides/card/overview))

### 2.5 Reap

Visa Principal Member, HK + Mexico, USDC/USDT collateralization, virtual + physical. Strong in Asia/LatAm/ME. Acquired by Kraken (~$600M, May 2026) — post-acquisition external B2B intake uncertain. Worth monitoring; revisit in 6-12 months. (Sources: [BlockEden](https://blockeden.xyz/blog/2026/05/08/kraken-payward-reap-600m-stablecoin-payments-acquisition/), [Reap](https://reap.global/products/card-issuing), [Circle case study](https://www.circle.com/case-studies/reap))

### 2.6 Kulipa

Stablecoin-native issuing with full-stack compliance (KYC/KYB/AML handled by Kulipa). EU, Argentina, Nigeria live; US pending. 120,000+ cards issued. Good EU-first alternative if Rain is too slow/expensive; limited global coverage. (Sources: [The Block](https://www.theblock.co/post/396063/stablecoin-card-kulipa-seed-round), [Kulipa.xyz](https://www.kulipa.xyz/), [Privy blog](https://privy.io/blog/making-stablecoin-spendable-with-kulipa-debit-cards))

### 2.7 Marqeta / Lithic — General-Purpose Issuers

Enterprise card platforms. Neither natively handles on-chain stablecoin wallets — you'd combine them with a crypto layer (Bridge/Rain) + your own KYC vendor. Volume minimums significant. **Not for MVP**; add when you have card volume. (Sources: [Marqeta crypto](https://www.marqeta.com/blog/marqeta-powers-crypto), [Lithic stablecoin](https://www.lithic.com/blog/stablecoin))

### 2.8 Gnosis Pay (non-custodial, EU-only)

Non-custodial Safe-based Visa card for EEA/UK/Switzerland. Strong architectural alignment but EU-only kills it as a primary global option. Useful reference architecture. (Sources: [Gnosis Pay integration](https://docs.gnosispay.com/integration-model), [Gnosis Pay card](https://gnosispay.com/card))

### Provider Comparison Table

| Provider | Network | Crypto-native | KYC Owner | Geography | Virtual/Physical | Apple/Google Pay | Recommended |
|---|---|---|---|---|---|---|---|
| **Rain** | Visa + Mastercard | Yes (stablecoin settlement) | Rain (embedded) | 150+ jurisdictions | Both | Yes | **MVP pick** |
| Bridge + Stripe | Visa | Yes (USDC, Solana + EVM) | Bridge + Stripe | 30 countries (→100+ 2026) | Both | Yes | Conditional (crypto approval risk) |
| Immersve | Mastercard | Yes (non-custodial) | Partner/shared | AU, NZ, UAE, UK, US | Both | Yes | Medium-term (chain coverage limited) |
| Kulipa | Visa/MC | Yes (stablecoin) | Kulipa | EU, AR, NG, US (pending) | Both | UNVERIFIED | EU-first alternative |
| Reap | Visa | Yes (USDC/USDT) | Reap | Asia, LatAm, ME | Both | UNVERIFIED | Post-acquisition risk |
| Baanx/W3C | Visa | Yes | Baanx | EU/UK | Both | UNVERIFIED | Not recommended |
| Gnosis Pay | Visa | Yes (non-custodial Safe) | Gnosis Pay | EEA/UK/CH | Both | Yes | EU-only — skip for global |
| Marqeta | Visa/MC | Indirect (JIT) | Partner | Global | Both | Yes | Enterprise-only, not MVP |
| Lithic | Visa | Indirect (JIT + Rain) | Partner | US-first | Both | UNVERIFIED | Enterprise-only, not MVP |

---

## 3. Compliance Reality

### 3.1 Division of liability

**Provider holds (you do NOT need to obtain):** BIN sponsorship / card network membership; EMI license; PCI-DSS Level 1; Visa/Mastercard operating-rules compliance; scheme fraud monitoring.

**Suwappu must hold or implement:**
- FinCEN MSB registration (US) — applies to our custodial wallet + swap functions regardless of the card
- BSA AML program: written policies, Compliance Officer, training, independent audits, ongoing monitoring, SAR/CTR filings
- KYC program: ID + address verification, sanctions/PEP screening, EDD for high-risk users (provider may supply tooling; the obligation is ours)
- OFAC sanctions screening (partially implemented in `bot/services/compliance/` for swaps; a card program needs a richer, separate implementation)
- State Money Transmitter Licenses (49 states) + NY BitLicense — multi-year, expensive; most card programs restrict to non-US users initially or rely on a provider holding the licenses
- EU GDPR data processing agreements; Reg E (debit) error-resolution; tax/1099 obligations for any USD-value rewards

### 3.2 PCI-DSS scope

A CaaS provider dramatically reduces but does not eliminate PCI scope. Webhooks must carry only tokenized references (confirm in contract); KYC data storage is in scope; PCI DSS v4.0 (mandatory March 2025) Req 6.4.3 covers embedded third-party scripts. Get a QSA to scope the integration before go-live; budget $30,000–80,000.

### 3.3 Jurisdiction difficulty map

| Jurisdiction | Difficulty | Notes |
|---|---|---|
| EU (EEA) | Medium | EMI framework established; provider holds EMI; GDPR adds obligations |
| UK | Medium | FCA EMI or agent-for-EMI |
| Singapore / HK | Medium | MAS/HKMA frameworks; Reap/Cwallet already operate here |
| US (non-NY) | Hard | MTL per state (49), BSA/AML, FinCEN MSB, Reg E, CFPB |
| US (NY) | Very Hard | BitLicense + MTL + Reg E |
| LatAm (MX, AR, BR) | Medium | Reap in MX; Kulipa in AR; AR currency controls add complexity |
| MENA / Africa | Medium–Hard | Growing corridor; FATF gray-list risk in some countries |

**Recommended launch sequence:** Start non-US (EU/UK/APAC), gating US users at KYC. The `region` column already exists at `bot/models/user.py:46`.

---

## 4. Integration Surface in Our Codebase (description — not built)

### 4.1 `bot/services/card_service.py` (new)
Thin async API client over the chosen CaaS provider, mirroring `savings_service.py` / `wallet.py`. Operations: `issue_card`, `get_card_balance`, `top_up_card` (MONEY-PATH), `get_transactions`, `freeze_card`/`unfreeze_card`, `handle_auth_webhook` (awards loyalty points). Touchpoints: custodial debit via `wallet.py` + `fee_service.py`; KYC gating via new `kyc_status` / `card_provider_customer_id` columns; OFAC screen via `compliance_service.py`.

### 4.2 `/card` handler (`bot/handlers/card.py`)
ConversationHandler like `savings.py`/`swap.py`: CARD_MENU → Issue (KYC gate) / Top Up (MONEY-PATH) / Balance / Freeze / Settings.

### 4.3 Webapp `Card.tsx`
New Mini App route: card art / masked PAN, top-up flow, transaction history, freeze + limits, KYC status CTA. New api-ts routes `GET /webapp/card`, `POST /webapp/card/topup`, `GET /webapp/card/transactions` (pattern: `api-ts/src/routes/webapp.ts`).

### 4.4 KYC flow
Provider-hosted. Button → `create_kyc_session` → open URL via `WebApp.openLink()` → webhook updates `user.kyc_status`. Gate all card ops on `kyc_status == 'verified'`.

### 4.5 Top-up money path (MONEY-PATH review required)
Confirm → check USDC balance ≥ amount + fee → compute platform fee → debit user USDC (on-chain transfer to provider settlement address OR API-level debit of pre-funded pool) → POST provider funding endpoint → record `CardTopUp` (idempotency key to avoid double-debit) → reverse on failure.

### 4.6 Webhook handler (`POST /card/webhook`)
Validate HMAC; parse auth event; award points via existing points infra; optional push notification; idempotent on replay (`card_webhook_events` table).

---

## 5. Recommended Path

### 5.1 Pick Rain as primary partner
Global coverage from day one; compliance owned by provider; custodial USDC model matches our architecture (on-chain USDC settlement = clean top-up, no fiat rails). Bridge + Stripe is the backup IF Stripe grants written crypto use-case clearance.

### 5.2 MVP scope — virtual USD card, USDC top-up, no physical card v1

| Scope item | In MVP | Rationale |
|---|---|---|
| Virtual card only | Yes | Physical adds logistics/PII; skip v1 |
| USD denomination | Yes | USDC→USD native to Rain |
| USDC top-up (custodial) | Yes | Matches existing wallet model |
| Non-USDC top-up | No | Needs swap-then-top-up; v2 |
| Apple/Google Pay | Yes (via provider) | Auto-provisioned |
| Physical card / ATM | No | v2 after validation |
| Spend-to-earn points | Yes | Webhook → `award_points`; low lift |
| US users | No (v1) | Gate via `region`; MTL burden prohibitive |
| EU / APAC users | Yes | Rain licensed |

### 5.3 Sequencing (≈4–5 months to first real card)
Wk 0–2 contact Rain → demo → NDA · Wk 2–6 term sheet · Wk 4–8 retain payments counsel · Wk 6–10 counsel review (MSB/MTL, KYC, Reg E/GDPR) · Wk 8–12 sign contract + sandbox · Wk 12–14 KYC program written + counsel-approved · Wk 12–16 QSA PCI scoping · Wk 14–18 engineering builds in sandbox · Wk 18–20 internal QA + 10-user pilot · Wk 20+ phased regional rollout (EU/APAC first, US last/never until MTL stack).

---

## 6. Economics Checkpoint
Per `docs/economics/COBRAND_CARD_AND_COALITION.md`: interchange ~1.6% (prepaid avoids Durbin cap); give-back 1% in `current_points` (not token-convertible); self-funding at 20–30% breakage → positive spread. **Do NOT co-mingle card-earned points with the token-convertible season balance** (legal: payment-linked rewards must stay away from anything security-like). Apply existing tier fee (1%/0.5%/0.3%) to top-up amounts as a second revenue layer.

---

## 7. Blockers Before We Can Build

1. **Partner contract signed (Rain or alternative)** — founder-level BD, not a PR. No sandbox/pricing/SLA until executed.
2. **Fintech compliance counsel retained** (payments lawyer, not general crypto). Most under-estimated blocker. Budget $50K–150K initial.
3. **KYC/BSA-AML program designed + counsel-approved** before the first real card — must also satisfy the partner's review of us.
4. **PCI-DSS scope assessment by a QSA** before production. Budget $30K–80K.
5. **US MTL strategy decision**: (a) exclude US at launch [simplest], (b) begin 49-state MTLs (~12–24 mo, ~$500K), or (c) provider holds MTLs on our behalf (confirm with Rain).
6. **Stripe/Bridge use-case clearance** (if Bridge chosen) — written approval permitting our DEX-bot use case.
7. **DB schema migration plan** — `kyc_status`, `card_provider_customer_id`, `card_id` columns via `_ensure_schema()`.
8. **Points policy sign-off** — counsel confirms card-spend earn doesn't create a "cash equivalent" instrument; keep the two-balance rule (`current_points` only).

---

## Relevant Existing Files (engineering handoff)

- `bot/services/compliance/compliance_service.py` — existing OFAC/address screening; extend for card KYC gating
- `bot/services/compliance/ofac_list.py` — seed sanctions list; needs richer feed
- `bot/models/user.py` — `User` model with `region` (line 46); add `kyc_status`, `card_provider_customer_id`
- `bot/services/savings_service.py` — structural template for the card service
- `bot/handlers/savings.py` — ConversationHandler pattern for `/card`
- `bot/services/fee_service.py` — tier fee logic for top-up amounts
- `api-ts/src/routes/billing.ts` — billing route pattern for card API routes
- `api-ts/src/routes/webapp.ts` — webapp route pattern for `/webapp/card`
- `database/db.py` — `_ensure_schema()` for additive idempotent migrations
- `docs/economics/COBRAND_CARD_AND_COALITION.md` — interchange economics + two-balance rule (authoritative)
- `docs/internal/NEOBANK_ROADMAP.md` — competitive context; card is roadmap item #10

---

*Document compiled June 2026. Provider details sourced from primary URLs; anything marked UNVERIFIED requires direct confirmation with the provider or counsel before relying on it for contractual or engineering decisions.*

### Sources
- [Rain Cards](https://www.rain.xyz/cards) · [Rain Series C / Mastercard (Fortune)](https://fortune.com/2026/05/04/mastercard-rain-stablecoin-startup-institutional-customers-partnership/) · [Rain Norwest round (BusinessWire)](https://www.businesswire.com/news/home/20250324739515/en/Rain-Announces-$24.5-Million-in-Funding-Led-by-Norwest-to-Expand-Stablecoin-Powered-Card-Issuing-Globally)
- [Stablecoin Cards 2026 (insights4vc)](https://insights4vc.substack.com/p/the-state-of-stablecoin-cards)
- [Bridge stablecoin cards (Stripe Docs)](https://docs.stripe.com/issuing/bridge-stablecoin-cards) · [Bridge + Visa (Stripe)](https://stripe.com/newsroom/news/bridge-partners-with-visa) · [Stripe Prohibited Businesses](https://stripe.com/en-th/legal/restricted-businesses)
- [Immersve](https://immersve.com/) · [Immersve + Pera (Algorand)](https://algorand.co/blog/spend-usdc-from-algorand-instantly-how-immersve-and-pera-wallet-enable-real-world-payments)
- [Kulipa seed (The Block)](https://www.theblock.co/post/396063/stablecoin-card-kulipa-seed-round) · [Kulipa + Privy](https://privy.io/blog/making-stablecoin-spendable-with-kulipa-debit-cards)
- [Reap card issuing](https://reap.global/products/card-issuing) · [Kraken acquires Reap (BlockEden)](https://blockeden.xyz/blog/2026/05/08/kraken-payward-reap-600m-stablecoin-payments-acquisition/) · [Circle + Reap](https://www.circle.com/case-studies/reap)
- [Exodus acquires Baanx (Architect Partners)](https://architectpartners.com/exodus-to-acquire-baanx-for-175m/) · [Baanx API docs](https://docs.baanx.com/guides/card/overview)
- [Gnosis Pay integration](https://docs.gnosispay.com/integration-model)
- [Marqeta crypto](https://www.marqeta.com/blog/marqeta-powers-crypto) · [Lithic stablecoin](https://www.lithic.com/blog/stablecoin)
- [Cwallet Cozy Card docs](https://docs.cwallet.com/cozy-card/what-is-cozy-card) · [Cwallet Medium](https://cwallet.medium.com/cozy-card-new-feature-launch-direct-crypto-top-ups-with-multiple-tokens-for-seamless-global-3a7cd8b87006)
- [Nium stablecoin card issuance](https://www.nium.com/newsroom/nium-launched-stablecoin-card-issuance-platform)
