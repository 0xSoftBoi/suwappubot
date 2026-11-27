# Neobank dev `drizzle-kit push --force` safety check

Verdict: SAFE for dev boot as far as bank_* tables go (no bank index, column, constraint or table is dropped). Two cosmetic changes remain, plus pre-existing non-bank push noise (below).

## Method
- Local Postgres :5433, fresh DB `bank_push_check`. State = Python `init_db` run (includes database/bank_ddl), i.e. what dev has before api-ts boots. 64 bank_* tables.
- Python `init_db` was run twice (see finding 3). A second DB `bank_mig_check` was built with `drizzle-kit migrate` only; its bank catalog is IDENTICAL to the Python-created one after normalising default casts (so Python DDL and SQL migrations agree).
- `push --force --verbose` needs a TTY because of enum rename prompts. It was run under a Python pty driver (Enter = "create enum"). It really executed statements (not a dry run). Evidence: scratchpad push*.txt.
- Catalog dumps (columns, pg_indexes, pg_constraint, all of schema public, not just bank): scratchpad beforeall*.txt / afterall*.txt.

## tablesFilter
Listed tables plus `bank_*`. It filters only table introspection. It does NOT filter the Drizzle schema side, sequences or enums. So the push proposes (pre-existing, not bank related): CREATE TABLE for about 110 filtered-out non-bank tables (fails "relation already exists", e.g. rug_monitors), CREATE TYPE x10, DROP TYPE paymentstatus/subscriptiontier (fails: x402_payments depends on it), DROP SEQUENCE x125 for python-owned `*_id_seq`, DROP INDEX ix_daily_quests_date and ix_jackpot_pools_date. Statements are not atomic, so the run aborts partway. On a Python-created dev DB push errors out; start.sh swallows it. No non-bank table was altered in the AFTER dump (only the 3 bank defaults below changed), but the proposed non-bank DROP SEQUENCE/DROP TYPE/DROP INDEX are a standing hazard, not caused by this branch (not verified against main).

## Differences on bank_* (first pass = what dev would change)
1. DROP + re-CREATE of the 2 expression unique indexes ux_bank_cardholders_owner and ux_bank_accounts_owner_kind_asset (coalesce(label/member_id,'')). The AFTER catalog definition is identical. This is a drizzle-kit limitation: it cannot round-trip expression indexes, so it churns on every push (verified 3 times). Tried rewriting the expression as PG prints it; no change; reverted. Harmless: same definition, runs within seconds. Brief non-unique window on a dev DB only.
2. Defaults CURRENT_TIMESTAMP -> now() on bank_credit_ops.created_at/updated_at and bank_invoice_acceptances.accepted_at. Python DDL uses CURRENT_TIMESTAMP; migrations and Drizzle use now(). Semantically identical.
3. Python first-boot ordering bug: bank_ddl.idempotency2 sorts before payments_payroll, so on a fresh DB it fails ("bank_payroll_runs does not exist", logged, non-fatal). bank_payroll_runs.idem_key, idem_hash and ux_bank_payroll_runs_idem are missing until the second boot. Push would add the columns and the partial unique index (Drizzle declares them), but only on a DB where push gets that far. Not edited (app behaviour).

All safety-critical unique/partial unique indexes (ledger, transfer idempotency, invoice receipt, credit-line partials, agent spend, resource-sale nonce, wage-advance, payroll idem) are declared in Drizzle: push proposed no drop of them. No column, constraint or table drops on bank_*.

## Fixes
None kept: no schema edit (git checkout of the experiment). Temp config removed.

## Reverse check (empty DB, push then migrate)
Push creates all 64 bank tables, and the catalog equals the Python-created one. `drizzle-kit migrate` then FAILS with exit 1 and records nothing: migration 0000 uses plain `CREATE TABLE "rug_monitors"` (non-idempotent, pre-existing, non-bank). The bank migrations 0026+ use IF NOT EXISTS and are never reached. Dev DBs are push-managed, so migrate is not run there. Prod uses migrate on a DB with history.

## bun run check
Passes (no errors).
