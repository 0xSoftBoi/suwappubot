# Arbiter — submission drafts (HUMAN REVIEWS; nothing here is sent automatically)

Deadline: 2026-11-14T23:59:00Z. Tracks: `realworld`, `agents`, `open`.
Reproduce in one command from a clean clone: `bash scripts/demo-arbiter.sh` (no keys, no funds).

## Pitch (≈1,500 chars, limit 2000 — re-count after any edit)

Agent marketplaces hold money in escrow but can't answer "was the work actually done?" Suwappu Arbiter is a NEAR
escrow where release-or-refund is decided by a hash-pinned arbiter running on OutLayer, not by either party. The
enclave fetches the pull request from the GitHub API itself and checks merged / author / repo / deadline /
merger-is-not-the-author against immutable terms — no shared secret and no caller-supplied evidence, so neither
buyer nor worker can forge a verdict. Pass pays the worker; anything else (fail, GitHub error, malformed output)
moves nothing and the buyer can refund only after the deadline. Every verdict logs an on-chain attestation
(escrow id, evidence hash, arbiter code hash) described by an open spec. Live on NEAR testnet: a real pass and a
real fail, plus 13 attack probes rejected on-chain; two adversarial reviews found real bugs (escrow lock via low
gas, PR squatting, storage drain) which were fixed and re-verified. A third review found a late-callback
double-pay hazard that the first contract still has (it is immutable); it is fixed in contract v3, deployed separately
on testnet with a second rubric (HTTP JSON predicates; one live pass and fail), but that fix is only tested locally.
Honest limits:
testnet only, no third-party audit, no on-chain TDX quote verification, GitHub's response is trusted by the
enclave, and it proves "done as specified", not "good". Mainnet, Intents funding and Agent Market are roadmap.
Repo: github.com/0xSoftBoi/suwappubot · Live: www.suwappu.bot/arbiter

## X post (human posts)

Agent marketplaces escrow the money but can't answer "was the work actually done?"

Built Arbiter for #NEARHackathon: a NEAR escrow where a hash-pinned OutLayer arbiter fetches the GitHub PR itself and
decides pay or refund — no shared secret, no evidence either party can forge. Live on testnet, with the attack
probes and the bugs we found in our own contract documented.

Verify it yourself, no keys: bash scripts/demo-arbiter.sh
https://www.suwappu.bot/arbiter
@NEARProtocol

What would you want an agent to prove before it gets paid?

## Form fields the human must supply
name · lead · email · team size · NEAR payout account · repo + post URLs · consent-to-contact notice.
The payload is built and printed in full for confirmation before any POST to nearhackathon.com/api/applications.

## Not done (needs the human — see plan guardrails)
- ≤90s screen recording on the live page; X post; submission.
- Mainnet is out of scope for the hackathon entry: any mainnet deploy or transaction needs explicit human approval.
- Open before any real funds: third-party audit, OutLayer confirmations, GitHub rate-limit plan (see `docs/arbiter-production.md`).

## Contract v3 / `http_json_v1`: status and claim rules (read before editing the post, video or live page)
- **State:** deployed on NEAR **testnet** as `suwappu-arb3.testnet` (2026-11-05). Live: `github_pr_v1` pass; `http_json_v1`
  fail then pass on an untouched account; a maximum-size input accepted by OutLayer. Transactions are in
  `docs/arbiter-production.md`. Reviewed once (Opus money-path pass).
- **Claimable:** the three live results above, with the transaction hashes. That v3 pins both rubrics and carries
  `rubric=`, `buyer=`, `amount_yocto=` in its attestation logs.
- **Do not claim:** that the late-callback guard is verified on-chain (local mock harness only; `reset_stuck`,
  `cancel_expired` and payout failure were never exercised on `arb3`); that `arb2` is fixed (it is immutable); that
  `http_json_v1` is safe against hostile endpoints or SSRF (OutLayer's redirect/DNS/private-IP behavior is unverified);
  or that it works when the caller's own balance is the observed value (three live runs failed unexpectedly, cause
  unknown; see the caveat in `docs/arbiter-production.md`). Escrows #0, #1 and #5 are the evidence of that anomaly: do
  not describe them as passing.
- **Not yet reflected:** the `/arbiter` page and `arbiter.json` still describe v2.1 only. Updating them is separate work.
- **Still needs the human:** the OutLayer questions (redirect, DNS, private IPs); the armed-flag design call (a condition
  already true at creation resolves immediately); refunding the four open escrows after `deadline + 1h`.
- **If time runs out:** ship the entry as it was; v3 is documented as testnet-only and costs nothing to leave in the repo.
