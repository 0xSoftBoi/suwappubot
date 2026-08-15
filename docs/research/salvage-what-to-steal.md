# Salvage: what's worth taking from the Pump.fun hackathon cohort

Twelve projects researched, primary sources read. Most of it is noise — token charts, self-reported user counts, "AI agent economy" positioning. This file is only the part worth acting on, mapped against what Suwappu already has.

Full research: `pumpfun-build-in-public-winners.md` and `primary-docs/`.

---

## What we already have (so we don't re-import it)

| Capability | Status | Anchor |
|---|---|---|
| x402 pay-per-call metering | **Shipped** — prepaid credits, 1 credit = $0.001, per-endpoint cost weights, atomic deduction, 402 challenge with on-chain settlement fallback | `api-ts/src/middleware/x402Payment.ts:31-107`, `chargeAgentForCall()` at `:228` |
| Scoped agent API keys | **Shipped** — `sk_live_*`, DB-backed scopes, `expiresAt`, `revokedAt`, per-key `rateLimitPerMin` | `api-ts/src/middleware/apiKeyAuth.ts:22-163` |
| Tiered swap fees | **Shipped** — FREE 1% / PRO 0.5% / PREMIUM 0.3% / ENTERPRISE 0.1%, 30% referral reward, 2bps floor | `bot/services/fee_service.py:26-40` |
| Key custody | **Server-side signing**, KMS + AES-GCM envelope encryption | `bot/services/wallet.py`, `bot/utils/envelope_crypto.py` |
| Agent memory | **None** — stateless, `AgentService` is CRUD only | `api-ts/src/services/AgentService.ts:38-80` |

Notably we are **ahead of most of the cohort on x402** — we have shipped metering with cost weights; ClawPump lists x402 as "UP NEXT," and Dexter's is the only comparable implementation.

---

## Worth stealing

### 1. Per-key spending caps (from Dexter's "tabs") — the biggest gap

**Their design:** one passkey gesture opens a "tab" with a hard ceiling; the agent spends beneath it with no per-call signature; settle on close. Cap enforcement lives **on-chain, not in SDK logic** — "the bill stops dead the moment it reaches the cap."

**Our gap:** we have per-agent credit balance and per-key *rate* limits, but **no per-key spend limit** (`apiKeyAuth.ts:22-163`). A compromised or buggy key can drain the whole agent balance at the rate cap. Rate limiting bounds calls per minute; it does not bound dollars.

**Take:** add `spendLimitCredits` + `spentCredits` to the API key record, checked in `chargeAgentForCall()`. Cheap — one migration, one guard. The passkey/on-chain part is theirs to own; the ceiling-per-credential concept is what transfers.

### 2. Terms locked at creation (from AgenC)

**Their design:** fee splits — protocol/operator/referrer/worker — are fixed **when the task is created**, with per-leg and combined basis-point caps and a floor for the party doing the work. Not re-read at execution.

**Our gap:** fees are computed at runtime from the user's *current* tier (`fee_service.py:26-40`). For a same-block swap that's fine. It stops being fine the moment referral rewards or partner splits are owed across a delay — a tier change or config edit between quote and settlement silently changes what a referrer is owed.

**Take:** snapshot the fee terms onto the order/quote record at creation and settle against the snapshot. This matters most for limit orders and referral accrual, which are exactly the paths where time passes.

### 3. Settlement stays open during pause (from AgenC)

**Their design:** "Settlement paths — submit, accept, reject, cancel — always stay open" even during a protocol pause, "enforced at the code level."

**Why it's good:** most emergency pauses trap user funds — the kill switch that stops the attacker also strands everyone mid-flight. Separating *stop accepting new business* from *stop settling existing obligations* is the correct decomposition and is rarer than it should be.

**Take:** whatever kill switches exist across `fee_sweeper`, `order_service`, and withdrawal paths should be audited against this invariant — a pause must never strand an in-flight settlement. This is a `money-path-reviewer` question, not a quick edit.

### 4. Fail-closed by default (from AgenC)

> "The program refuses to publish unmoderated specs — enforced in code, not policy text."

The phrasing is the lesson: **in code, not policy text.** Worth applying to token-security gates on the swap path — if a security check errors out, does the swap proceed?

### 5. Verification as a committed artifact (from Dexter)

**Their design:** `dexter-mainnet-proofs` — SHA-256 receipts tied to specific commits and runs, committed to the repo, with an explicit disclaimer: "evidence of the named runs, not a security audit, a warranty, or a claim that every historical interface remains current."

**Why it's good:** this repo's own rules already demand end-to-end proof over "CI green" and forbid claiming a feature is live without a real transaction. Dexter turns that discipline into a durable artifact instead of a claim in a chat log. A `proofs/` directory holding real testnet/mainnet tx hashes per shipped money-path feature would make "verified" checkable months later.

### 6. Document what is *not* built (from Clude)

Their README explicitly lists LangGraph, CrewAI, temporal fact validity, and enterprise platforms as unimplemented. It is the single reason their docs are more trustworthy than their marketing — and it cost them nothing.

### 7. Bounded sponsorship (from ClawPump)

"First 3 sponsored per user" for gasless launches — the platform fronts the fee for the first N actions only. A hard-capped acquisition subsidy rather than an open faucet. A clean model if we ever sponsor first-swap gas.

### 8. Pay the distributor (from Pumpcade)

Their 1% fee splits protocol 0.45% / creator 0.10% / **streamer 0.45%** — the distributor earns as much as the protocol. Our referral reward is 30% of fee (`fee_service.py`). Their structure is a reminder that distribution can rationally be the most expensive leg.

### 9. Memory decay by type (from Clude) — only if we build agent memory

Differential decay rates per memory class: episodic 7%/day, semantic 2%/day, procedural 3%/day, self-model 1%/day. We have no memory layer at all (`AgentService.ts:38-80`), so this is a design note for if that changes — not a gap today.

---

## The anti-patterns, turned back on us

### SPA catch-all — real, but low severity here

BloxAPI's `/docs` and `/developers` serve the homepage at 200. We do the same thing, in two layers:

- `webapp/vercel.json:6-11` — blanket rewrite `/(.*)` → `/index.html`
- `webapp/src/App.tsx:451` — `<Route path="*" element={<Navigate to="/" replace />} />`

A mistyped path returns 200, then silently bounces to home. **But the Vercel rewrite is required** for a Vite SPA — removing it breaks every deep link, so that layer is correct as-is.

The honest severity read: this is a **Telegram Mini App**, where users cannot type URLs — deep links arrive from the bot. Silently redirecting an unknown path to home may well be deliberate and right for that surface. The real cost is diagnostic, not user-facing: a broken bot-generated deep link fails *invisibly* rather than loudly, so a bad link ships unnoticed.

**Recommendation, not applied:** swap the client catch-all at `App.tsx:451` for a `NotFound` element that renders a visible "unknown screen" state and logs the attempted path. Keeps deep linking intact, makes broken links detectable. Left as a decision because the current behavior may be intentional.

`showcase/` is clean — explicit anchor redirects only, real 404s elsewhere.

### Ship-your-own-API-spec check

Pumpcade — the winner that raised $6M from Jump Crypto and Foundation Capital — still serves the generic Swagger sample at `/api-reference/openapi.json`: `title: "OpenAPI Plant Store"`, endpoints `/plants`, `/plants/{id}`. Worth a one-minute grep that no equivalent placeholder sits in our published agent-card or OpenAPI output.

### Single-source every published number

AgenC publishes its instruction count as 96, 98, 99, and 101 across four of its own surfaces. ClawPump says 132 / 126 / 78 tools on different pages. Clude's retrieval score is 67.7, 83.9, 81.3, or 86 depending on channel. Every one of these is a metric rendered by hand in more than one place. Any stat that appears on the showcase, in docs, and in the agent card should come from one source.

### Don't name a thing more than it is

- Zauth calls endpoint-**control** proof "verification" — deploying the SDK proves you own the endpoint, nothing about whether it is safe.
- Dexter cites an "IETF draft" that is an unreviewed individual submission, self-authored, expiring Dec 2026, with "no formal standing in the standards process."

Both are real work described in terms that imply external validation that does not exist. The cost is that a reader who checks stops trusting the rest of the page.

---

## Bottom line

Three things are worth doing, in order:

1. **Per-key spend caps** — a real security gap, small fix, `apiKeyAuth.ts` + `chargeAgentForCall()`.
2. **Snapshot fee terms at order creation** — matters for referral accrual and limit orders, where time passes between quote and settlement.
3. **Audit pause paths against the settlement invariant** — money-path review, not a quick edit.

Everything else is a practice to adopt (proof artifacts, documenting what isn't built, single-sourcing metrics) rather than code to write. Nothing in the cohort's product positioning is worth copying.
