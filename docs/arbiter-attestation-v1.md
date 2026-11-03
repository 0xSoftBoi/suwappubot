# Suwappu Arbiter — Attestation Schema v1

`suwappu.arbiter/v1` — the open format for a machine-verifiable delivery verdict.

Every verified milestone emits one attestation. Anyone can check it with three commands
(no Suwappu infrastructure required beyond a NEAR RPC endpoint).

## 1. Canonical attestation JSON

```json
{
  "fmt": "suwappu.arbiter/v1",
  "subject": {
    "kind": "milestone",
    "contract": "arbiter.testnet",
    "escrow_id": 0
  },
  "parties": {
    "buyer": "buyer.testnet",
    "worker": "octocat-agent.testnet"
  },
  "rubric": {
    "context": "github_pr",
    "repo": "arbiter-demo/shop",
    "pr_number": 7,
    "author": "octocat",
    "deadline_unix": 1795996800,
    "terms_hash": ""
  },
  "verdict": {
    "verdict": "pass",
    "reason": "merged_as_required",
    "evidence_hash": "415f1d…",
    "enclave": "Intel TDX · OutLayer",
    "arbiter_wasm_hash": "sha256-of-arbiter-wasm.wasm"
  },
  "settlement": {
    "status": "paid",
    "amount_yocto": "1000000000000000000000000",
    "chain": "near",
    "tx_hash": ""
  },
  "issued_at_block": 0
}
```

Field rules:
- `terms_hash` — sha256 of the canonical terms JSON exactly as stored on-chain. Binding.
- `evidence_hash` — sha256 of the raw evidence bytes (e.g. webhook payload) **as received by the enclave**.
- `arbiter_wasm_hash` — sha256 of the arbiter WASM binary the enclave executed. The contract pins it at
  escrow creation; the attestation repeats it. Three-way match required (contract → attestation → binary).
- `verdict` is `pass` or `fail`. Any other value is not an attestation — treat as absent.

## 2. On-chain anchor

The settlement tx emits `arbiter_attestation` log:

```
arbiter_attestation id=<escrow_id> worker=<account> verdict=<pass|fail> evidence_hash=<hex>
```

`near tx <hash> --networkId testnet` is sufficient to see it. The log is the anchor; the JSON above is
the portable form (reconstruct from contract view + tx logs, or from any Arbiter indexer).

## 3. Independent verification (3 commands)

```sh
# 1. pin the arbiter binary
sha256sum arbiter_wasm.wasm   # must equal escrow.arbiter_wasm_hash and attestation.arbiter_wasm_hash

# 2. read the escrow terms + status
near view arbiter.testnet get_escrow '{"id": 0}' --networkId testnet

# 3. read the attestation log from the settlement tx
near tx <settlement-tx> --networkId testnet
```

## 4. What this proves (and does not)

- Proves: the exact arbiter code hash ran, on the exact evidence bytes, inside a TDX enclave, and the
  on-chain callback moved funds accordingly.
- Does not prove: rubric quality, GitHub's honesty beyond its webhook signature, or that the PR was
  "good". It proves **done as specified** — never *excellent*.
- Arbitration of LLM-judged rubrics (fixed model/seed/weights in the enclave) is roadmap
  (v0.2), deliberately not in v1.
