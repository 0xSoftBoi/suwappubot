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

## Review findings fixed (second adversarial review, all re-verified live)

- **Escrow lock (critical):** `resolve` now requires >= 290 Tgas prepaid, the callback gets 40 Tgas, and anyone can
  `reset_stuck` an escrow stuck in `Resolving` after 300 blocks. A low-gas resolve is rejected and leaves the escrow `Created`.
- **PR squatting:** the one-escrow-per-PR index is now per buyer; deadlines are capped at 365 days (also removes the u64 wrap).
- **Storage paid by others:** the buyer pays measured storage on top of the escrow amount; the worker receives exactly
  `amount`; refunds return `amount + storage`.
- **Self-merge:** the arbiter requires `merged_by != author`; optional `not_before_unix` rejects PRs merged before the escrow.

## Live testnet evidence (v2.1, contract `arb2.suwappu-arbiter.testnet`, 2026-11-06)

Arbiter sha256 `f1818167…412b`, pinned at a commit-specific raw URL. The enclave fetched the real PRs from GitHub.

| Case | Result | Tx |
|---|---|---|
| Pass — PR #993, author `nanofaxcopy`, merged by another account | create (0.1 NEAR) | `DtNk28WFznwZVXXQrLReeD8hC3czaAti1Wzm2vXF5img` |
| | resolve → `pass`; worker received 0.1 NEAR minus the storage deposit | `Ez3bwp3ZLrFVxeak53WaBgasqXFbf8jeyEBZDPv3vq3b` |
| Fail — PR #1096 authored and merged by the same account | create (0.05 NEAR) | `D7Wgn7AUCTDsyDcmJ19gXEtXh7XrGwum7cZvqHbWXe3H` |
| | resolve → `fail self_merged`, no transfer, escrow stays open | `G1oidSEPmAKVBQVP1FSHzpLEi4Bi7KcJ6LT5tNv7jDLr` |

13 attack probes rejected on-chain: low-gas resolve (escrow stays `Created`), deadline > 365 days, duplicate PR (open and
paid, same buyer), re-resolve paid, early refund, non-buyer refund, reset_stuck while not stuck, dust deposit, 1-yocto
and oversized resolve fee, demo context. A different account escrowing the same open PR succeeded (no squatting).
Rejections surface as `unreachable` traps (this build does not surface panic messages), so each rejection is a
rejected condition, not a verified reason. Superseded earlier builds: `arb.suwappu-arbiter.testnet`.

## Trust model (what v2 does and does not prove)

- Proves: the pinned arbiter binary (OutLayer refuses a file whose sha256 differs) ran on these terms and
  returned this verdict; funds move only on `pass`; evidence is bound to the escrow id.
- Does **not** prove: that GitHub's API response is authentic (trusted by the enclave over TLS, not
  independently attested); that OutLayer's operator is honest or live (the trust anchor is the OutLayer
  contract's behaviour — it can refuse to run, which the buyer-refund path covers); that the work is *good*.
- The buyer chooses `repo` and can merge, then make the repo private/renamed (GitHub 404) and refund after
  deadline + 1h; GitHub's unauthenticated 60 req/h per IP limit can also cause 403s on OutLayer's shared IPs. A worker
  should only accept escrows for repos they can verify and with a long deadline.
- Third parties verify an execution off-chain with OutLayer's `outlayer-verify` (job/tx/call) and the TDX
  quote's task hash; the escrow contract does not verify quotes on-chain.

## Before mainnet (open — do not skip)

1. Independent third-party audit (two internal adversarial reviews done; findings fixed and re-verified on testnet).
2. Confirm with OutLayer: failure-refund behaviour (their docs disagree), yield timeout, GitHub HTTP
   allowlist/attestation, audit/maturity status, and `outlayer.near` args parity with testnet.
3. Replace the testnet resolver constant with `outlayer.near` and re-pin the arbiter URL to a release
   commit; reproducible build so the hash maps to source.
4. Decide the GitHub rate-limit story (unauthenticated API from a shared worker IP) — a persistent 403 means
   no pass, only refund after deadline.
5. Mainnet accounts/funding, a timelocked governance or a documented immutability stance, and a caps policy
   (per-escrow and total) for the first deployment.
6. Mainnet deploy and every mainnet transaction require explicit human approval.

## Contract v3 (`near/arbiter-contract-v3`) — review status (2026-11-05)

Adds the `http_json_v1` rubric via a compile-time rubric table. Not deployed. One Opus money-path review found no way
for a stranger to take funds. Fixes were applied and checked in a scratch harness (12 checks, including a negative
control: disabling the guard makes the double-callback check fail):

- **Fixed:** a late callback after `reset_stuck` could pay twice or reopen a paid escrow (a v2 bug, still present in
  `arb2`). The callback now carries a per-resolve nonce and is ignored unless the escrow is `Resolving` with that nonce.
  `on_payout` only acts on a `Paid` escrow. A callback for a removed escrow no longer panics.
- **Fixed:** a buyer-supplied `escrow_id` in HTTP terms is rejected; `arbiter()` keeps the v2 top-level shape; the
  storage reserve is raised to cover resolve-time fields.
- **Open (design):** a predicate already true at creation resolves immediately (the reviewer suggests an "armed" flag;
  not built, needs a product decision). Anyone can re-resolve, so a briefly-true state pays out.
- **Open (outside the contract):** hostnames like `127.0.0.1.sslip.io` pass host validation. Whether OutLayer's
  `wasi:http` host filters private IPs, pins DNS or follows redirects is undocumented. Do not announce `http_json_v1`
  before asking OutLayer.
- **Open (verify on testnet):** whether OutLayer accepts a ~2 KB `input_data`.
- **Reproducible (one machine):** artifact `2acc016a…` rebuilds bit-for-bit from a clean `git archive` of commit
  `1f85a7ee` in a different directory with `cargo build --release --locked --target wasm32-wasip2`
  (rustc 1.96.0 ac68faa20, x86_64-unknown-linux-gnu). Not yet tried on a second machine or a pinned container image.
