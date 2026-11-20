# arbiter-forensics

Read-only scripts that use only public NEAR testnet RPC data (no keys, no accounts). Python 3, standard library only.

- `forensics.py`: an Arbiter verdict's `evidence_hash` is the sha256 of the raw HTTP body the enclave read. The script
  re-fetches the same RPC call (`view_account`) at blocks around each `resolve` transaction, hashes the raw bytes, and
  reports which block the enclave actually read and the balance it saw. It matched all five unexplained `http_json_v1`
  failures on `suwappu-arb3.testnet` (see `docs/arbiter-production.md`, "Caveat: the caller's own balance...").
  The transaction hashes and evidence prefixes are baked into `RUNS`; edit them to analyze other verdicts.
- `timeline.py`: prints an account's balance block by block around one transaction, plus the transaction's receipts
  (gas, deposit, `gas_price`), which shows when funds are locked and refunded.

The public RPC rate limits (HTTP 429) if you scan many blocks quickly; add delays or use fewer threads. Blocks older
than a few epochs are not served by non-archival nodes.
