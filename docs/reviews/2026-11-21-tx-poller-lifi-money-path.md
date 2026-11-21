# Open findings: tx_poller Li.Fi money path (2026-11-21)

Money-path review of `e2622fc` (re-poll Li.Fi cross-chain rows stuck in
CONFIRMING) and `371a7cb` (never let a bad Li.Fi amount roll back a terminal
status), branch `claude/zealous-davinci-qt3w8x`.

Both commits were reviewed and shipped. The findings below are **separate,
pre-existing defects** in the write path those rows now reach. They are
recorded here because the `spawn_task` tool was unavailable at the time; each
wants its own commit, tagged `MONEY-PATH`, routed through `money-path-reviewer`,
with no new tests (verify live — see the harness note at the bottom).

Ranked most to least severe.

## 1. Li.Fi `substatus` is ignored, so a refunded bridge reports as completed

`bot/services/tx_poller.py::_check_lifi_status_dict` branches on
`status.status == "DONE"` alone. `substatus` is parsed by `lifi_api.py:39` /
`lifi_api.py:255` and read nowhere in the poller.

Li.Fi returns `DONE` with a `substatus` separating a real completion from a
refund or partial fill; for a refund, `receiving` describes the refund on the
**source** chain. Confirm the enum against current Li.Fi docs before
implementing — believed `COMPLETED` / `PARTIAL` / `REFUNDED`, but that is API
knowledge, not repo evidence.

Consequences of accepting a refund as COMPLETED:

- user is sent `✅ Swap Completed!` for funds that came back to them;
- `destination_tx_hash` is set to a source-chain refund tx, then rendered as a
  destination-chain explorer link in `bot/handlers/swap.py` (~1945);
- `_record_realized_fill` (`legacy_swap_execution_adapter.py`) records
  `output_asset = to_token` with the refund as `output_amount`, so the stored
  execution rate is a refund priced in a token the user never received —
  and `_project_settlement` pins it, so later correction raises;
- `calibrate_provider` (`execution_sync_calibration.py`) counts it as a success
  at fill ratio ≈ 1.0, inside the sanity bounds, inflating Li.Fi's calibrated
  success rate used for route selection.

Fix: require `substatus in (None, "COMPLETED")` for COMPLETED; route `REFUNDED`
to FAILED; do not set `destination_tx_hash` from a refund. A refund likely wants
its own reason constant and copy ("refunded to your wallet on <origin chain>" is
not "funds in transit, do not retry" — `BRIDGE_UNSETTLED_TIMEOUT_REASON`); that
copy is a product decision, so surface it. Check the same gap in
`swap_engine.py::_check_lifi_status` and `execution_reconciler.py`, whose
`_authoritative_amount` also gates only on `status != "DONE"`.

## 2. No wall-clock ceiling on the Li.Fi path

`_check_lifi_status_dict` returns CONFIRMING for everything that is not
DONE/FAILED — including `NOT_FOUND`, `INVALID` and refund-in-progress — and
`(None, None)` on exception. There is no analogue of the 0x path's
`ZEROX_UNRESOLVED_FAIL_AFTER` / `BRIDGE_PENDING_MAX_AGE`. A bridge that never
settles therefore stays CONFIRMING until `created_at` crosses
`_max_age_hours` (24h), then drops out of the query permanently — terminal by
omission again, in exactly the case where funds really are lost.

Fix: a bound mirroring `BRIDGE_PENDING_MAX_AGE` (12h, so it fires before the
24h cutoff) yielding FAILED with `BRIDGE_UNSETTLED_TIMEOUT_REASON`, whose
notification copy is already correct. Note `_apply_status_update` persists that
reason off `tx_dict["error_message"]`, so the Li.Fi path must set it on the dict
the way the 0x path does.

## 3. Realized amount is overwritten unconditionally

`_apply_status_update` writes `realized_to_amount` with no "already observed"
guard, unlike `execution_reconciler` (~318-333) which refuses the overwrite. If a
row is flipped back out of COMPLETED and later re-polled to a *different*
amount, `_project_settlement` raises "authoritative settlement amount changed
after observation" — rolling back the status write and livelocking the row with
no notification, so a genuinely completed swap displays as pending forever.

Fix: write realized only when the column is empty; never let a mismatch roll
back the status write.

## 4. `swap_engine.check_status` can flip a terminal row back, and has no owner check

`bot/handlers/swap.py` (~1885-1908) parses `swap_id` straight out of
`callback_data` with **no ownership check**, then calls
`swap_engine.check_status`, which writes `tx.status` unconditionally — no
idempotency guard, no projection. `_check_lifi_status` returns CONFIRMING for any
non-DONE/FAILED (including `NOT_FOUND`) and FAILED on a generic exception.

So any user can drive any swap row's status by spamming `swap_status_<id>`:
COMPLETED → CONFIRMING, or → FAILED. Pre-existing and independent of the two
commits above, but it is what turns finding 3 from a rare race into something
attacker-triggerable on any row. This is the one to fix first.

Related: that same method routes **any** non-jupiter/sunswap/0x cross-chain row
to `_check_lifi_status` and persists CONFIRMING — so a `socket`/`across`
cross-chain row can be stranded the same way `e2622fc` just fixed for Li.Fi.
Widening the poller's CONFIRMING filter to cover those providers would instead
falsely COMPLETE them on the origin receipt, so this needs a decision about
which resolver is authoritative per provider, not a filter change.

## 5. No row lock in `_apply_status_update`

The status re-read uses a fresh session with no `with_for_update()`.

- A user tapping Refresh mid-flight can write COMPLETED first; the poller then
  takes the early-return branch and **silently discards the realized amount it
  just fetched** (recoverable only via the reconciler).
- With `USE_WEBHOOK=true` and multiple replicas, two pollers can both pass the
  unlocked guard and both send `✅ Swap Completed!`. No double credit — see
  "clear" below.

Fix: `with_for_update()` on the re-read, or `UPDATE ... WHERE id = :id AND
status = :old` and notify only when rowcount == 1.

## 6. Unbounded serial fan-out per cycle

The Phase-1 query has no LIMIT and Phase 2 is a serial loop with a 10s per-call
timeout. Li.Fi cross-chain CONFIRMING rows now accumulate in that set for up to
24h where only 0x rows did before. During a Li.Fi outage or 429 storm every call
burns the full 10s: ~60 stuck rows ⇒ ~10-minute cycles, during which every
freshly SUBMITTED same-chain swap waits for its confirmation and notification,
and the fast-poll hint is meaningless. `execution_reconciler` hits `/status` for
the same provider independently, so the two compound on one rate limit.

Fix: `.limit(N)` + `order_by(created_at)`, and/or `asyncio.gather` with a
semaphore.

## Verified clear

- **No double-credit or double-spend.** Points are awarded in handlers at submit
  time (`handlers/swap.py`, `handlers/bulk_swap.py`), never by the poller;
  `tx_poller.py` has no points/XP/fee reference and `fee_sweeper` has no
  swap-status trigger. The terminal transition does only balance-cache
  invalidation (idempotent), notify, and canonical projection. `record_fill`
  dedupes on `external_fill_id = swap:{id}:realized`, `append_event` on stable
  `uuid5` ids, settlements upsert on `(source, ref, type)`.
- **No mis-routing.** `_check_tx_status_dict` routes lifi + cross-chain away
  from the generic EVM branch before `_PROVIDERS_WITH_DEST_FILL_CHECK` is
  consulted.
- **No refused backwards projection in the normal re-poll case.**
  `CONFIRMING → ACTIVE` is a no-op when the parent is already `active`; the
  `UNKNOWN → CONFIRMING` hazard is handled by the existing guard. For a parent
  already `reconciling`/`filled`, Phase-1 projection raises but is isolated in a
  savepoint and only logged, and the terminal write recovers because
  `_prepare_realized_fill` explicitly permits those states.

## Not verified

- The exact Li.Fi `substatus` enum (finding 1).
- How often `receiving.amount == "0"` occurs in production — `371a7cb`'s
  reachability was inferred from the reconciler's explicit guard, not from logs.
- `fee_sweeper.py` was confirmed trigger-free by grep, not read in full.
- `execution_sync_replay.py` / `execution_receipt.py` consumers were confirmed
  read-only over `realized_to_amount`, not traced further.

## Live-verification harness

`pip install -r requirements.txt` works. Bot imports need
`TELEGRAM_BOT_TOKEN`, a Fernet `ENCRYPTION_KEY` and `KMS_PROVIDER=dev`. A SQLite
`DATABASE_URL` plus `database.db.init_db(url)` gives a real schema, so rows can
be built in each status and `_check_pending_transactions()` driven directly with
a stubbed `LiFiStatus` — that is how both commits above were verified, including
the before/after on which rows the Phase-1 filter selects. Run
`black --line-length=100` on touched files only; `bot/` and `api/` have
pre-existing non-compliance under black 26.x.
