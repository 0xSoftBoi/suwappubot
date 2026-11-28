ALTER TABLE "bank_pool_receivables" ADD COLUMN IF NOT EXISTS "dest_fp" varchar(128);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_wage_advances_transfer" ON "bank_wage_advances" ("transfer_id") WHERE "transfer_id" IS NOT NULL;
