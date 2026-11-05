# Arbiter — submission drafts (HUMAN REVIEWS; nothing here is sent automatically)

Deadline: 2026-11-14T23:59:00Z. Tracks: `realworld`, `agents`, `open`.

## Pitch (≈900 chars, limit 2000)

Agent marketplaces have a hole: money sits in escrow, but "was the work actually done?" is decided by
screenshots and vibes. Suwappu Arbiter is a NEAR milestone escrow where release-or-refund is decided by a
hash-pinned arbiter WASM (built for OutLayer / Intel TDX), not by either party. The arbiter HMAC-verifies
GitHub webhook evidence and checks merged / author / deadline deterministically, with zero network I/O.
Pass pays the worker; fail refunds the buyer; uncertainty refuses and moves nothing. Every verdict emits a
signed work attestation (rubric hash, arbiter code hash, evidence hash, payout) — an open, portable
credential any market can verify without our infrastructure (docs/arbiter-attestation-v1.md). Demo: three
recorded scenarios (pass / wrong author / unmerged) replay the real arbiter-wasm output byte for byte.
Honest limits: v1 proves "done", not "good"; only deterministic rubrics; the Intents funding leg and Agent
Market worker leg are roadmap, not shipped. Repo: github.com/0xSoftBoi/suwappubot (branch hackathon/arbiter).

## X post (human posts)

Agent marketplaces escrow the money but can't answer "was the work actually done?"

We built Arbiter for #NEARHackathon: a NEAR escrow where a hash-pinned WASM (OutLayer/TDX) verifies signed
GitHub evidence, pays on pass, refunds on fail, and mints a portable work attestation anyone can verify.

Try the 3-scenario replay: https://www.suwappu.bot/arbiter
Code: https://github.com/0xSoftBoi/suwappubot/tree/hackathon/arbiter

What rubric would you want an agent to prove first? @NEARProtocol

## Form fields the human must supply
name · lead · email · team size · NEAR payout account · repo + post URLs · consent-to-contact notice.
Payload is built and printed in full for confirmation before any POST to nearhackathon.com/api/applications.

## Not done (needs the human — see plan guardrails)
- Fresh NEAR testnet accounts / faucet + contract deploy → "live evidence" tx hashes (README currently has none; do not claim any).
- OutLayer `deploy` of the arbiter WASM and end-to-end yield/resume call from the contract.
- ≤90s screen recording on the live page; X post; flag-on deploy of www.suwappu.bot/arbiter.
- `gitleaks` pass, repo-public check, MONEY-PATH review before any merge to `main`.
