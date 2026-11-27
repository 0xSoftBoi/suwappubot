-- Bank core hardening: claim columns, dropped-tx tracking, ledger posting uniqueness. Idempotent.
ALTER TABLE "bank_transfers" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "bank_transfers" ADD COLUMN IF NOT EXISTS "claim_token" varchar(64);
--> statement-breakpoint
ALTER TABLE "bank_transfers" ADD COLUMN IF NOT EXISTS "drop_first_seen_at" timestamp;
--> statement-breakpoint
ALTER TABLE "bank_transfers" ADD COLUMN IF NOT EXISTS "drop_checks" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_ledger_posted" ON "bank_ledger_entries" ("transfer_id","phase","account_id","direction");
