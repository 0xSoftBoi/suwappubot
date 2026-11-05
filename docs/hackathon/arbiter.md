# NEAR HACKATHON 2026 — Suwappu Arbiter ("Proof of Done")

**Trustless milestone escrow for human and agent work. Delivery verified inside an OutLayer
Intel TDX enclave. Payout enforced by the contract, not by trust. Shipping as a Suwappu product
line, not a demo.**

Tag: repo public · branch `hackathon/arbiter` · diff vs `pre-hackathon` tag:
`https://github.com/0xSoftBoi/suwappubot/compare/pre-hackathon...hackathon/arbiter`

## The failure mode

Every AI-agent marketplace (NEAR Agent Market today, everyone tomorrow) has the same hole:
**"was the work actually done?"** Money sits in escrow. Delivery is a screenshot and vibes.
Buyers don't pay; good agents can't prove themselves; disputes eat the platform.

Arbiter closes it: a NEAR escrow where release-or-refund is decided by a hash-pinned arbiter
WASM inside an OutLayer (Intel TDX) enclave — and every verified delivery mints a signed
**work attestation**, a portable credential the worker carries between jobs.

## How NEAR fits (concretely)

- **NEAR contract** (`near/arbiter-contract`): escrow create/resolve/cancel; no admin keys; rubric immutable at creation.
- **OutLayer (Intel TDX)** (`near/arbiter-wasm`): the arbiter. HMAC-verifies the GitHub webhook evidence and evaluates the rubric. Zero network I/O in v1. Attestation proves code+input+output.
- **NEAR Intents 1-Click**: funding rail for the escrow from any chain (deposit-address flow; dry-run quotes for preview). *Roadmap integration — current build uses a native-NEAR testnet escrow; Intents funding lands in Tier 1 (see `ARBITER.md`). No Intents integration shipped in this diff; don't claim it.*
- **Agent Market**: the worker side can be a hired agent; arbitration is the receipt Agent Market's terms already imply. (Roadmap; not required for the demo.)

## Do X → see Y (judge steps, no funds needed)

```sh
# 1. open https://www.suwappu.bot/arbiter  (or: cd webapp && npm run dev)
# 2. pick "Merged PR (pass)" → Run — watch TEE verify → PASS, worker "paid"
# 3. pick "Wrong author" → Run — FAIL, no transfer, funds refundable
# 4. pick "Unmerged PR" → Run — FAIL, no transfer, funds refundable
```

Everything on the page is a recorded replay of the actual `arbiter-wasm` (checked into
`near/arbiter-wasm/fixtures/`). The verdict JSON you see is byte-identical to the enclave output.

Testnet end-to-end (public RPC, no keys needed for views):

```sh
near view suwappu-arbiter.testnet get_escrow '{"id": 0}' --networkId testnet
near tx oEgUKBZhM8YuzUZDVzWaTTwhqetYmELguSKwskkVdSE suwappu-arbiter.testnet --networkId testnet   # logs arbiter_attestation (pass)
sha256sum near/arbiter-wasm/artifacts/arbiter-wasm.wasm
```

## Live testnet evidence (real OutLayer execution, 2026-11-05)

Contract: `suwappu-arbiter.testnet` (code sha256 `c4bf9a45…bff0`, source `near/arbiter-contract`). Arbiter WASM
sha256 `2e4f74d4…534e`, fetched by `outlayer.testnet` from this repo's raw URL. Rubric context `github_pr_demo`
(public demo HMAC secret). Testnet only; amounts 0.1 / 0.05 NEAR.

| Case | Step | Tx |
|---|---|---|
| Pass (merged, right author) | create_escrow (id 0, 0.1 NEAR) | `G4m5Y2oVAZgzqxm829QgfydcWtPwXq2SkyWbSGQZhQT3` |
| | resolve → OutLayer → `pass`, worker paid, `arbiter_attestation` logged | `oEgUKBZhM8YuzUZDVzWaTTwhqetYmELguSKwskkVdSE` |
| Fail (wrong author) | create_escrow (id 1, 0.05 NEAR) | `DcuTtNNjYT5ejQBxhApMoZzdLKnscMXLBMtszccgAq3` |
| | resolve → `fail`, no transfer, `arbiter_attestation` logged | `DbVioHm1Khqeev9ACaaCq2E146kebTW5fycKvQTiRNJo` |
| | cancel_expired (buyer refund after fail) | `CiKQwXex9q3xNTveHiu5XT2rEtFkvJUWT4BJQuQft6ok` |

Evidence hashes match the recorded fixtures byte for byte (`415f1d32…` pass, `0bd6a474…` fail).

Honest notes: `resolve` must attach ≥ ~0.0041 NEAR (OutLayer compute fee; the unused remainder is refunded to
the contract by OutLayer). The contract calls OutLayer with a plain cross-contract promise + callback (not
yield/resume). In this demo the buyer is the contract account itself, so the fail-case refund is a
self-transfer. The attestation here is the contract's on-chain log of the OutLayer result; a TDX quote
check is not yet wired into the contract.

## What's in the diff (pre-hackathon → hackathon/arbiter)

- `near/arbiter-wasm/` — arbiter WASM (rubric #1: GitHub PR merge, HMAC-signed evidence, zero I/O) + recorded fixtures + Node WASI runner
- `near/arbiter-contract/` — escrow contract (create/resolve/cancel; yield/resume callback to `outlayer.testnet`)
- `api-ts/src/hackathon/near2026/` + `api-ts/src/routes/arbiter.ts` — flag-gated (`HACKATHON_ARBITER=true`) status/fixtures/verify-preview endpoints; unmounted by default; excluded from OpenAPI like `/hackathon/*`
- `webapp/src/pages/Arbiter.tsx` + lazy public `/arbiter` route (`VITE_ARBITER_ENABLED=true`)
- `webapp/src/data/arbiterFixtures.ts` — generated from the recorded fixtures
- `docs/arbiter-attestation-v1.md` — open attestation spec + 3-command verification
- `ARBITER.md` — the 12-month product line (Suwappu Arbiter) this launch seeds

## Threat model — what Arbiter does not prove

- Not rubric fairness — rubrics are agreed by both parties at creation; the contract pins the hash.
- Not GitHub's honesty beyond its webhook signature — it proves *delivered as specified*, never *excellent*.
- Not enforcement against a malicious buyer/seller after verdict — it enforces *exactly once*, per the signed rubric.

## Baseline disclosure

Suwappu Arbiter pattern lineage: Suwappu's pre-existing hackathon infrastructure (Tokyo 2026 env-gated
demo routes pattern in `api-ts/src/hackathon/`) is reused as the integration shape. No production code
paths touched; no existing behavior changed; the entire slice mounts/unmounts on two flags
(`HACKATHON_ARBITER`, `VITE_ARBITER_ENABLED`), both default off.

## License

Apache-2.0 (repo LICENSE). Demo fixtures are synthetic; no real webhook secrets present.
