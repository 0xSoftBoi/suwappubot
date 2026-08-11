# Onboarding

Onboarding is where Gekko either converts the trust it inherited from Suwappu into a funded account, or loses the user to drop-off. Because the initial ICP is crypto-native (see `08-icp-positioning.md`), onboarding can lean on wallet-based identity and lighter KYC than a cold-start neobank would need — but a card and any fiat rail still require real KYC/KYB. The flow described here should be tuned per the roadmap's permissionless line: keep the non-custodial pieces frictionless, and isolate the regulated-partner pieces (KYC, card issuance) as clearly bounded steps.

## Account Creation

### What it is
The initial signup step — creating a Gekko identity, typically by connecting or generating a non-custodial wallet, tied to the user's existing Telegram/WhatsApp identity where possible.

### Playbook / options
- Reuse existing Suwappu wallet/session where the user is already authenticated in Telegram/WhatsApp — zero new-wallet friction for existing users.
- For net-new users: embedded wallet creation (e.g., Privy-style OAuth login flow, as Banana Pro used to reach 1.3M users per the roadmap doc) rather than requiring seed-phrase literacy on day one.
- Minimize required fields at this step — email/phone + wallet only; defer everything else (KYC, funding) to later steps.
- Benchmark: top-tier fintech signup-to-account-created flows complete in under 2 minutes (verify against Gekko's actual flow once built).

### Gekko default
For existing Suwappu users, account creation should be a single tap from within the Telegram bot or WhatsApp thread they already trust — no new app download required to start. For net-new users, use an embedded-wallet OAuth-style flow to avoid seed-phrase drop-off.

### Target metric
- Signup start → account created completion rate: target 80%+ for existing Suwappu users (near-zero friction), 40-50%+ for net-new users (verify benchmarks).

## KYC / KYB

### What it is
Identity verification for individuals (KYC) or businesses (KYB), required before regulated features (card, fiat on/off-ramp) can be activated — this is the one onboarding step that cannot be made permissionless, per the roadmap's architecture notes.

### Playbook / options
- Gate KYC behind the specific feature that needs it (card, fiat ramp) rather than requiring it at signup — let users experience yield/swap/non-custodial features KYC-free first, per the "permissionless line."
- Vendor options for identity verification: Persona, Onfido, Alloy (verify current pricing/fit — not yet selected).
- KYB for SMB/DAO accounts is heavier (beneficial ownership, entity docs) — expect this to be the biggest drop-off point for the SMB motion; consider a manual/white-glove path for early DAO/SMB accounts rather than a broken self-serve KYB flow.
- Tiered verification: light KYC unlocks small card limits, full KYC unlocks full limits (standard neobank pattern, e.g., Chime/Cash App tiers — verify current thresholds).

### Gekko default
Defer KYC entirely until a user requests a card or fiat ramp — keep the initial banking experience (yield, swap, non-custodial send) fully permissionless, consistent with the roadmap's core differentiation. For SMB/DAO KYB, run early accounts through a manual/high-touch process rather than building automated KYB before there's volume to justify it.

### Target metric
- % of accounts that complete KYC when they hit a gated feature (card/ramp): target 60%+ completion (verify — KYC funnels commonly lose 30-50% of users, this is a real risk to plan for).
- KYB manual review turnaround for early SMB accounts: target under 48 hours.

## Risk Review

### What it is
Fraud, sanctions (OFAC), and AML screening applied to accounts and transactions — both at onboarding (screening the applicant) and ongoing (transaction monitoring), typically run by or alongside the KYC/KYB vendor and/or the card/banking partner.

### Playbook / options
- Sanctions/PEP screening as part of the KYC vendor flow (most vendors like Persona/Onfido bundle this — verify).
- Ongoing transaction monitoring likely inherited from whichever regulated card/banking partner Gekko integrates with (Gnosis Pay B2B, Immersve, etc. per the roadmap) — Gekko itself should not need to build this from scratch.
- Set risk thresholds conservatively at launch (manual review for edge cases) and loosen only as false-positive/false-negative rates are understood.
- This step is invisible to the user when it passes cleanly — the design goal is that most users never notice it happened.

### Gekko default
Rely on the KYC vendor and the eventual card/banking partner's built-in risk/compliance stack rather than building proprietary screening — Gekko's job is to wire these in correctly and handle the manual-review edge cases responsively, not to reinvent AML tooling.

### Target metric
- % of applicants auto-cleared without manual review: target 85%+ (verify against vendor baseline).
- Manual review SLA: under 24 hours for flagged individual accounts.

## Account Approval

### What it is
The point at which a user's account moves from "pending" to fully active, typically gated by successful KYC/KYB and risk review completion (for the regulated-feature tier) — for the permissionless tier, this can happen instantly at account creation.

### Playbook / options
- Two-tier approval: non-custodial features (wallet, yield, swap) approve instantly; regulated features (card, ramp) approve only after KYC/risk clears.
- Clear, honest status communication — "your account is active, your card is pending verification" rather than a single opaque "pending" state that hides what's actually blocking the user.
- Push notification / bot message the moment approval completes, to catch the user while intent is still fresh.

### Gekko default
Instant approval for the non-custodial tier (matches the "build permissionless" architecture) with a visibly separate, clearly-labeled approval gate for card/ramp features — never make a crypto-native user wait on KYC to start earning yield.

### Target metric
- Time from account creation to non-custodial-tier approval: target instant (under 1 minute).
- Time from KYC submission to regulated-tier approval: target under 24 hours (verify against chosen vendor's actual turnaround).

## First Deposit

### What it is
The moment a user actually funds their Gekko account — the true activation signal, since an unfunded account has zero retention or revenue value.

### Playbook / options
- For existing Suwappu users: offer a one-tap "sweep idle balance into Gekko" action, since they likely already have stablecoin sitting idle in a connected wallet (directly reuses the roadmap's #1 white-space finding).
- For net-new users: on/off-ramp widget (MoonPay/Transak per the roadmap) or direct crypto deposit address/QR.
- Small funding incentive (e.g., yield boost or bonus for first deposit within 24-48 hours of signup) to compress the funnel.
- Track and directly attack "signed up but never funded" as the single biggest onboarding leak — this is where most neobank funnels lose users (verify against Gekko's actual data once live).

### Gekko default
Build the one-tap "move your idle trading balance into yield" flow as the primary first-deposit path — it's the shortest possible path from existing Suwappu wallet balance to funded Gekko account and requires no new capital from the user.

### Target metric
- Account approved → first deposit completion rate: target 60%+ for existing Suwappu users (verify — should be materially higher than net-new since capital already exists).
- Median time to first deposit: target under 24 hours from approval.

## Card Activation

### What it is
The step where a user's virtual and/or physical card becomes usable — includes card issuance (post-KYC), virtual card provisioning, physical card shipping (if applicable), and adding the card to a mobile wallet.

### Playbook / options
- Instant virtual card issuance immediately after KYC clears — don't make users wait for a physical card to start spending.
- Physical card: standard issuance/shipping timelines apply (typically 5-10 business days — verify with chosen card partner).
- Apple Wallet / Google Wallet push provisioning directly from the app at the moment of virtual card issuance — removes a major activation-funnel drop-off point common in card fintech.
- Partner dependency: card issuance is gated on whichever regulated partner is chosen (Gnosis Pay B2B, Immersve — per the roadmap's "requires a regulated partner" list), so this timeline is not fully in Gekko's control.

### Gekko default
Prioritize instant virtual card + immediate Apple/Google Wallet push provisioning as the default activation path; treat the physical card as a nice-to-have follow-up, not a blocker to first spend.

### Target metric
- KYC cleared → virtual card activated: target under 5 minutes.
- % of activated cards added to a mobile wallet within 24 hours: target 50%+.

## First Transaction

### What it is
The user's first real spend or transfer using Gekko — first card swipe, first send, or first bill payment — the moment the product proves its utility beyond "a place my money sits."

### Playbook / options
- Prompt a low-stakes first transaction immediately post-activation (e.g., a small test purchase, or paying a recurring subscription) rather than leaving the user to find a use case on their own.
- Track first transaction type (card spend vs. transfer vs. bill pay) to understand which use case actually pulls users in — don't assume card spend is always first.
- Consider a small cashback/bonus on first card transaction to remove hesitation.

### Gekko default
For the crypto-native beachhead, the natural first transaction is likely a peer-to-peer send (paying back a friend, tipping, settling a DAO contributor payment) rather than a card swipe — design the first-transaction nudge around send/pay, with card spend as the second milestone.

### Target metric
- Card/account activated → first transaction within 7 days: target 50%+.
- Median transaction value of first transaction: track as a segmentation signal, no hard target.

## Direct Deposit / Payroll Switch

### What it is
The highest-intent activation event in neobanking — a user routing their recurring paycheck or income into Gekko, which cements it as their primary account (see `13-primary-account-strategy.md` for the full strategy).

### Playbook / options
- Direct deposit switch kits (a common fintech pattern) that auto-generate the forms/info needed to redirect payroll — vendors: Atomic, Pinwheel, Argyle for payroll connectivity and switching.
- For the crypto-native beachhead, "payroll" more often looks like recurring DAO/protocol contributor payments — a nearer-term, more relevant version of this same behavior.
- This is a later-funnel event, not a day-one onboarding step — most users won't do this until they trust the product from repeated use.

### Gekko default
Do not push traditional direct-deposit switching in the initial onboarding flow — it's the wrong ask for a crypto-native user's first session. Instead, treat "route your recurring DAO/contributor payment through Gekko" as the equivalent early-stage activation event, and defer full payroll-switch tooling (Pinwheel/Argyle) until the SMB/startup segment is active. See `13-primary-account-strategy.md` for the full build-out.

### Target metric
- Not tracked in initial onboarding funnel; tracked separately as a primary-account-strategy metric once SMB motion is live.
