# NEAR HACKATHON 2026 — Suwappu Arbiter ("Proof of Done")

**Escrow for human and agent work where release-or-refund is decided by a hash-pinned arbiter running on
NEAR OutLayer — not by either party. The enclave fetches the pull request from GitHub itself and checks it
against immutable terms. Verified live on NEAR testnet. Not audited; not on mainnet.**

Live page: https://www.suwappu.bot/arbiter · machine-readable evidence: https://www.suwappu.bot/arbiter.json ·
production design and open items: [`docs/arbiter-production.md`](../arbiter-production.md)

## The failure mode

Every agent marketplace holds money in escrow but can't answer "was the work actually done?" Delivery is a
screenshot and vibes. Arbiter closes the loop: the buyer locks funds against a machine-checkable rubric, and a
pinned program decides — the contract moves funds only on its `pass`.

## How NEAR fits (what is actually shipped)

- **NEAR contract** (`near/arbiter-contract`, near-sdk 5): `create_escrow` / `resolve` / `cancel_expired` /
  `reset_stuck`. The arbiter hash, URL, build target and rubric are compile-time constants — callers cannot
  choose their own verdict source. No admin keys, no upgrade path.
- **OutLayer** (`near/arbiter-github`, `wasm32-wasip2`): the arbiter. It fetches
  `api.github.com/repos/{repo}/pulls/{n}` and checks merged / author / repo / `merged_at <= deadline` /
  merger ≠ author. No shared secret, no worker-supplied evidence. OutLayer refuses a binary whose sha256 differs
  from the pinned hash.
- **Not shipped (do not read as claims):** NEAR Intents funding, Agent Market integration, mainnet, in-contract
  TDX quote verification.

## Do X → see Y (no funds, no keys)

```sh
# 1. The live page: replay the two real outcomes
open https://www.suwappu.bot/arbiter

# 2. Read the contract's pinned arbiter (hash, url, rubric)
near view arb2.suwappu-arbiter.testnet arbiter '{}' --networkId testnet

# 3. The binary hash must match the pinned one
curl -sL https://raw.githubusercontent.com/0xSoftBoi/suwappubot/main/near/arbiter-github/artifacts/arbiter-github.wasm | sha256sum

# 4. Read the pass settlement: the arbiter_attestation log line
near tx Ez3bwp3ZLrFVxeak53WaBgasqXFbf8jeyEBZDPv3vq3b arb2.suwappu-arbiter.testnet --networkId testnet

# 5. The evidence the enclave saw is public — check it yourself (PR #993, author nanofaxcopy, merged by another account)
curl -s https://api.github.com/repos/0xSoftBoi/suwappubot/pulls/993 | sha256sum
```

Step 5's hash matches the attestation's `evidence_hash` only if GitHub returns byte-identical JSON, which it
will not forever (fields like `updated_at`, `comments` change). The authoritative evidence hash is the one the
enclave computed at execution time; compare the *fields* (`merged`, `user.login`, `merged_by.login`, `merged_at`).

## Live testnet evidence (contract `arb2.suwappu-arbiter.testnet`)

| Case | Step | Tx |
|---|---|---|
| Pass — PR #993, merged by another account | create (0.1 NEAR) | `DtNk28WFznwZVXXQrLReeD8hC3czaAti1Wzm2vXF5img` |
| | resolve → `pass`, worker paid | `Ez3bwp3ZLrFVxeak53WaBgasqXFbf8jeyEBZDPv3vq3b` |
| Fail — PR #1096, authored and merged by the same account | create (0.05 NEAR) | `D7Wgn7AUCTDsyDcmJ19gXEtXh7XrGwum7cZvqHbWXe3H` |
| | resolve → `fail self_merged`, no transfer | `G1oidSEPmAKVBQVP1FSHzpLEi4Bi7KcJ6LT5tNv7jDLr` |

Arbiter sha256 `f1818167768f6b2b84b2031071760395d3e4a88cf319de3539d0d2068ad6412b`. Thirteen attack probes were
rejected on-chain (low-gas resolve leaves the escrow `Created`, duplicate PR, re-resolve, early/non-buyer
refund, dust deposit, bad resolve fee, demo context, oversize deadline, …). Panic messages are not surfaced by
this build, so rejections show as `unreachable` traps — each is a rejected condition, not a verified reason.

## What's in the diff (baseline 99161598 → main; Arbiter PRs #1096, #1098, #1099)

- `near/arbiter-github/` — production arbiter (rubric `github_pr_v1`) + committed wasm artifact
- `near/arbiter-contract/` — escrow contract v2.1
- `near/arbiter-wasm/` — the earlier webhook-evidence arbiter (demo rubric), kept for its recorded fixtures
- `showcase/src/app/arbiter/` + `/arbiter.json` — the public product page
- `api-ts/src/hackathon/near2026/`, `webapp/src/pages/Arbiter.tsx` — flag-gated (off by default) earlier demo surfaces
- `docs/arbiter-attestation-v1.md` (open attestation spec), `docs/arbiter-production.md`, `ARBITER.md` (roadmap)

## Threat model — what Arbiter does not prove

- **Not rubric fairness** — the buyer chooses the repo and terms; the contract pins them at creation. A worker should
  only accept escrows for repos they can verify and with a long deadline.
- **Not GitHub's honesty** — the enclave trusts its TLS fetch of the GitHub API; the response is not independently
  attested. Unauthenticated rate limits (60 req/h per IP) can produce a non-pass; the buyer then refunds only after
  `deadline + 1h`.
- **Not on-chain quote verification** — the trust anchor is the OutLayer contract's behaviour; third parties verify
  executions off-chain with OutLayer's tooling.
- **Done, not good** — it proves a PR merged as specified, never that it was excellent.
- **Not audited** by a third party. Two internal adversarial reviews were done and their findings fixed and re-verified.

## Baseline disclosure

The env-gated route pattern comes from Suwappu's earlier hackathon slice (`api-ts/src/hackathon/`). The Arbiter work
(contracts, arbiter, page, docs) was written inside the hackathon window; no production swap/payment paths were
changed.

## License

Apache-2.0 (repo LICENSE). Test PRs used as evidence are this repository's own public pull requests.
