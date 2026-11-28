-- Bank review3 (idempotent, additive).
ALTER TABLE "bank_agent_spend" ADD COLUMN IF NOT EXISTS "auth_nonce" varchar(80);
--> statement-breakpoint
ALTER TABLE "bank_agent_spend" ADD COLUMN IF NOT EXISTS "auth_valid_before" bigint;
--> statement-breakpoint
ALTER TABLE "bank_agent_resource_sales" ADD COLUMN IF NOT EXISTS "auth_nonce" varchar(80);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_agent_sales_nonce" ON "bank_agent_resource_sales" USING btree ("chain","auth_nonce");
