ALTER TABLE "bank_agent_spend" ADD COLUMN IF NOT EXISTS "idem_key" varchar(128);--> statement-breakpoint
ALTER TABLE "bank_agent_spend" ADD COLUMN IF NOT EXISTS "idem_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "bank_agent_spend" ADD COLUMN IF NOT EXISTS "idem_result" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_agent_spend_idem" ON "bank_agent_spend" ("agent_id","idem_key") WHERE "idem_key" IS NOT NULL;
