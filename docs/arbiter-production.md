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

Adds the `http_json_v1` rubric via a compile-time rubric table. **Deployed to NEAR testnet 2026-11-05 as
`suwappu-arb3.testnet`** (see "Live testnet evidence" below). One Opus money-path review found no way
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
- **Closed (tested on testnet):** OutLayer accepted the largest `http_json_v1` terms the field caps allow (1,694 bytes,
  every field at its cap) and returned a verdict (escrow #4 below). Larger inputs are not possible: the per-field caps
  sit below the 2,048-byte terms limit.
- **Reproducible (one machine):** artifact `2acc016a…` rebuilds bit-for-bit from a clean `git archive` of commit
  `1f85a7ee` in a different directory with `cargo build --release --locked --target wasm32-wasip2`
  (rustc 1.96.0 ac68faa20, x86_64-unknown-linux-gnu). Not yet tried on a second machine or a pinned container image.

## Live testnet evidence — `suwappu-arb3.testnet` (contract v3), 2026-11-05

NEAR **testnet only**. Nothing here is audited and nothing is on mainnet.

- **Account:** `suwappu-arb3.testnet`, a new top-level account created through the testnet faucet (tx
  `4Zmi2AfbPYvh3JiRPPvQmXP2opV58RfsUjcgztgojaUT`, funded 10 NEAR). The planned subaccount
  `arb3.suwappu-arbiter.testnet` was not possible: the parent holds 2.95 NEAR but ~1.44 NEAR of that is locked as storage
  for its own contract, leaving ~1.5 spendable (the CLI refused the 1.85 NEAR transfer before broadcasting).
- **Code:** sha256 `667f4c62a77bdb59442d74daf75d2bb6c093c8bb1fcf893e4bba6562cff9ba8a` (169,565 bytes), built from source
  at commit `ec52c3d6` with plain `cargo build --release --target wasm32-unknown-unknown` (not `cargo near`; build
  reproducibility of the contract is NOT verified). The on-chain account's code checksum equals this hash.
- **Pinned arbiters** (from the `arbiter` view): `github_pr_v1` `f1818167…412b`, `http_json_v1` `2acc016a…60a7`.
- **Transport:** every escrow below was resolved by the real OutLayer testnet enclave (`outlayer.testnet`). The
  `arbiter_attestation` log lines carry `rubric=`, `buyer=` and `amount_yocto=`.

| Escrow | Rubric / terms | Result | Txs |
|---|---|---|---|
| #3 | `github_pr_v1`, PR #993 (same PR as the `arb2` pass) | **pass**, `Paid` | create `HnNZvHf61sEYLEMLVeCN6BuenJidhX8bQS7f2nCY4Ugd`, resolve `E3TmuRYaLP8iYvhuTKdjFZs8uFDry9vpH1DnGbdXid7g` |
| #2 | `http_json_v1`: RPC `view_account` of `arb.suwappu-arbiter.testnet` (an idle account nothing else touches), `/result/amount >= 3.1 NEAR`; balance 3.049 NEAR | **fail**, then after a 0.1 NEAR transfer to that account **pass**, `Paid` (`resolve_nonce` 2) | create `35ZeM5TadpYnXht9ixYwZ2qD9pJJrj5RTA9J2fo1QERs`, resolve (fail) `91Nhb6bEnoytMzrQGm59tzLj76f1q28JYXUxyhHVRt7r`, transfer `BLgtpL8fSgJjSkow1ggfPuLGh4sXzuo3NsSta1MdKZpi`; the pass resolve tx hash was not captured (find it in the account history) |
| #4 | `http_json_v1`, every field at its cap (URL 300, body 512, 4 checks; terms 1,694 B) | enclave ran and returned `fail http_status_400` (the padded request, not an OutLayer rejection) | create `FWv8nUQoMz9TbLigDQgvpXo5wnvCzTMdoqp4kswcBgYh`, resolve `ASfp9kYvNgsZRznMbcrDth9BB1MSHrmSKGXmWxYuPAG9` |
| #0, #1, #5 | `http_json_v1` observing the **worker account that calls `resolve`** | see caveat | #0 create `2X7qPCzi15915VLjpLsappKXxr55ahDwN5ZihS9n3zF7`, resolves `CoaqcF4iFaKxkgedX49RtGScw369S2DMv8pQ5nW82oHc` / `4AKsjZoU6NrnsLBJ5Vq3MpWHBXL146yVKbwfhZUUAN9j` / `5ysybF2HFQq1AckHWazeNdz7XTLfG1qGYCkRPdZZUvKn`; #1 create `8JtxvAKH2khLL4TbPbPUizcmPstp4eeMhx1bJ4JpQGBG`, resolve `EvPhBAGy4CUnCj2uL4pbVk5PNrrNQWDck9toFn58QA2V`; #5 create `GyxguNVm3jAtsid1x9UeoQ1gJQQbzpTAQKrVGz5SmmcR`, resolve `437b1hxni7Qprk4PmcUMG6Z33yQ77EWjnxoFHDQSFTSh` |

**Unexplained caveat (observed, cause not established).** Escrows #0, #1 and #5 watched the balance of the same account
that paid for `resolve`. The first #0 fail was correct (0.84 < 1 NEAR). After the account was funded to 1.14 NEAR, two
more resolves still failed `check_failed_0`. A diagnostic with ordered checks (#1) showed the enclave received a valid
JSON-RPC response containing the account, with only the threshold check failing. A threshold ladder (#5) showed it saw
a balance at least 0.2 NEAR below the settled value, although the same wasm run locally against the same RPC passes.
The attached deposit plus prepaid gas should lock only ~0.05 NEAR, so that does not fully explain it. Whatever the
cause, **do not watch the caller's own balance**; the untouched-account test (#2) behaves correctly. Left unresolved.

**Not tested on-chain:** `reset_stuck` and the stale-callback guard (covered only by the local mock harness),
`cancel_expired`, payout failure, or any adversarial probe against `arb3`. The deployment tx hash was not captured.

**Funds still held by `arb3`:** escrows #0, #1, #4 and #5 are open (`Created`). The buyer
(`suwappu-arbiter.testnet`) can refund them with `cancel_expired` once `deadline + 1h` has passed (about 4 hours after
creation).
