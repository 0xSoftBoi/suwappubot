-- Widen swap_transactions token columns to varchar(64), matching the schema
-- change in src/db/schema/swaps.ts. drizzle-kit also re-emitted the
-- pre-existing users_recovery_email_unique constraint here as drift — it was
-- deliberately dropped from this file (0017 already adds it via a guarded
-- DO-block that tolerates the constraint existing) while keeping it in
-- 0018_snapshot.json so it never regenerates. Mirrors the 0017 precedent for
-- handling unrelated drift.
ALTER TABLE "swap_transactions" ALTER COLUMN "from_token" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "swap_transactions" ALTER COLUMN "to_token" SET DATA TYPE varchar(64);
