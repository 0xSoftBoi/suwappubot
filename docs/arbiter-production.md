# Suwappu Arbiter — production design (v2) and mainnet readiness

Status: **v2 verified live on NEAR testnet. Not deployed to mainnet. Do not hold real funds until the
"Before mainnet" list is closed.** This supersedes the demo rubric (`github_pr_demo`, public HMAC secret).

## Design

- `near/arbiter-github` (rubric `github_pr_v1`, `wasm32-wasip2`): the OutLayer enclave fetches
  `https://api.github.com/repos/{repo}/pulls/{n}` itself and checks `merged`, `user.login == author`,
  `base.repo.full_name == repo`, `number`, `merged_at <= deadline`. **No shared secret, no worker-supplied
  evidence** — neither party can forge a verdict. `evidence_hash` = sha256 of the GitHub response body.
- `near/arbiter-contract` (v2): `create_escrow(worker, terms)` / `resolve(id)` / `cancel_expired(id)`.
  - The arbiter hash/url/target/rubric are compile-time constants; callers cannot choose their verdict source.
  - Non-pass (fail, GitHub error/rate limit, malformed output) never ends an escrow; it stays open.
  - Refund only after `deadline + 1h`, or immediately if the worker payout failed.
  - One escrow per (repo, PR); a PR that paid once can never pay another escrow.
  - The callback accepts output only if it echoes this escrow's `id` and the pinned `rubric`.
  - `resolve` is open to anyone; the OutLayer fee refund goes to the caller (`payer_account_id`).
  - Min deposit 0.01 NEAR, capped field lengths, bounded resolve fee (0.005–0.02 NEAR), recoverable payout failure.
  - No admin keys, no upgrade path.

## Live testnet evidence (v2, contract `arb.suwappu-arbiter.testnet`, 2026-11-06)

Arbiter sha256 `17ea8765…9167`. The enclave fetched the real PRs from GitHub.

| Case | Result | Tx |
|---|---|---|
| Pass — PR #1096, author `0xSoftBoi` | create (0.1 NEAR) | `EAPH4YqSi4hWWpP9xqyLsNk4uotu62Wv5pmwS4E7SceQ` |
| | resolve → `pass`, worker +0.1 NEAR, fee refund to caller | `3HWAUwqqK7NRse4BruM6ygYwdD1NzJHrpPFDicYrVueY` |
| Fail — PR #1097, wrong author | create (0.05 NEAR) | `HNh21XDMKY3v3caD3t4skX32bqz9xTv3WAeEfy2kUUfe` |
| | resolve → `fail author_mismatch`, no transfer, escrow stays open | `4KkAaHLSkvgfYiQ49QpZxjbYUg1BTJDVNfue8ZSJANYf` |

11 attack probes rejected on-chain (duplicate PR open/paid, re-resolve paid, early/non-buyer refund,
demo context, past deadline, path-traversal repo, dust deposit, 1-yocto and oversized resolve fee).
Rejections surface as `unreachable` traps (panic messages are not surfaced by this build).

## Trust model (what v2 does and does not prove)

- Proves: the pinned arbiter binary (OutLayer refuses a file whose sha256 differs) ran on these terms and
  returned this verdict; funds move only on `pass`; evidence is bound to the escrow id.
- Does **not** prove: that GitHub's API response is authentic (trusted by the enclave over TLS, not
  independently attested); that OutLayer's operator is honest or live (the trust anchor is the OutLayer
  contract's behaviour — it can refuse to run, which the buyer-refund path covers); that the work is *good*.
- The buyer chooses `repo`. A worker must only accept escrows whose repo they do not control.
- Third parties verify an execution off-chain with OutLayer's `outlayer-verify` (job/tx/call) and the TDX
  quote's task hash; the escrow contract does not verify quotes on-chain.

## Before mainnet (open — do not skip)

1. Independent contract audit; resolve the review findings (see PR notes).
2. Confirm with OutLayer: failure-refund behaviour (their docs disagree), yield timeout, GitHub HTTP
   allowlist/attestation, audit/maturity status, and `outlayer.near` args parity with testnet.
3. Replace the testnet resolver constant with `outlayer.near` and re-pin the arbiter URL to a release
   commit; reproducible build so the hash maps to source.
4. Decide the GitHub rate-limit story (unauthenticated API from a shared worker IP) — a persistent 403 means
   no pass, only refund after deadline.
5. Mainnet accounts/funding, a timelocked governance or a documented immutability stance, and a caps policy
   (per-escrow and total) for the first deployment.
6. Mainnet deploy and every mainnet transaction require explicit human approval.
