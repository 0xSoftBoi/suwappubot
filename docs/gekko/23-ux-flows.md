# UX Flows

This doc audits Gekko's mobile app (`mobile/`) as currently built, defines to-be flows that close the gaps, and specifies the funnel + instrumentation needed to know whether any of it works. It reconciles against the targets already set in `11-onboarding.md` (account creation, KYC, first deposit) and `12-activation.md` (fund account, first spend). Those docs describe the funnel Gekko *wants*; this doc describes the app Gekko *has*, and the flows that connect the two.

## 1. Headline

Three structural blockers, not UX polish issues. The per-screen flows themselves (once a user is in) are tight — 2-5 taps for most actions. The problem is nobody can reach them, nobody can fund them (net-new users only — see correction below), and nobody can measure any of it.

| # | Blocker | Evidence | Impact |
|---|---|---|---|
| 1 | **No entrance.** There is no sign-in, signup, or Telegram/WhatsApp auth flow. `SignedOutState` is a terminal dead end. | `mobile/src/components/screen-state.tsx:27-39` — literally renders "Sign-in is not part of this preview." | 100% of net-new and even reconnecting Suwappu users stop at step 0. The `11-onboarding.md` "single tap from within Telegram" default does not exist in code. Because auth is the only gap for the Suwappu beachhead (see correction below), this blocker alone is now their entire funnel problem. |
| 2 | **No funding path (net-new users only).** There is no on-ramp, no card, no working QR. Receive is address-copy only. | `mobile/app/receive.tsx:45-65` — QR is a code comment ("coming soon"), no MoonPay/Transak widget. | This blocks funding for a user arriving with $0 and no existing Suwappu wallet — the `11-onboarding.md` "First Deposit" step for that population. It does **not** block existing Suwappu bot users: their balance is already sitting in the row the app reads (see correction below), so there is no funding step to build for them. |
| 3 | **No measurement.** Zero analytics events anywhere in the app. | Grep for `analytics\|track\|posthog\|amplitude\|segment\|mixpanel\|telemetry\|logEvent` across `mobile/` returns only a dead comment at `mobile/src/lib/perf.ts:48` — no live call sites. | Every target number in `11-onboarding.md` and `12-activation.md` (80% signup completion, 60% first-deposit rate, 40% first-spend) is currently unmeasurable. Gekko cannot know if it's improving or regressing anything below. |

Everything in sections 3-6 exists to fix these in priority order: auth → funding (net-new only) → measurement. Fixing per-screen tap counts without fixing the entrance is optimizing a room nobody can walk into.

> **Correction (from code, not docs — 2026-08-11):** an earlier version of this doc assumed funding an existing Suwappu user requires "pulling funds from your Suwappu bot wallet," i.e. a transfer. That premise is wrong. Verified: the Gekko mobile app and the Telegram bot resolve to the **same** `users.id` and the **same** `Wallet` rows. `api/routes/mobile.py:187-203` (`_jwt_user`) extracts `user_id` from the JWT and both `api/routes/mobile.py:2209,2221` and `bot/handlers/start.py:130` call the identical `wallet_service.get_user_wallets(user_id)`; `bot/models/user.py:115` shows `Wallet.user_id` is a plain FK to `users.id` — one wallet table, two front doors. For an existing Suwappu bot user there is no transfer, no bridge, and no funding step: signing into Gekko *is* funding, because the bot wallet balance the user already has *is* the app's balance. This is a genuine structural advantage over cold-start neobanks (who must build and fund a brand-new account from zero) and is worth protecting in future architecture decisions — e.g. never introducing a second wallet-per-surface model that would silently reintroduce the transfer step this doc previously (incorrectly) assumed.

## 2. User Stories

Personas per `08-icp-positioning.md`. Priority: P0 = blocks launch, P1 = blocks stated activation targets, P2 = improves conversion but not launch-blocking.

### Suwappu trader (crypto-native beachhead — primary ICP)

- **P0** — As a Suwappu trader, I want to open Gekko with the same Telegram identity I already use, so that I don't create a new account or memorize a seed phrase.
  - AC: tapping a Gekko deeplink from the bot lands signed-in with zero additional credential entry; session persists across app restarts.
  - This is now the *only* thing standing between a Suwappu trader and a funded balance — see correction in §1: bot and app share the same `Wallet` row, so a valid session already implies a funded account. There is no separate funding P0 for this persona.
- **P1** — As a Suwappu trader, I want to see my idle balance would earn X% APY the moment I land on Today, so that depositing into Earn is an obvious next action, not something I have to discover.
  - AC: empty Today state shows a live APY figure and a single CTA, not just static copy.
- **P1** — As a Suwappu trader, I want to send USDC to another wallet or ENS name in as few steps as the trading bot itself, so that Gekko doesn't feel like a downgrade from what I already use.
  - AC: send completes in ≤4 taps for a known/pasted address.
- **P2** — As a Suwappu trader, I want a first-run checklist (connect → fund → earn) so I know exactly what's left before I'm "done" setting up.

### Crypto-curious consumer

- **P0** — As a crypto-curious consumer, I want a guided signup that doesn't require me to understand seed phrases, so that I don't abandon before I even see the product.
  - AC: embedded-wallet flow (OAuth-style per `11-onboarding.md`); no raw seed phrase shown or required at signup.
- **P1** — As a crypto-curious consumer, I want a card-based on-ramp to fund my first deposit, so that I don't need to already own crypto to start.
  - AC: on-ramp widget reachable from the same net-new funding menu (4b) as receive/QR, clearly labeled with fees before confirming.
- **P1** — As a crypto-curious consumer, I want plain-language explanations of what "yield" and "non-custodial" mean at the point of decision, so that I trust the product enough to fund it.
- **P2** — As a crypto-curious consumer, I want a small first-deposit incentive, so that funding doesn't feel like all-downside-no-upside on day one.

### SMB owner

- **P0** — As an SMB owner, I want a business-account path that doesn't force me through the same consumer KYC flow, so that I'm not blocked by a form that doesn't fit my entity.
  - AC: entity type selectable at signup; SMB/DAO path routes to manual/white-glove review per `11-onboarding.md`, with a visible "under review" status rather than a stuck spinner.
- **P1** — As an SMB owner, I want to see all contributor payments in one place, so that I can treat Gekko as my treasury view, not just a wallet.
- **P2** — As an SMB owner, I want to invite a co-signer/teammate to the account, so that I'm not the sole point of failure for treasury access.

### UHNW individual

- **P1** — As a UHNW user, I want a concierge-assisted onboarding path (not fully self-serve), so that a large first funding event doesn't happen through an untested generic flow.
  - AC: recognizable "request white-glove setup" entry point; does not block on the same automated KYC tier as consumer.
- **P2** — As a UHNW user, I want visibility into custody/security posture before funding meaningfully, so that I can satisfy my own diligence bar.
- **P2** — As a UHNW user, I want a direct line to support rather than a generic ticket queue.

### Returning / dormant user

- **P0** — As a returning user who signed up but never funded, I want to be reminded of exactly what I left unfinished, so that I don't have to re-discover the funding step from scratch.
  - AC: re-opening the app after a funded-but-idle gap surfaces the specific next step (fund, or deposit into Earn), not a generic home screen.
- **P1** — As a dormant user with a funded-but-idle balance, I want a push/bot nudge showing the yield I'm missing, so that inactivity has a visible cost that pulls me back.
- **P2** — As a returning user, I want session restore to just work without re-authenticating, so that coming back doesn't cost me the same friction as day one.

## 3. As-Is Flows

Tap counts and screen counts are the audited ground truth, not estimates.

### Onboarding / entrance

1. User opens the app (from App Store, Telegram deeplink, or cold) → **dead end**. `SignedOutState` renders and stops. *Friction: this is not a funnel step, it's a wall — there is no next tap.* (`screen-state.tsx:27-39`)

There is no step 2. Auth is not implemented for any persona, including the Suwappu trader whom `11-onboarding.md` explicitly designs a one-tap flow for.

### Funding (Receive) — net-new users only

This flow applies to a user with **no existing Suwappu wallet**. For an existing Suwappu bot user this flow does not exist at all: their bot wallet balance is already the app's balance the moment they authenticate (§1 correction) — there is nothing to receive into.

1. Navigate to Receive tab. *Friction: none, if signed in.*
2. Screen renders address + "Copy address" button; QR is a placeholder note, not an image. 2 taps total to copy an address. *Friction: no QR means a mobile-to-mobile transfer requires manually retyping or messaging a 42-char address — meaningfully worse than a scan.*
3. **Dead end**: user must now leave the app entirely (exchange or another wallet) to actually acquire and send USDC on Base, then return and hope the transfer lands. *Friction: no card on-ramp, no confirmation once funds arrive — the app is passive here.* (`receive.tsx:45-65`)

### Earn deposit

1. Open Earn tab.
2. Tap "Deposit."
3. Type amount (empty input, no suggested value).
4. Confirm amount screen.
5. Tap confirm / sign.
Total: 5 taps across 4 screens. *Friction: empty-state copy ("Idle USDC earns 0%... $0 Available to deposit") is honest but passive — it names the problem without offering a pre-filled solution.* (`earn.tsx:301-376`)

### Send

1. Open Send.
2. Enter recipient (address or ENS).
3. Wait ~500ms ENS debounce resolution.
4. Type amount.
5. Confirm screen.
6. Tap confirm / sign.
Total: 5 taps + a 500ms wait, across 4 screens. *Friction: the debounce wait is invisible latency, not a tap, but it sits directly in the critical path with no progress indicator called out in the audit.* (`send.tsx:71-243`)

### Statement

1. Open Activity/Statement.
2. Tap to view detail.
Total: 2 taps, 2 screens. Empty state: "Nothing here yet." *Friction: passive but low-stakes — acceptable as-is for a P2 flow.*

### Create goal

1. Open goal creation.
2. Type two fields (name, target amount).
3. Tap create.
Total: 3 taps + 2 typed fields. *Friction: acceptable; not a launch blocker.*

## 4. To-Be Flows

Target tap counts assume auth and funding are built — these are redesigns, not incremental tweaks to the current dead ends.

### (a) First-run: Telegram deeplink → wallet ready → funded

Target: **2 taps** for an existing Suwappu trader from tapping the bot link to a funded, usable balance. (Revised down from an earlier 3-tap target that assumed a transfer step — see §1 correction: there is no transfer, so there is nothing to confirm or pre-fill an amount for.)

1. User taps "Open in Gekko" from the Suwappu Telegram bot (deeplink carries a signed session token — reuses the bot's existing Telegram auth rather than inventing a new credential). JWTs are minted by `create_jwt_token(address, user_id, src)` (`api/main.py:935-958`), HS256, 7-day expiry, with `user_id`/`userId`/`address`/`src` claims — `src="telegram"` records that this session proved possession via the bot, not a new credential.
2. App opens already signed in, wallet visible, **balance already shown as funded** — because `_jwt_user` (`api/routes/mobile.py:187-203`) resolves the JWT's `user_id` to the same `users.id` row the bot uses, and both surfaces call `wallet_service.get_user_wallets(user_id)` (`api/routes/mobile.py:2209,2221`; `bot/handlers/start.py:130`) against the same `Wallet` rows (`bot/models/user.py:115`, FK to `users.id`). **0 taps so far.**
3. Tap 1: land on Today, see the real balance and APY.
4. Tap 2: "Start earning" (see 4c). Funded and earning.
Total: 2 taps, both spent on the actual product action, none spent moving money that was never separate to begin with.

Justification: `11-onboarding.md`'s own default is "reuse existing Suwappu wallet/session... zero new-wallet friction" — the code now shows that default is *structurally guaranteed*, not just a UX goal to hit. The KYC-driven 40-60% drop-off commonly cited in fintech funnels (moderate confidence, blog-aggregated) is largely irrelevant here because this path defers KYC entirely, consistent with the "permissionless line" in `11-onboarding.md` — non-custodial actions never touch KYC.

Net-new (non-Suwappu) users get a separate, longer path: embedded-wallet OAuth signup (no seed phrase) → funding menu (4b), which is the correct scope for that menu — see below. Seed-phrase walls are documented at 60-90% drop-off (moderate-high confidence, multiple converging sources) — the embedded-wallet approach exists specifically to avoid that step, matching the `11-onboarding.md` "Banana Pro reached 1.3M via embedded wallet" precedent.

### (b) Funding menu — scoped to net-new ($0) users only

Rescope from an earlier draft: this menu is **not** for existing Suwappu bot users — they have no funding step at all (§1 correction). It exists purely for a user who arrives at Gekko with $0 and no prior Suwappu wallet (crypto-curious consumer, and any Suwappu trader's referral who isn't yet a bot user). Replace the current address-only Receive screen with a menu, ordered by expected conversion for that net-new population:

| Option | Default? | Why this order |
|---|---|---|
| Receive address + working QR | **Yes, default (ships now)** | The only option deliverable without a new vendor integration; QR closes the current mobile-to-mobile gap (`receive.tsx:45-65`) and covers a net-new user who already holds crypto elsewhere (exchange, another wallet). |
| Card on-ramp (MoonPay/Transak) | Secondary, later phase | Primary path for a truly $0 crypto-curious-consumer with no crypto anywhere yet — but ships after receive/QR since it requires a KYC'd vendor integration `11-onboarding.md` gates behind actual need. |

The funding-method A/B (§7) is still the top experiment for this doc, but its population is net-new users choosing between receive/QR and card on-ramp — **not** the Suwappu beachhead, which never sees this menu.

### (c) One-tap "Start earning" from empty Today

Current: static copy naming a 0% vs X% gap, then a $0 input the user must fill blind.
To-be: same copy, but the CTA reads "Start earning $[suggested amount]" where the amount defaults to the user's actual available balance (or a sensible fraction of it), tap once to confirm, one more to sign. Target: **2 taps** vs current 5. Justification: this collapses steps 2-4 of the as-is Earn deposit flow (open Earn → tap deposit → type amount) into a single pre-filled suggestion surfaced directly on Today — the same "reduce typed input, pre-fill from known state" logic, and for a Suwappu-beachhead user this is now taps 3-4 of the whole first-run flow per 4a (already-funded balance, no separate sweep step).

### (d) Send

Target: **3 taps** for a saved/recent recipient (down from 5), unchanged at ~4-5 for a fresh address since recipient entry and ENS resolution are not compressible. Add a recents list so repeat sends (the common case for a trader paying the same counterparties) skip recipient entry entirely.

### (e) First-run checklist

A persistent, dismissible 3-item checklist on Today for the first session: Connect ✓ → Fund ✓/○ → Start earning ✓/○. For a Suwappu-beachhead user, Fund shows pre-checked the instant Connect completes (§1 correction — no separate funding action exists for them); for a net-new user Fund stays ○ until they complete 4b. Justification: gamified/progressive onboarding elements are cited (Shine 80% conversion, Extraco 2%→14%) as producing large lifts, but these are vendor-sourced case studies, not independently verified — treat the checklist as a cheap, low-risk addition to test, not a guaranteed win. It doubles as the visible instrumentation surface for funnel stage 3 (§5).

## 5. Funnel Definition

No stage below has a measured baseline — the app currently emits zero events (§1). Targets are pulled from `11-onboarding.md`/`12-activation.md` and reconciled here; "current" is honestly blank.

**Suwappu beachhead: auth is now the make-or-break stage.** Per the §1 correction, "Wallet ready" and "Funded" are effectively pre-satisfied for this population the instant auth succeeds — same `users.id`, same `Wallet` rows, no separate provisioning or deposit event to wait on. Whatever fraction of Suwappu-referred opens complete auth *is* whatever fraction end up funded; those two numbers should converge to nearly identical in the data once instrumented. The net-new funnel below is materially different — for that population Wallet ready and Funded remain real, separate stages, since there's no pre-existing account to fall back on.

| Stage | Definition | Target | Source | Current |
|---|---|---|---|---|
| Install | App opened for the first time | — (top of funnel, not a conversion target) | — | not measured |
| Auth | Signed in (Telegram deeplink or embedded wallet) | 80%+ of Suwappu-referred opens (near-zero friction path); 40-50%+ net-new | `11-onboarding.md` Account Creation | not measured — feature doesn't exist |
| Wallet ready (net-new) / pre-satisfied at auth (Suwappu) | Non-custodial wallet provisioned and usable | Instant, <1 min from auth (net-new); ~0 additional time for Suwappu — same row, no provisioning step | `11-onboarding.md` Account Approval | not measured |
| Funded (net-new) / pre-satisfied at auth (Suwappu) | First deposit lands (any method) — for Suwappu users this is not a distinct event, since the balance was already theirs pre-auth | 60%+ of approved Suwappu-origin accounts should now track ~auth-completion rate, not a separate 60% target; net-new keeps the 60%+/<24h target from `11-onboarding.md` since receive/QR + on-ramp are real steps for them | `11-onboarding.md` First Deposit | not measured — Suwappu path needs no funding path; net-new funding path (4b) still to build |
| First earn deposit | First Aave/yield deposit | 50%+ idle-to-yield conversion among funded users | `08-icp-positioning.md` Consumer target | not measured |
| First send | First outbound transfer | tracked, no hard target set yet — flag for a future doc pass | — | not measured |
| D7 return | Opens app again within 7 days of funding | reconcile against Adjust 2026 fintech D7 baseline of 17.6% (industry-wide, not crypto-native or Suwappu-referred — expect this cohort to outperform given pre-existing trust) | `16-retention.md` (verify against that doc's own targets) | not measured |
| D30 return | Opens app again within 30 days | reconcile against Adjust 2026 D30 baseline of 11.6%, same caveat | `16-retention.md` | not measured |

Note: D1/D7/D30 industry baselines (Adjust 2026: D1 30%, D7 17.6%, D30 11.6%) are the strongest external source found but describe generic fintech apps, not a Telegram-native, pre-warmed crypto user base — treat as a floor to beat, not a target to match.

## 6. Instrumentation Spec

Recommended tool: **PostHog**. Reasoning for a React Native/Expo app: native Expo/RN SDK with session replay and feature-flag support in one library (reduces the number of SDKs to wire into a codebase that currently has zero), self-hostable if Gekko's compliance posture ever requires data residency control, and its event/funnel UI directly matches the funnel table in §5 without custom dashboard work. Amplitude has stronger enterprise-grade funnel analysis but costs more at this stage and adds a second vendor relationship; Segment is a routing layer, not an analytics destination — worth adding later only if Gekko ends up fanning events out to a warehouse *and* a product-analytics tool simultaneously, not before.

**Privacy line: never log wallet addresses, exact amounts, or transaction hashes as identifiable event properties.** Use bucketed ranges (e.g. `amount_bucket: "0-10"|"10-100"|"100-1k"|"1k+"`) and truncated/hashed identifiers where an address must be referenced at all (e.g. `recipient_hash`, not `recipient_address`).

| Event | Fires when | Key properties | Funnel stage |
|---|---|---|---|
| `app_opened` | Cold or warm app open | `entry_source` (deeplink/push/cold/notif), `is_first_open` | Install |
| `screen_viewed` | Any screen mount | `screen_name`, `signed_in` | all (navigation baseline) |
| `auth_started` | User taps sign-in/connect CTA | `method` (telegram_deeplink/embedded_wallet), `referral_source` | Auth |
| `auth_completed` | Session established | `method`, `duration_ms` | Auth |
| `auth_failed` | Auth flow errors out | `method`, `error_code` | Auth |
| `wallet_ready` | Non-custodial wallet provisioned | `wallet_type` (evm), `duration_since_auth_ms` | Wallet ready |
| `funding_menu_viewed` | Funding menu screen shown | `entry_point` (checklist/today/receive_tab) | Funded (pre) |
| `funding_method_selected` | User taps a funding option | `method` (bot_wallet_pull/address_qr/card_onramp) | Funded (pre) — **A/B attribution key, see §7** |
| `funding_completed` | Funds confirmed landed | `method`, `amount_bucket`, `duration_ms` | Funded |
| `funding_failed` | Funding attempt errors, times out, or is left pending | `method`, `error_code` (`429`\|`503`\|`timeout`\|`pending_stuck`\|other), `duration_ms` | Funded (failure) |
| `earn_cta_viewed` | Empty/active Today Earn CTA shown | `suggested_amount_bucket`, `apy_shown` | First earn deposit (pre) |
| `earn_deposit_started` | User taps Start Earning / Deposit | `amount_bucket`, `source` (suggested/manual) | First earn deposit |
| `earn_deposit_completed` | Deposit confirmed on-chain | `amount_bucket`, `duration_ms` | First earn deposit |
| `earn_deposit_failed` | Deposit errors | `error_code`, `amount_bucket` | First earn deposit (failure) |
| `send_started` | User taps Send, enters flow | `recipient_type` (address/ens/recent) | First send |
| `send_recipient_resolved` | ENS resolution completes | `resolution_ms`, `success` (bool) | First send |
| `send_completed` | Transfer confirmed | `amount_bucket`, `recipient_type`, `duration_ms` | First send |
| `send_failed` | Transfer errors | `error_code`, `recipient_type` | First send (failure) |
| `checklist_item_completed` | A first-run checklist item ticks off | `item` (connect/fund/earn) | Activation composite |
| `retention_session` | Any app open beyond day 0 | `days_since_funded` | D7/D30 |

Every `*_failed` event must capture `error_code` as a bucketed enum (`429`, `503`, `timeout`, `pending_stuck`, `user_cancelled`, `insufficient_balance`, `other`) — not raw error strings, which risk leaking addresses/amounts embedded in RPC error messages.

## 7. Open Questions / What to Test First

**Top experiment: funding-method attribution A/B (§4b), net-new users only.** Rescoped from an earlier version of this doc that ran this A/B against the Suwappu beachhead — that population has no funding step to A/B (§1 correction), so the experiment's real subject is a net-new, $0 user choosing between receive/QR and (later) card on-ramp. Which method converts better for that population is asserted, not measured; no public data compares them. Once `funding_method_selected` and `funding_completed` are live (§6), run the available funding options in the menu simultaneously (not sequentially — order effects would confound a sequential test) and measure `funding_completed` rate and `duration_ms` per `method`. This determines the correct default/ordering in 4b for net-new users — it says nothing about the Suwappu beachhead's funnel, whose make-or-break stage is auth, not funding (§5).

Other open questions, unordered:
- What's the actual net-new (non-Suwappu-referred) embedded-wallet signup completion rate once built? `11-onboarding.md` targets 40-50% but flags it as unverified.
- Does the ENS 500ms debounce in Send cause measurable abandonment, or is it invisible at that latency? Needs `send_recipient_resolved` data before deciding whether to optimize it.
- SMB/UHNW manual-review paths (§2) have no digital instrumentation plan yet — those flows are intentionally high-touch/human, but the handoff point (self-serve → manual queue) should still emit an event so drop-off there is visible.
- Should `checklist_item_completed` gate a push/bot nudge for users stuck on step 2 (funded but not earning)? Depends on early funnel data, not designable yet.
