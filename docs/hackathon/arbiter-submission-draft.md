# Arbiter — submission drafts (HUMAN REVIEWS; nothing here is sent automatically)

Deadline: 2026-11-14T23:59:00Z. Tracks: `realworld`, `agents`, `open`.
Reproduce in one command from a clean clone: `bash scripts/demo-arbiter.sh` (no keys, no funds).

## Pitch (≈1,100 chars, limit 2000)

Agent marketplaces hold money in escrow but can't answer "was the work actually done?" Suwappu Arbiter is a NEAR
escrow where release-or-refund is decided by a hash-pinned arbiter running on OutLayer, not by either party. The
enclave fetches the pull request from the GitHub API itself and checks merged / author / repo / deadline /
merger-is-not-the-author against immutable terms — no shared secret and no caller-supplied evidence, so neither
buyer nor worker can forge a verdict. Pass pays the worker; anything else (fail, GitHub error, malformed output)
moves nothing and the buyer can refund only after the deadline. Every verdict logs an on-chain attestation
(escrow id, evidence hash, arbiter code hash) described by an open spec. Live on NEAR testnet: a real pass and a
real fail, plus 13 attack probes rejected on-chain; two adversarial reviews found real bugs (escrow lock via low
gas, PR squatting, storage drain) which were fixed and re-verified. Honest limits: testnet only, no third-party
audit, the contract does not verify TDX quotes on-chain, GitHub's response is trusted by the enclave, and it proves
"done as specified", not "good". Mainnet, Intents funding and Agent Market are roadmap, not shipped.
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
