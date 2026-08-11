# ICP Positioning

Gekko inherits Suwappu's existing trading user base and Telegram/WhatsApp distribution — a real asset most neobank launches don't have. Positioning has to pick a beachhead that converts that base into deposits without diluting focus into a generic "neobank for everyone" pitch. The core thesis from `NEOBANK_ROADMAP.md` holds here too: no incumbent combines trading with bank primitives, and no one has WhatsApp-native DeFi — so Gekko's ICP work is about sequencing which adjacent segment to open next, not picking one segment forever.

## Consumer

### What it is
Individual retail users who want a bank account replacement or supplement — checking, savings, a card, and now yield — reached mostly through mobile app stores and chat.

### Playbook / options
- Segment further: "crypto-curious saver" vs. "active trader who wants banking" vs. "unbanked/underbanked emerging-market user" (verify TAM sizing per segment).
- Lead with a single sharp wedge (e.g., "your idle USDC earns 4-6% instead of 0%") rather than a full feature list.
- Free/low-cost account, small referral bonus, in-app education on non-custodial vs. custodial risk.
- Competitive bar: Cash App, Chime, Revolut for UX; Gnosis Pay/Zeal for non-custodial card UX (verify current feature parity).

### Gekko default
Consumer is the beachhead, specifically the existing Suwappu trader — someone who already has a non-custodial wallet, already trusts the brand, and is currently earning 0% on idle stablecoin balances between trades. Convert them to "banked" before spending anything acquiring net-new consumer users.

### Target metric
- % of active Suwappu traders (Telegram + WhatsApp) with a Gekko account within 90 days of launch: target 15-20% (verify against actual MAU once known).
- Idle-balance-to-yield conversion rate among converted users: target 50%+.

## SMB

### What it is
Small businesses (1-50 employees) — crypto-native ones first (DAOs, Web3 studios, on-chain-paid freelancer shops), then general SMBs — needing business banking, payroll, and bill pay.

### Playbook / options
- Start with crypto-native SMBs already comfortable with stablecoin treasury (DAOs, Web3 agencies) — lowest trust barrier.
- Business account + multi-sig treasury view + payroll-in-stablecoins as the wedge.
- Tools: Safe (multisig), Request Finance or similar for invoicing (verify current vendor landscape).
- General SMB expansion later requires KYB, AP/AR, and accounting integrations (Codat/Rutter) — heavier lift.

### Gekko default
Second-wave segment. Target SMBs that already pay contributors in stablecoins (crypto-native studios, DAOs) using the same Telegram/WhatsApp channel — many are run by people who are already personal Suwappu users.

### Target metric
- 50 crypto-native SMB accounts opened in the two quarters following consumer launch (verify against GTM capacity).
- Average business balance per SMB account: target $10K+ within 6 months.

## Startups

### What it is
Early-stage, often venture-backed companies (pre-seed to Series A) needing a business bank account, card program for spend management, and simple treasury/yield on runway cash.

### Playbook / options
- Compete on speed-to-account (hours not weeks) and yield on idle treasury vs. 0% at legacy banks.
- Card + spend controls + runway dashboard as the wedge (Ramp/Brex playbook, crypto-native variant).
- Target crypto/Web3 startups first — same trust bridge as SMB crypto-native segment.
- Accelerator/incubator partnerships for top-of-funnel (verify which accelerators are crypto-friendly).

### Gekko default
Fold into the SMB crypto-native wave initially — treat "crypto startup treasury" as the same motion as "crypto-native SMB," differentiated mainly by higher average balances and card spend-control needs. Don't build a separate GTM motion until traction is proven.

### Target metric
- 10-15 startup treasury accounts with >$50K balance within first 2 quarters post-SMB launch (verify).
- Card spend volume per active startup account: track as leading indicator, no hard target yet.

## Middle Market

### What it is
Companies roughly 50-500 employees with more complex treasury, multi-entity, and payroll needs — a segment requiring real banking infrastructure (FDIC-backed rails, robust compliance) that Gekko is not positioned for in year one.

### Playbook / options
- Typically requires bank-grade compliance, dedicated relationship management, and integrations into existing ERP/accounting stacks.
- Not a near-term fit without a banking-as-a-service partner and KYB program mature enough to handle multi-entity structures.
- If pursued, would need dedicated enterprise sales motion, not self-serve.

### Gekko default
Explicitly out of scope for the first 12-18 months. Revisit only after SMB traction and a proven compliance stack. Do not build features against this segment yet — the risk is diluting the crypto-native beachhead focus.

### Target metric
- No target set for year one; tracked as a "revisit" flag tied to SMB account count crossing 500+ active accounts (verify threshold).

## Enterprise

### What it is
Large organizations (500+ employees) needing enterprise treasury management, custom integrations, dedicated support, and heavy compliance — the furthest segment from Gekko's current capability.

### Playbook / options
- Requires dedicated enterprise sales, SOC2/compliance certifications, custom SLAs, and likely a banking-as-a-service or chartered-bank partner.
- Sales cycles measured in quarters, not weeks — mismatched with current team size and stage.

### Gekko default
Out of scope. Not a target for the current roadmap horizon. No resourcing against this segment until Gekko has multi-year SMB/middle-market traction.

### Target metric
- None. Explicitly deferred — do not track vanity metrics against a segment with no active GTM motion.

## Vertical Specific

### What it is
Industry-specific niches where a tailored product (workflows, compliance, integrations) beats a horizontal offering — e.g., on-chain gaming studios, NFT/creator economy businesses, DeFi protocol treasuries.

### Playbook / options
- Pick verticals where crypto-native payment/treasury pain is acute and horizontal banks underserve them: DAOs, on-chain gaming studios, creator/NFT businesses, DeFi protocol treasuries.
- Build light vertical features (e.g., protocol treasury multi-sig views, streaming payroll for contributor DAOs via Superfluid/Sablier — already on Suwappu's roadmap) rather than full vertical products.
- Distribution via vertical-specific Discord/Telegram communities, not generic ads.

### Gekko default
Treat "DeFi protocol / DAO treasury" as the first vertical, since it's a natural extension of Gekko's existing crypto-native SMB motion and reuses the recurring-transfer/session-key infrastructure already planned (item #2 on the neobank roadmap).

### Target metric
- 10 DAO/protocol treasury accounts using Gekko for payroll/treasury within 2 quarters of SMB launch (verify).

## Crypto Native

### What it is
Users and businesses who already hold, trade, or transact in crypto and need less education/trust-building than mainstream users — Gekko's structural home-field advantage via the existing Suwappu base.

### Playbook / options
- Lead with primitives crypto-natives already understand and value: self-custody, on-chain yield (Aave/Morpho/Sky), transparent fees, ENS-style payments.
- Distribution almost entirely through existing channels: Telegram bot upsell, WhatsApp, X/crypto Twitter, no paid acquisition needed initially.
- Product bar: match or beat Gnosis Pay / Zeal / Ether.fi Cash on non-custodial card UX (verify current state).

### Gekko default
This is the primary ICP for the first 2-3 quarters, full stop. Every other segment in this file is sequenced off of crypto-native success. The existing Suwappu Telegram/WhatsApp user base is the entire initial funnel — treat CAC here as near-zero and instrument conversion hard before spending on anything else.

### Target metric
- Suwappu-user-to-Gekko-account conversion rate: target 20%+ within 90 days of in-bot prompt launch.
- Time from Gekko signup to first funded balance: target under 24 hours (median).

## Ultra High Net Worth

### What it is
Individuals with very large (multi-million+) net worth needing private banking, bespoke treasury/yield strategies, and white-glove service — a segment with high revenue-per-user but demanding trust and compliance bars.

### Playbook / options
- Would require dedicated relationship management, custom yield/credit structuring (e.g., large overcollateralized borrow lines against crypto holdings), and white-glove onboarding.
- Whale wallets already exist in Suwappu's trading data (verify: does Suwappu currently identify/segment whale traders?) — could be a low-CAC pilot cohort if pursued.
- High trust bar; a security incident here is reputationally catastrophic disproportionate to segment size.

### Gekko default
Not an active GTM target, but worth a lightweight "concierge" pilot with the top 20-50 existing Suwappu traders by volume once core consumer product is stable — high revenue-per-account with near-zero incremental CAC since they're already users. Do not build UHNW-specific features yet; handle manually if pursued.

### Target metric
- No formal target; if piloted, track average balance per UHNW account (informal goal: $250K+) and qualitative NPS/relationship feedback only.
