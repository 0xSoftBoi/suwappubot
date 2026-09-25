# World ID Debrief — Suwappu Trust Layer (ETHGlobal Tokyo 2026)

_Required submission doc for the World "Best Use of World ID for Agents" prize.
Fill the bracketed sections with real numbers from the venue build._

## What we built

Suwappu is a cross-chain DEX / execution API for AI agents. For Tokyo 2026 we
added a **guardian gate**: before an agent trade executes, a unique verified
human approves that exact trade intent with World ID.

- `src/world-id/rpSignature.ts` — backend-only RP request signing
  (v4 `rp_context`, snake_case mapping).
- `src/world-id/guardianGate.ts` — server-driven idkit-core flow:
  `startTradeVerification` returns a `connectorURI` rendered as a QR; the
  backend polls, then verifies the proof server-side against
  `POST /v4/verify/{rp_id}`.
- `src/world-id/stepUp.ts` — a fresh World ID verification satisfies Suwappu's
  existing step-up approval path (`validateWorldIdStepUp`, mirroring the TOTP
  challenge validator in `api-ts/src/lib/stepUpChallenge.ts`).
- `src/world-id/agentkit.ts` — World ID for Agents on both sides of x402:
  agent-side `createAgentClient` (delegation proof on outbound payments),
  seller-side `verifyAgentKitHeader` (parse → signature verify → message
  validate → AgentBook `lookupHuman`) and `createSellerHooks`.

Security properties we enforced:

- **Intent binding**: `signal = sha256(agentId|chain|from|to|amount|nonce)`.
  A proof for trade A cannot authorize trade B (`hashIntent`, tested).
- **Byte-identical forwarding**: the proof JSON is sent to the verifier
  unmodified — never re-encoded or trimmed.
- **Replay resistance**: `(action, nullifier)` consumed with a uniqueness
  constraint (NUMERIC(78,0) in Postgres; `MemoryNullifierStore` in the demo).
- **Fail closed**: decline / expiry / cancellation / signal mismatch all return
  `ok:false` with a reason — never an exception that a caller could swallow
  into an approval.

## Time to first success

[ ] e.g. "~50 minutes from portal project creation to a green verification in
staging simulator, of which ~20 was finding the rp_context signing shape."

## Friction encountered

[ ] e.g. "The snake_case rp_context fields vs camelCase signRequest output was
undocumented; we mapped it in rpSignature.ts."
[ ] e.g. "IDKitRequest single-use per requestId — polling must reuse the
original object, which the docs don't emphasize."

## Missing capability / docs

[ ] e.g. "No documented way to bind `signal` to structured intent — we hashed
it ourselves; a first-class `intent` field would help agent use cases."
[ ] e.g. "AgentKit CLI requested a v3-legacy proof while newer World IDs are
v4-only; we registered with an older World ID."

## Highest-impact improvement for agent builders

[ ] e.g. "A hosted 'approve this intent' page (QR + intent summary + verify
callback) so agents don't each rebuild the guardian-gate UX."

## Repro

```bash
cd hackathon/tokyo2026
cp .env.example .env   # set WORLD_APP_ID, WORLD_RP_ID, RP_SIGNING_KEY
bun install && bun test tests/ && bun x tsc --noEmit
```

Demo flow: [`src/demo/runbook.md`](src/demo/runbook.md).
