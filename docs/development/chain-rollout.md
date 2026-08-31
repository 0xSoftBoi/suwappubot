# New Chain Rollout: Dry-Run First

Source: `docs/plans/oss-parity.md` Phase 5 ("Freqtrade's lesson" — a
backtesting/dry-run engine that never lets a paper trade touch a live
exchange). Suwappu's version: a chain can be flagged to run the **full**
custodial swap path in `bot/services/swap_engine.py` — quote, policy gate,
adaptive slippage, spending-limit check, balance validation — but the signed
transaction is **never broadcast**. A simulated fill is recorded into the
normal `swap_transactions` table, marked `simulated=true`, so the engine
wiring for a brand-new chain can be exercised end-to-end before it ever
touches real capital.

## How it works

- `DRY_RUN_CHAINS` (env, comma-separated chain keys matching
  `bot/config/chains.py`, e.g. `DRY_RUN_CHAINS=tempo,goat`) — default empty.
  Empty means no chain is dry-run: byte-identical current behavior.
- `settings.is_dry_run_chain(chain)` (`bot/config/settings.py`) is the single
  read helper.
- The gate lives in exactly one place: `SwapEngine.execute_swap`
  (`bot/services/swap_engine.py`), immediately before the provider dispatch
  that would otherwise call `_execute_<provider>_swap` (the method that
  signs AND broadcasts, for every provider — EVM and Solana alike). If
  `quote.from_chain` is dry-run, dispatch is redirected to
  `_execute_dry_run_swap` instead of any real executor, **regardless of
  which provider the quote would have used**. This is a hard safety
  invariant: it is enforced once, at the fan-out point, not per-provider —
  so it cannot be bypassed by routing through a provider nobody remembered
  to gate individually.
- A simulated fill settles immediately (no chain to confirm against) at the
  **quote's own price** (`to_amount` / `to_amount_usd`), with no modeled
  slippage in this first pass — a documented extension point in
  `_execute_dry_run_swap`'s docstring for widening this to a configurable
  slippage distribution later.
- The row is written with `status=COMPLETED`, `simulated=true`, and a
  synthetic `tx_hash` of the form `SIMULATED-<provider>-<swap_id>-<hex>` that
  can never be confused with (or collide with) a real on-chain hash.

## Guardrail: simulated fills never touch real accounting

Every credit/debit site that reads swap outcomes gates on `not simulated` (or
skips the credit path entirely when the engine already knows the fill is
simulated):

| Site | File:line | What it would otherwise do wrong |
|---|---|---|
| Copy-trading fan-out | `bot/services/swap_engine.py` (`execute_swap`, guarded by `if not is_dry_run:` before `copy_service.handle_swap_submitted`) | Replicate a fake trade into followers' real wallets |
| Average-cost / PnL settlement | `bot/services/swap_engine.py` (`execute_swap`, guarded before `_settle_user_position`) | Corrupt the user's real cost basis |
| Spending-limit outflow tracking | `bot/services/swap_engine.py` (`execute_swap`, guarded before `spending_limit_service.record`) | Eat into the user's real spend window for a swap that moved no funds |
| Fee charge, referral reward, XP | `bot/handlers/swap.py` (`fee_service.record_fee` / `referral_service.record_reward` / `points_service.award_swap_points`, gated on `not swap_tx.simulated`) | Charge a fee and award XP for a swap that never happened |
| Fee charge, referral reward, XP (bulk) | `bot/handlers/bulk_swap.py` (same trio, gated on `not swap_tx.simulated`) | Same as above, multi-leg path |
| Limit-order EXECUTED flip | `bot/services/orders.py` (`_execute_limit_order`, status check gated on `not swap_tx.simulated`) | Mark a real limit order fulfilled when nothing settled |
| DCA spend/execution stats | `bot/services/orders.py` (`_execute_dca_order`, status check gated on `not swap_tx.simulated`) | Advance a real DCA schedule's spend counter |
| Positions backfill replay | `bot/services/positions_service.py` (`backfill_user_positions` query, `SwapTransaction.simulated.is_(False)`) | Replay a fake fill into reconstructed real holdings |

`tx_poller.py` and `execution_reconciler.py` never see a simulated row at
all: it is written `COMPLETED` at creation time, so it never enters either
service's "still pending" queries.

## Rollout policy for a new chain

1. Land the chain integration (RPC config, token list, at least one
   executable provider) behind the existing chain config, same as any other
   chain.
2. Add the chain key to `DRY_RUN_CHAINS` in the target environment (Railway
   variable, not a code change) before enabling it for real users.
3. Run dry for **at least 14 days or 200 simulated swaps, whichever is
   longer**. Watch:
   - Quote availability and error rate (does the provider return usable
     quotes for this chain reliably?).
   - Policy-gate false positives/negatives (spending limits, gated-token
     checks, GOAT/Citrea/Tempo-style hard backstops if applicable).
   - Fill-quality review: compare simulated `realized_to_amount` against
     what a live quote would have produced at the same moment, spot-checked
     manually — this pass does not yet model slippage, so this is a
     sanity check on quote stability, not fill accuracy.
4. Only after that review passes does an operator remove the chain from
   `DRY_RUN_CHAINS` to enable real broadcast. This is a config change, not a
   deploy — do it deliberately, one chain at a time, and log the date/swap
   count reviewed in the PR or incident channel for the record.
5. If dry-run turns up a build/quote bug, fix it and restart the dry-run
   clock for that chain — the count does not carry over across a code
   change to the execution path.

## User-facing disclaimer

**Simulated is not live.** A swap on a chain in `DRY_RUN_CHAINS` never
broadcasts a real transaction and never moves real funds — it is a pilot
mode used internally while onboarding a new chain integration. Any UI
surface (Telegram/WhatsApp confirmation, webapp history, position cards)
that renders a swap row should treat `simulated=true` as a hard "do not
present as a real fill" flag: label it plainly (e.g. "SIMULATED — no funds
moved") and never surface its synthetic `tx_hash` as a clickable explorer
link. `DRY_RUN_CHAINS` is an operator-only rollout control, not a
user-selectable "paper trading" mode; it is not intended to be exposed to
end users at all today, and no bot chain should ever be in this list once
its 14-day/200-swap dry-run review has passed.

## Follow-ups (out of scope for this pass)

- **Dual-ORM mirror (ADR 0003).** The Python side of the `simulated` column
  is done: `bot/models/swap.py` (`SwapTransaction.simulated`) and the
  additive, idempotent migration `_add_swap_simulated_column` in
  `database/db.py`. The Drizzle mirror is NOT done yet — it needs, in
  `api-ts/src/db/schema/swaps.ts`, a column on `swapTransactions` following
  the existing `wasSelected` boolean pattern:
  `simulated: boolean('simulated').default(false).notNull()`, plus
  whatever migration-generation step `api-ts` uses for schema changes
  (`bun run db:generate` / `db:push` per the root `CLAUDE.md` command
  list) so the Postgres column exists identically from either ORM's view.
  Until that lands, any write path through api-ts must not assume the
  column exists.
- **UI labeling.** No handler/webapp rendering code was changed to display
  the "SIMULATED" label described above — the flag exists on the row, but
  nothing reads it for display yet. Do this before exposing dry-run history
  anywhere a user can see it.
- **Real tx-build for the simulated fill.** This pass skips calling any
  provider's calldata-build step for a dry-run chain — see the extension
  point comment in `_execute_dry_run_swap`. A follow-up should build+sign
  (never broadcast) the real payload for the two representative custodial
  shapes (EVM: the calldata-fetch + local sign half of
  `_execute_lifi_evm_swap`; Solana: the versioned-transaction build + local
  sign half of `_execute_jupiter_swap`) so the pilot also proves the exact
  bytes a live broadcast would send.
- **api-ts custodial swap path** was explicitly out of scope for this pass
  (Python `swap_engine.py` only, per the task). If api-ts ever grows its own
  custodial broadcast path, it needs the same single-chokepoint dry-run gate
  before going live.
