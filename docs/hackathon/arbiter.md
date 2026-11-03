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
near view arbiter.testnet get_escrow '{"id": 0}' --networkId testnet
near tx <settlement-tx> --networkId testnet    # logs arbiter_attestation
sha256sum near/arbiter-wasm/target/wasm32-wasip1/release/arbiter-wasm.wasm
```

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
