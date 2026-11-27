ALTER TABLE "bank_payroll_runs" ADD COLUMN IF NOT EXISTS "idem_key" varchar(128);--> statement-breakpoint
ALTER TABLE "bank_payroll_runs" ADD COLUMN IF NOT EXISTS "idem_hash" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_payroll_runs_idem" ON "bank_payroll_runs" ("owner_type","owner_id","idem_key") WHERE "idem_key" IS NOT NULL;
