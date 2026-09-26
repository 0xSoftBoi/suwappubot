---
name: ethglobal-goal
description: "Standing goal: build the ETHGlobal Tokyo 2026 'Agent Swap Passport' hackathon entry (docs/plans/ethglobal-tokyo2026-agent-passport.md) — World ID/AgentKit + Intercepta + ENSv2 — until every phase is implemented, verified against real sandbox/testnet endpoints, and demoed end to end. Usage: /ethglobal-goal [phase|item]"
---

# /ethglobal-goal — Ship the Agent Swap Passport hackathon entry

Standing goal: **every phase of `docs/plans/ethglobal-tokyo2026-agent-passport.md` implemented and
live-verified against real sandbox/testnet endpoints** — not just code that parses. This targets
three ETHGlobal Tokyo 2026 sponsor tracks (World IDKit+AgentKit, Intercepta, ENSv2) by extending
Suwappu's existing agent link/claim flow (`api-ts/src/routes/agent.ts`), not building identity
from scratch.

## How to use
- `/ethglobal-goal` — pick the next unchecked item in phase order, re-verify its file:line anchor
  against current code (things drift), implement it, run the phase's live verification (not just
  `bun run check` — an external API call actually succeeding), check it off.
- `/ethglobal-goal <phase|item>` — jump to a specific phase (e.g. `/ethglobal-goal 1` or `/ethglobal-goal 2.2`).
- **"Done" for this goal means: tested live against the real World/Intercepta/ENS
  sandbox+testnet endpoints, not mocked.** A unit test with a stubbed HTTP client does not close an
  item — only a real round-trip response (or a documented, unresolvable external blocker) does.
- If an item is blocked on credentials/access this session doesn't have, mark it
  **BLOCKED ON USER** with the exact secret/access needed, and move to the next unblocked item
  instead of spinning. Never fabricate a credential, contract address, or API response to make an
  item look done — that produces a demo that fails live in front of judges, which is worse than an
  honest blocked item.
- Goal is DONE when every box is checked or explicitly accepted as blocked-and-reported to the
  user; then archive this skill (delete the directory in a final commit noting completion/handoff).

## Phase 0 — Credentials & unresolved API mechanics (must clear before Phase 1-3 can go live)
**BLOCKED ON USER — needs secrets/access this session does not have:**
- [ ] 0.1 BLOCKED (needs World Developer Portal access) — Create a World App ID + action ID at
      developer.world.org for IDKit; obtain sandbox verification credentials for AgentKit.
- [ ] 0.2 BLOCKED (needs a byte-level source read) — Read `./x402/DOCS.md` in
      `github.com/worldcoin/agentkit` (or `Must-be-Ash/world-x402-agentkit-example` source
      directly) to confirm the exact `agentkit` header payload schema. Prior research only
      confirmed the header name and round-trip shape.
- [ ] 0.3 BLOCKED (needs Intercepta sandbox key) — Obtain an Intercepta/Web3Antivirus `X-API-KEY`
      and the event's demo clean/risky addresses (reportedly distributed via event Discord/booth,
      not self-serve).
- [ ] 0.4 BLOCKED (needs a funded Sepolia wallet + ENSv2 registrar access) — Register/acquire an
      ENSv2 parent name on Sepolia (e.g. a `suwappu.eth`-style test namespace) for subname
      issuance, and confirm the actual ENSv2 subname-creation call from
      `docs.ens.domains/ensv2/registry` + `/ensv2/permissions` directly (NOT the ENSv1
      `NameWrapper.setSubnodeOwner` pattern — confirmed wrong API for v2).
- [ ] 0.5 Confirm current `agents.ownerUserId` / `POST /v1/agent/link/code` flow still matches
      `api-ts/src/routes/agent.ts:4173-4236` before extending it (re-verify line anchors — this
      plan is a point-in-time read).

## Phase 1 — World: strengthen the existing link flow (both $5k bounties)
Files: `api-ts/src/routes/agent.ts`, new `api-ts/src/lib/worldId.ts`, new
`api-ts/src/middleware/worldIdAuth.ts`
- [ ] 1.1 `lib/worldId.ts`: client for `POST https://developer.world.org/api/v4/verify/{app_id}`
      (IDKit proof verification). **Live-verify**: a real proof from the World App simulator/sandbox
      round-trips to a 200. This alone satisfies the IDKit bounty (server-side verify).
- [ ] 1.2 Extend `POST /v1/agent/link/code` (agent.ts:4176) to optionally accept a World ID proof;
      verify via 1.1 before minting the code; store proof hash/nullifier/timestamp in
      `agents.metadata`.
- [ ] 1.3 Add `agentkit`-header verification (per the schema confirmed in 0.2) as a gate ahead of
      `meteredPayment` in `middleware/x402Payment.ts` — protected action = a real metered
      swap/agent call.
- [ ] 1.4 Denied/expired/cancelled path: mirror the existing `already_linked` 409 pattern
      (agent.ts:4188) for `world_id_verification_failed`, audited via `writeAuditLog` like the
      existing `agent.link_code_rejected` event.
- [ ] 1.5 **Live end-to-end test**: mint a link code with a valid World ID proof (succeeds), then
      with an invalid/expired one (rejected, audited) — both against the real sandbox endpoint.

## Phase 2 — Intercepta: screen before charging ($2k bounty)
Files: new `api-ts/src/lib/intercepta.ts`, `api-ts/src/middleware/x402Payment.ts`
- [ ] 2.1 `lib/intercepta.ts`: client for the quick-scan endpoint, `X-API-KEY` auth. **Live-verify**:
      real call against the event's demo clean address returns a low `toxicScore`.
- [ ] 2.2 Wire into `meteredPayment` before `consumePayment`/`verifyX402Payment` finalizes a
      charge; reject with `traits[]` reasoning above threshold.
- [ ] 2.3 Persist last scan result to `agents.metadata` (compounding risk history, not a one-shot
      check).
- [ ] 2.4 **Live end-to-end test**: one call against the demo clean address (approved, charge
      proceeds) and one against the demo risky address (blocked, reasoning shown) — the bounty's
      exact required demo shape.

## Phase 3 — ENS: durable identity anchor ($6k bounty)
Files: new `api-ts/src/lib/ensSubname.ts`, extend `agents.metadata`
- [ ] 3.1 Mint an ENSv2 subname under the Phase-0.4 parent name once an agent is claimed AND World
      ID-verified. **Live-verify**: subname resolves on Sepolia via a public ENS resolver/explorer.
- [ ] 3.2 Store subname in `agents.metadata.ensName`; surface `ens_name` in the existing
      agent-status response alongside `owner_linked` (agent.ts:565).
- [ ] 3.3 **Live end-to-end demo**: resolve `<agent>.suwappu.eth` (or chosen namespace) and show it
      returns the World ID-verified owner claim + current Intercepta risk state — the composed
      "one identity, three sponsors" story.

## Phase 4 — Submission packaging
- [ ] 4.1 One README with a per-track section pointing judges at exact files/lines (each sponsor
      judges independently).
- [ ] 4.2 Intercepta feedback (3-5 lines on their API) in the README per bounty requirement —
      re-check exact wording at submission time.
- [ ] 4.3 Confirm git history is normal commits (not squashed/single-commit) — several bounties
      (1inch, Uniswap) required this; carry the same hygiene even though those tracks are out of
      scope, since ETHGlobal judges may check general repo quality.
- [ ] 4.4 Final live run-through of the full flow (claim → World ID verify → ENS mint → metered
      call gated by Intercepta) on a clean environment, recorded/screenshotted as submission
      evidence.

## Rules
- **Never fake a live result.** If a sandbox/testnet call can't actually be made this session
  (missing key, no network egress, etc.), the item stays unchecked and BLOCKED — do not write code
  that only "looks" verified from a mocked response and report it as tested live.
- Anything touching real metered payments, agent auth, or the claim flow is **MONEY-PATH** →
  `money-path-reviewer` before it lands anywhere outside a hackathon-only branch.
- `bun run check` incrementally for TS; this is necessary but NOT sufficient — live verification
  per phase is the actual completion bar for this goal.
- Route work per CLAUDE.md conductor table: `api-ts-dev` for all of Phases 1-3 (all api-ts/), main
  loop handles Phase 4 packaging + synthesis directly.
- Re-verify every file:line anchor before editing — this backlog is a point-in-time snapshot from
  2026-09-26.
