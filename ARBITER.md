# Suwappu Arbiter — Proof of Done

**Agents that can't prove delivery don't get paid. Now they can — visibly.**

Suwappu Arbiter is the trust layer for the agent labor economy: machine-verified delivery,
attested settlement, portable reputation. The NEAR HACKATHON 2026 build is the launch wedge;
this document is the line we're building on top of it.

## The problem

Every agent platform ships the same three halves: agents can *find* work (Agent Market),
*hold* money (agent wallets / x402), and *spend* it (Intents, pay-per-call). Nobody ships the
fourth: **delivery**. Buyers can't pay for "looks done", sellers can't prove done — so the
agent economy is stuck at low-stakes gigs and screenshots.

## What exists today (Tier 0, this repo)

- A NEAR escrow contract: funds locked against a machine-checkable rubric, no admin keys,
  rubric immutable at creation.
- An arbiter WASM (`near/arbiter-github`) running on OutLayer (Intel TDX): fetches the pull request
  from the GitHub API inside the enclave and checks it against the terms. No shared secret and no
  caller-supplied evidence, so neither party can forge a verdict.
- Settlement releases only on the enclave's signed verdict; every verdict is anchored on-chain
  (`arbiter_attestation` log) and reproducible via `docs/arbiter-attestation-v1.md`.
- `www.suwappu.bot/arbiter` — the dry-run demo (no funds needed) + live testnet path.

## The line

### Tier 1 — Arbitration API (Dec 2026)
`POST /v1/arbiter/attest` — pay per verification with x402 (Suwappu's existing metered-payments
rail). Any agent, any stack, any marketplace submits `{terms, evidence}` and gets an attested
verdict + signed attestation back. Micro-priced; no accounts, no subscription — agents pay for
judgment the way they pay for compute.

### Tier 2 — Reputation registry (Dec–Jan 2027)
On-chain attestation index → "Agent Résumé": verified jobs served, pass rate, rubrics served,
last-N attested deliveries. Portable: any client verifies with the spec + one RPC endpoint.
Suwappu moat = distribution and index quality, not secrecy.

### Tier 3 — Outcome-priced services (Jan–Feb 2027)
Plug Arbiter gates into existing Suwappu primitives: verified copy-trading revenue-share
(attest performance windows), verified DCA/alert delivery, agent marketplace v2 with
attestation-filtered hiring; bps on attested settlements. Closes the flywheel:
reputation → hiring → settlement → attestations → reputation.

### Tier 4 — Enterprise provenance (Q1 2027)

Signed logs of agent actions + arbitration outcomes for insurance/SOC2/regulated buyers —
the "agents proved what they did" package for institutions. Separate surface; nothing in Tier 0
claims it.

## Business model

| Tier | Charge |
|---|---|
| 0 (hackathon) | $0 — wedge |
| 1 | per-verification x402 micro-fee |
| 2 | résumé/query subscription (small) |
| 3 | bps on settled milestones / marketplace GMV |
| 4 | enterprise contracts (provenance exports) |

Marginal infra ≈ 0: existing webapp/terminal deploys, x402 middleware, one NEAR contract.

## Why Suwappu

- Distribution: webapp + terminal + Telegram/WhatsApp reach — buyers and agents already here.
- Payments rails built and production-proven; Arbiter rides them on day one.
- Human↔agent identity binding (World ID claim flow) — attestation subjects anchor to real humans.
- The NEAR HACKATHON 2026 launch ran with the founders of this exact thesis on the jury
  (Illia: Agent Market escrow paid on verified completion; Eddy/a16z: KYA — signed principal,
  permissions, constraints, reputation).

## Honesty ledger

- v1 arbitrates deterministic machine-checkable rubrics only. LLM-judged rubrics: v0.2 roadmap,
  fixed model/seed/weights in the enclave, explicitly not shipped.
- Attestation proves code ran on bytes in the enclave — not rubric quality, not GitHub's honesty
  beyond the enclave's TLS fetch of the GitHub API.
- Everything in this document beyond Tier 0 is a plan, not a shipped claim.
