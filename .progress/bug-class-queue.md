# Bug class: tx-hash format inconsistency (0x-prefixed vs bare) — COMPLETE

**Class sentence**: *Code assumes a transaction-hash string has exactly one
format, but the stored columns hold a mix — hexbytes 1.x `HexBytes.hex()`
returns the digest WITHOUT `0x`, so EVM executors persisted bare hashes while
provider/explorer hashes are `0x`-prefixed.*

## Canonical form (decided)
`0x` + 64 lowercase hex. **Normalize on write; stay tolerant on read** (existing
rows are not rewritten). Non-EVM must pass through UNTOUCHED: Solana is base58
and case-sensitive; **TRON txids are canonically BARE 64-hex** — the same shape
as a bare EVM hash, which is why every helper is chain-aware and refuses to
guess.

## Live repro (no tests — repo policy)
- `HexBytes.hex()` -> bare. Confirmed against the installed package.
- Raw JSON-RPC, real mainnet receipt:
  - `ethereum-rpc.publicnode.com` bare **accepted**
  - `eth.drpc.org` bare **rejected**: `json: cannot unmarshal hex string without 0x prefix into Go`
  - `*.drpc.org` is in the DEFAULT rotation for 14 chains (`bot/config/settings.py:233-285`), FIRST for tempo.
- Li.Fi `li.quest/v1/status`: prefixed -> "No event found, this transaction was
  not handled by LI.FI contracts" (understood); bare -> "Transaction hash is not
  found in any chain" (**not** understood).
- `web3.py` DOES normalize internally — both spellings return the same receipt.
  So only the hand-built aiohttp payloads were actually broken.

## Queue — all items resolved
| # | file | risk | status |
|---|------|------|--------|
| 1 | bot/utils/tx_hash.py + bot/services/swap_nonce.py (shim) | - | DONE |
| 2 | swap_engine.py `_update_tx_hash` write chokepoint | HIGH | DONE |
| 3 | tx_poller.py `_check_evm_tx` eth_getTransactionReceipt | HIGH | DONE |
| 4 | tx_poller.py `_check_starknet_tx` | MED | DONE |
| 5 | tx_poller + swap_engine + reconciler LiFi `get_status` | HIGH | DONE |
| 6 | swap_engine `_check_evm_tx_status` (web3) | LOW | DONE (defensive — web3 normalizes; matters only because bare `except` returns FAILED) |
| 7 | legacy_swap_execution_adapter.py `!=` projection guard | HIGH | DONE |
| 8 | x402_service.py `_consume_shared_payment` | HIGH | DONE (check-variants / write-canonical) |
| 9 | formatters.py `format_tx_link` | MED | DONE |
| 10 | tx_poller `_get_explorer_link{,_dict}` | MED | DONE |
| 11 | models/chain.py `get_tx_url` | LOW | DONE (also removed dead identical if/else) |
| 12 | deposit_watcher.py idempotency key | MED | DONE |
| 13 | cctp_relayer / cctp_generic_relayer burn lookups | MED | DONE (keyed on real from_chain, not "evm") |
| 14 | api/webapp.py source/burn hash + `ext:` key | MED | DONE |
| 15 | api-ts/src/config/chains.ts getTransactionReceipt | HIGH | DONE (+ now logs instead of silently nulling) |
| 16 | api-ts/src/lib/paymentConsumption.ts | HIGH | DONE (check-variants / write-canonical) |
| 17 | api-ts/src/routes/agent.ts billing dedupe x4 | MED | DONE |
| 18 | webapp explorer links + display truncation | MED | DONE (display converges on canonical, keeps `0x`) |
| 19 | api-ts/src/db/schema/swaps.ts | LOW | DONE (comment only) |
| 20 | backfill | DECISION | DONE — `scripts/backfill_tx_hash_prefix.py`, NOT `_ensure_schema()` |
| 21 | cctp_api / cctp_hypercore / layerzero_api / wormhole_api outbound | MED | DONE |
| 22 | api-ts/src/__tests__/paymentReplay.test.ts | - | FIXED (existing suite the change broke) |
| 23 | tests/test_cctp_relayer_generic.py FakeQuery | - | FIXED (needed `.filter` once lookups moved off `filter_by`) |
| 24 | legacy_swap_execution_adapter `_same_tx_identity` | HIGH | FIXED (review finding 1 — stuck non-terminal swap) |
| 25 | backfill `yield_per` + per-batch commit | MED | FIXED (review finding 2 — keyset pagination) |
| 26 | api-ts agent.ts billing pre-checks case-blind | MED | FIXED (review finding 4 — `lower()` both sides) |
| 27 | Python `int(body,16)` vs TS regex parity | LOW | FIXED (review caveat B) |

## Backfill decision: operator script, NOT `_ensure_schema()`
1. It rewrites rows on a money-path table; `_ensure_schema` runs on every boot
   of every replica, so replicas would race the same UPDATE while booting.
2. The obvious SQL is **wrong**: `WHERE tx_hash NOT LIKE '0x%' AND length(tx_hash)=64`
   matches TRON txids exactly and would corrupt them. Distinguishing EVM from
   TRON needs the chain registry, which lives in Python, not SQL.
3. Reads are already tolerant, so the backfill is tidying, not a correctness
   fix. Nothing justifies putting it in the boot path.
Script defaults to `--dry-run`, derives the EVM chain set from the registry
(so a new chain is covered automatically and TRON/Solana cannot drift in),
batches, commits per batch and is resumable.

## DEPLOY ORDERING — READ BEFORE SHIPPING
The ledger commits switch the payment-ledger **write** to canonical in the same
change that widens the **read**. During a rolling cutover, and separately
between `api-ts` and `python-api` (which deploy independently), an OLD instance
still doing `eq(tx_hash, 'abc…')` misses the NEW instance's `0xabc…` row and
credits the same payment twice. `onConflictDoNothing` does not catch it — the
two rows hold different strings.
**Ship tolerant readers first, canonical writers in a later deploy, or run
single-replica through the cutover.** No code fix is possible.

Also: do NOT run `scripts/backfill_tx_hash_prefix.py --apply` on a deployment
that predates commit 2e82f92 (the `_same_tx_identity` fix) — without it the
case-folding would strand swaps in a non-terminal state.

## Money-path review (Opus) — verdict: ship with fixes, all fixed
Confirmed sound and unchanged: the check-wide/write-canonical symmetry in both
ledgers (UNIQUE still serializes, since both racers write the identical
canonical string); the `!=` → variants widening did not weaken the identity
guard; the hardcoded `"evm"` in `x402_service` and `deposit_watcher` is correct
(both are EVM-only by construction — verified via `CONFIRMATIONS`/`ALLOWLIST`
and the EIP-712 domains); every empty-collection `.in_()`/`inArray()` fails
closed.

Reviewer did NOT cover: `stripeMoney.ts`, `adminGrowth.ts`, `adminSessionAuth.ts`,
`PolicyService.ts`, `bot/services/orders.py`, `copy_service.py`, the webapp
display components, `api-ts/src/services/SwapService.ts`.

## NEEDS HUMAN
- **`/swap/record` dedupe (api/webapp.py)**: should that endpoint return the
  existing row when a matching tx_hash is already recorded, instead of
  inserting? Double-recording is already prevented by the one-shot
  `_terminal_quote_cache` pop, and adding the lookup changes the response
  contract (`explorerUrl` becomes null for a duplicate) plus adds a query to a
  hot money path. Product decision — deliberately NOT shipped here.
- **Bare producers left at source** (stored value is now fixed downstream, but
  the user-facing message still shows the bare form):
  `bot/services/hyperliquid_funding.py:193` (`execute_cctp_burn` returns bare
  `tx_hash.hex()`), surfaced at `bot/handlers/fund.py:572`; and
  `bot/services/cctp_relayer.py:231,284` (mint/credit hashes).
- **`packages/sdk` / `openclaw`**: pass tx hashes through as plain `string` with
  no normalization. Not a lie (they really can be either form) but undocumented.
- **webapp `TxHashLink` clipboard copy** still writes the raw stored hash, so a
  user can paste a bare hash into an explorer that 404s on it.
- **`ConsumedPayment.chain` is attacker-supplied** (pre-existing; `agent.ts`
  validates only `z.string().min(2).max(32)`). Safe today only because
  `get_chain_by_name` accepts no aliases, so one payment cannot verify under two
  accepted chain spellings. Add an allowlist on `chain` BEFORE anyone wires
  `CHAIN_NAME_ALIASES` into that lookup.
- **`lower(tx_hash)` functional index** wanted on `agent_credit_topups` and
  `agent_subscriptions` now that the pre-checks fold case.
- **x402 cross-spelling race**: two concurrent redemptions of the same payment
  under *different* spellings can both pass the variants check, since the UNIQUE
  constraint only catches same-spelling inserts. Requires a legacy bare row
  raced against a new one. api-ts has the identical property.
