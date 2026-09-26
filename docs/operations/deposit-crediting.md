# Custodial deposit crediting — the ops process

Companion to `docs/research/deposit-ux-2026.md` Part 0, which found that no code
path credits an inbound on-chain transfer to a user. This is how the process is
run properly, what we already have, and what to do in the meantime.

---

## 1. What exists vs what is missing

We already have most of the pieces. Nothing joins them.

| Piece | State |
|---|---|
| `TransactionType.DEPOSIT = "deposit"` (`bot/models/custodial.py:21`) | **Defined, never written.** Nothing constructs a deposit row. |
| `CustodialTransaction` — `tx_hash`, `from_address`, `to_address`, `amount`, `idempotency_key` (unique index) | Schema is right for deposits; only withdrawals populate it |
| `CustodialBalance` — `user_id`/`chain`/`token_symbol`/`balance` | Mutable single-column balance. No immutable entries, so no audit trail |
| `hot_wallet_service.provision_internal_wallet` (+ KMS envelope encryption, reuse-first, TTL, **sweep-before-retire**) | Mints and manages keyed wallets already — this is the per-user address machinery |
| `get_deposit_wallet(chain_type)` | Returns `.first()` active deposit wallet — one shared omnibus |
| `hyperunit_api.py` | Deterministic **per-(asset, destination) deposit addresses + a watcher on the resulting mint** — the pattern, already working, for HyperCore only |

The gap is a watcher and a credit, not an address system.

---

## 2. The reference pipeline

Assembled from Fireblocks' deposits-at-scale guidance and SDK.finance's
implementation write-up. Seven stages:

1. **Assign** an address to the user at account creation. Store it against the
   customer reference and **never reassign it** — reassignment silently
   misattributes a late deposit to the wrong person.
2. **Detect** the inbound transfer (webhook or poller).
3. **Confirm** to the network's threshold (§4).
4. **Validate**, not just confirm. SDK.finance cross-checks the completed
   transaction against a *separate* balance-update event carrying the **same
   block height and block hash**. Mismatch ⇒ status `not_validated`, never a
   silent credit.
5. **Credit** the ledger idempotently, keyed on the chain's transaction id, so
   a webhook replay cannot double-credit.
6. **Sweep** to treasury, tracked **separately** from the deposit's status — a
   failed sweep must never un-credit a user. Gas for the sweep comes from a
   gas-station/AutoFuel wallet, since the user's deposit address holds no native
   token.
7. **Reconcile** internal ledger against on-chain balances on a schedule.

Two rules worth stating plainly, because both are load-bearing:

- **Idempotency key = the on-chain tx hash (plus log index for ERC-20).** We
  already have a unique `idempotency_key` column; this is exactly its use.
- **Credit and sweep are independent state machines.** Conflating them is the
  classic way users lose a balance when a sweep fails.

---

## 3. Recommended design for us

Reuse, don't build:

- **Per-user deposit addresses** via `provision_internal_wallet`, namespaced
  `deposit/user/{id}/{chain_type}`, `is_deposit_wallet=False` so they stay out
  of operational flows. One EVM address per user covers every EVM network (see
  the address-family model in the UX research); one SVM address covers Solana.
- **A deposit watcher** as a background service in `api/main.py`'s lifespan,
  alongside `tx_poller`/`fee_sweeper`. Per chain: scan for inbound transfers to
  known deposit addresses; write a `CustodialTransaction(tx_type=DEPOSIT,
  status=PENDING, idempotency_key=f"{chain}:{tx_hash}:{log_index}")`.
- **Credit on confirmation** — flip to `COMPLETED` and call
  `update_custodial_balance(..., operation="add")` in the same DB transaction as
  the status flip, so a crash cannot credit twice or credit without a record.
- **Sweep** with the existing sweep-before-retire logic; gas from the gas-payer
  wallet (`is_gas_payer=True`) that already exists.
- **Move `CustodialBalance` to derived-from-entries** (or at minimum reconcile
  it against the sum of `CustodialTransaction` rows nightly). A mutable balance
  with no entries cannot be audited or replayed.

---

## 4. Confirmation policy

Set this explicitly per chain and write it down — "in production systems,
finality is not a technical concept, your internal policy defines when you
credit." Binance's published thresholds are a defensible starting point:

| Network | Confirmations | Note |
|---|---|---|
| Ethereum (ERC-20) | 12 | Full finality is 2 epochs (~13 min); 12 is the common credit point |
| BSC (BEP-20) | 15 | |
| Polygon | 128 | Wait for the checkpoint |
| Arbitrum | 1 batch | Inherits L1 settlement |
| Avalanche | 1 | Fast finality |
| Tron (TRC-20) | 20 | |
| Solana | 1 rooted slot | Deterministic at max lockout (~31 blocks / ~13 s) |

Consider a **value-tiered policy**: above a set USD amount, wait for full
finality rather than the standard threshold.

---

## 5. Edge cases that need an explicit decision

| Case | Policy |
|---|---|
| **Unsupported / spam token** | Do not credit. Allowlist by token address per chain; airdropped scam tokens arrive unsolicited and must never enter the ledger |
| **Below minimum** | Publish a per-asset minimum and do not process below it (Polymarket does exactly this). Say the minimum in the UI *before* the user sends |
| **Wrong network** | Prevented by construction where possible; otherwise a manual recovery queue. Note we control both sides for EVM — same address, different chain — so these are usually recoverable |
| **Fee-on-transfer / rebasing token** | Credit the **received** amount, read from the transfer event, never the sent amount |
| **Reorg after credit** | The block-hash cross-check in stage 4 is the guard. If it happens anyway: reverse with a compensating entry, never by mutating the original |
| **Deposit to a retired address** | Never reassign addresses; keep retired ones watched indefinitely |
| **Unattributable deposit** | `not_validated` queue with admin review and an audit-recorded manual validation — do not silently drop |

---

## 6. Reconciliation

- **Per sweep:** on-chain balance of the deposit address should be ~0 after a
  successful sweep.
- **Nightly:** Σ `CustodialBalance` per (chain, token) == on-chain treasury
  balance − pending withdrawals + pending sweeps. Alert on drift beyond dust.
- **Per credit:** assert the deposit row and the balance delta agree.

---

## 7. Status

**Built and wired** (`bot/services/deposit_watcher.py`, started in
`api/main.py`'s lifespan):

- Per-user EVM deposit addresses, minted on first wallet view, never reassigned
  (`hot_wallet_service.get_or_create_user_deposit_wallet`), with
  `UNIQUE(deposit_user_id, chain_type)` so a concurrent first-load cannot mint
  two addresses for one user.
- Log-based detection of allowlisted ERC-20 transfers across the six EVM chains,
  scanned only up to `head - confirmations`.
- Idempotent credit: the ledger row and the balance move commit in one
  transaction, keyed `deposit:{chain}:{tx_hash}:{log_index}` under the existing
  `UNIQUE(user_id, idempotency_key)`. A re-scan is a no-op.
- Dust floor, token allowlist (spam-airdrop defence), and a cursor that never
  advances past a range that failed to read.
- `/terminal/wallet/summary` returns the user's own address plus
  `creditableTokens`, and the UI states what is and is not credited.

**Not built yet — and deliberately not offered in the UI:**

| Gap | Consequence |
|---|---|
| **Sweeping to treasury** | Credited funds sit at the user's deposit address. Withdrawals send from the omnibus (`terminal.py`), so withdrawals are **not** backed by deposited funds until the sweep exists. This is the next piece of work. |
| Native (ETH/BNB/MATIC) deposits | Emit no log; not detected. UI says so. |
| Solana SPL deposits | `solanaDepositAddress` returns null; not offered. |
| `CustodialBalance` as derived entries | Still a mutable column. Reconcile nightly against `CustodialTransaction` until it is derived. |

**Do not enable withdrawals against deposited funds until sweeping lands.**

## Sources

- Fireblocks, manage deposits at scale — https://developers.fireblocks.com/docs/manage-deposits-at-scale
- Fireblocks, sweep to omnibus — https://developers.fireblocks.com/reference/sweep-to-omnibus-1
- Fireblocks, Ethereum Gas Station — https://www.fireblocks.com/blog/goodbye-failed-erc20-transactions-introducing-ethereum-gas-station
- SDK.finance, crypto deposit & withdrawal infrastructure — https://sdk.finance/blog/crypto-deposit-withdrawal-infrastructure/
- Payment system design: ledger, idempotency, settlement — https://singhajit.com/payment-system-design/
- Ledger system design principles — https://fintechly.com/infrastructure/infrastructure-ledger-system-design/
- Settlement finality compared across networks — https://eco.com/support/en/articles/15210344-what-is-settlement-finality-crypto-networks-compared-2026
- USDT confirmation time by network (exchange thresholds) — https://eco.com/support/en/articles/15247703-usdt-confirmation-time-by-network-2026
- Payment finality across blockchains — https://www.spark.money/research/payment-finality-comparison-blockchains
- Polymarket deposit minimums — https://docs.polymarket.com/trading/bridge/deposit
- Dusting attacks & scam airdrop tokens — https://trezor.io/support/troubleshooting/coins-tokens/dusting-attacks-airdrop-scam-tokens
