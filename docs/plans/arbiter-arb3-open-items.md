# Plan: close the open arb3 items (written 2026-11-06 03:50 UTC)

Context: contract v3 is live on NEAR **testnet** as `suwappu-arb3.testnet` (evidence: `docs/arbiter-production.md`).
Hackathon deadline: 2026-11-14 23:59 UTC (about 8 days). Testnet only throughout; any mainnet step needs explicit human approval.

## Where each item stands

| # | Item | Status now | Work left | Cost | Needs |
|---|---|---|---|---|---|
| 1 | Caller-balance anomaly | **Explained** (below) | docs done; one confirming test; design guidance | ~0.4 NEAR, 1 h | nothing |
| 2 | Missing tx hashes (deploy, escrow #2 pass) | Open | read-only recovery script | free, 30 min | nothing |
| 3 | Refund the 4 open escrows | Waiting on clock | `cancel_expired` x4 + negative checks | ~0.01 NEAR | time (07:24-07:30 UTC) |
| 4 | On-chain tests (probes, `cancel_expired`, `reset_stuck`, stale-callback) | Never run on arb3 | 3 tiers, see below | ~0.5 NEAR, 1-2 d | stub variant for tier C |
| 5 | OutLayer redirect / DNS / private-IP behavior | Unknown | ask first; benign redirect probe only | ~0.1 NEAR | OutLayer's answer, human sends it |
| 6 | `/arbiter` page + `arbiter.json` show v3 | Not started (interrupted) | after 1-2 so claims are exact | 0.5 d | human decides on deploy |

## 1. Caller-balance anomaly: explained, finish it properly

**What was found (read-only forensics, recorded in `docs/arbiter-production.md`).** The `evidence_hash` is the sha256 of
the raw RPC body. Re-fetching the worker account at candidate blocks matched all five on-chain hashes: the enclave read
resolve+3..+7 blocks (fresh state, not stale) and saw the caller 0.3151 NEAR below its settled balance each time. Block
timeline: -0.3209 at inclusion, +0.313 in system refunds ~12 blocks later. Receipts show `gas_price` 1e9 (10x the 1e8 the
`gas_price` RPC reports), so 300 Tgas of prepaid gas holds 0.30 NEAR plus the 0.02 deposit. Nothing is broken.

**What is still open**
- **1a. Confirm the model (prediction test).** The lock should be `prepaid_gas * 1e9 + deposit`. Resolve one escrow with
  290 Tgas (the contract minimum) and a 0.005 NEAR deposit and read the drop with `timeline.py`-style per-block queries.
  Expected drop: 0.29 + 0.005 = 0.295. If it differs, the model is wrong and the doc must say so.
- **1b. Why 10x?** Read `EXPERIMENTAL_protocol_config` and the receipt `gas_price` rules (pessimistic pricing). Outcome is
  a sentence in the docs: either "testnet charges receipts at 10x min" or the actual rule. Also check whether mainnet
  differs, because it changes the size of the swing there (do not transact on mainnet to find out; read config only).
- **1c. Design guidance (decision for the human).** The swing is also an attack surface: for an `lte_int` check on an
  account, that account's owner can make the state true by calling `resolve` (about 0.3 NEAR swing, no transfer).
  Options, cheapest first: (i) docs + page warning: "never use balance predicates on accounts a party controls";
  (ii) a terms lint in `terms.rs` that rejects `lte_int` on `/result/amount` (changes the pinned artifact: new hash, new
  push, contract constant update, redeploy); (iii) restrict `resolve` to buyer or worker (does not remove the problem and
  costs liveness). Recommendation: (i) now, (ii) only if a balance-based use case matters.

## 2. Recover the two missing hashes (read-only)

NEAR's `EXPERIMENTAL_changes` returns, for each account change, the `cause` with the `tx_hash` or `receipt_hash`.
- Deploy tx: `changes_type: contract_code_changes` for `suwappu-arb3.testnet`, scanning blocks from the faucet account
  creation (tx `4Zmi2AfbPYvh3JiRPPvQmXP2opV58RfsUjcgztgojaUT`) to the first `create_escrow`.
- Escrow #2 pass tx: `account_changes` for `worker.suwappu-arbiter.testnet` between the transfer
  `BLgtpL8fSgJjSkow1ggfPuLGh4sXzuo3NsSta1MdKZpi` and escrow #3's create; the `transaction_processing` cause carries the hash.
Done when: both hashes are in `docs/arbiter-production.md`, each verified with `EXPERIMENTAL_tx_status` showing the right
method and signer. If a block range is pruned, say so and leave them missing; never reconstruct a hash.

## 3. Refund the open escrows (clock-gated)

Buyer `suwappu-arbiter.testnet` can call `cancel_expired` only after `deadline_unix + 3600`:

| Escrow | Held | Refundable after (UTC) |
|---|---|---|
| #0 | 0.1000 | 2026-11-06 07:24 |
| #4 | 0.0600 | 2026-11-06 07:24 |
| #1 | 0.0500 | 2026-11-06 07:26 |
| #5 | 0.0500 | 2026-11-06 07:30 |

#2 and #3 are `Paid` and must NOT be refundable. This step doubles as the first on-chain test of `cancel_expired`:
before the time, `cancel_expired(0)` from the buyer must be rejected (early refund); from a non-buyer must be rejected;
`cancel_expired(2)` must be rejected (paid). After the time, the buyer's balance should rise by `amount + storage_deposit`.
A reminder or `/loop` can run the post-07:30 step.

## 4. On-chain tests, in three tiers (do tier A before the page update)

- **Tier A: rejection probes (~25 calls, ~0.1 NEAR, 1 h, scriptable).** Port the 13 arb2 probes and add the v3 ones:
  low-gas `resolve` (escrow must stay `Created`), dust deposit, bad resolve fee, oversize deadline, past deadline,
  duplicate PR (same buyer), re-resolve a `Paid` escrow, unknown `context`, `http://`, IP-literal host, port 8080,
  userinfo URL, 5 checks, float value, buyer-supplied `escrow_id`, HTTP `resolve` after its deadline (needs a short-deadline
  escrow; the minimum deadline is "future", so use +5 min), cross-rubric terms. Expected: every call rejected; record
  which rejections are verified reasons vs bare traps (the SDK build does not surface panic messages).
- **Tier B: lifecycle (free once #3 runs).** `cancel_expired` positive and negative, `PayoutFailed` is hard to induce
  (needs a worker that rejects transfers: a deleted account works; create then delete a throwaway worker).
- **Tier C: `reset_stuck` and the stale-callback guard (the money-path one).** Cannot be forced against real OutLayer
  (it always calls back). Feasibility order: (1) near-workspaces sandbox with a stub account at the resolver's name;
  (2) a cargo feature `stub-resolver` that swaps the `RESOLVER` constant, deployed to a throwaway account next to a ~30
  line stub whose `request_execution` yields and resumes on demand. Either validates the LOGIC on real NEAR runtime
  semantics, not the deployed bytes (state this in the evidence). Sequence to run: resolve, wait 300 blocks, `reset_stuck`,
  resolve again, deliver the first callback late (must be ignored), deliver the second (pays once), deliver a duplicate
  (ignored). Estimate 1-2 days; do it only if time remains after 1-3 and 6, since the local mock harness already
  covers the logic.

## 5. OutLayer egress behavior: ask, do not probe their network

Private-IP and DNS probes (e.g. a name resolving to 127.0.0.1 or 169.254.169.254) would test OutLayer's infrastructure
without their authorization. Plan:
- **5a. Draft the question** (human sends it): does `wasi:http` follow redirects; is the destination IP checked after DNS
  resolution against private/link-local/metadata ranges; is DNS pinned for the connection; what is the egress allowlist and
  is there a response-size/time cap; where do we report issues.
- **5b. Benign probe now:** one `http_json_v1` escrow against a public host that redirects to another public host. Expected
  verdict `fail http_status_302` (matches the local run). Anything else (a 200 body from the target) means redirects ARE
  followed and the docs must change.
- **5c. Hostile-target probes only with OutLayer's written OK.** Until then the docs keep "unverified" and the page must
  not claim SSRF safety.

## 6. Page and `arbiter.json`

Files: `showcase/src/app/arbiter/data.ts` (single source for UI, JSON-LD and `/arbiter.json`), `page.tsx`, translations
(`messages/{en,zh,fr,es}.json` mention Arbiter; check whether they hold copy that needs a v3 line), `public/llms*.txt` via
`scripts/gen-llms.mjs`. Content: a v3 section next to v2.1 (two pinned rubrics, contract `suwappu-arb3.testnet`,
the three live results with tx links, stale-callback guard "tested locally only", the caller-balance caveat, "testnet only",
"not audited"), plus `status.limits`/`roadmap_not_shipped` updated. Claim rules are in
`docs/hackathon/arbiter-submission-draft.md`. Do after items 1a, 2 and tier A so every tx hash and claim on the page is exact.
Verification per repo rules: `bun run build`, then the vdebug harness for desktop and mobile screenshots; a Railway deploy
is the human's call (the page change is not "done" until the deployed URL is checked).

## Order and time

1. Today: 2, then 1a/1b, then 5b, then tier A. 2. 07:24-07:30 UTC: item 3 (tier B starts). 3. Then item 6.
4. Tier C only with spare days; send 5a early because the answer takes days. Everything fits before Nov 14 except
   tier C and 5c, which depend on time and on OutLayer.

## Decisions for the human

- Guidance option for balance predicates: docs only (recommended) or a `terms.rs` lint (forces redeploy).
- Send the OutLayer question (5a)? It is outward-facing.
- Tier C: worth 1-2 days, or accept "tested locally only" in the claims?
- Page update: deploy to production when ready, or leave it on the branch?
