ALTER TABLE "bank_agent_resource_sales" ADD COLUMN IF NOT EXISTS "valid_before" varchar(80);--> statement-breakpoint
ALTER TABLE "bank_agent_resource_sales" ADD COLUMN IF NOT EXISTS "head_block" varchar(40);--> statement-breakpoint
ALTER TABLE "bank_agent_resource_sales" ADD COLUMN IF NOT EXISTS "retrieval_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "bank_agent_resource_sales" ADD COLUMN IF NOT EXISTS "recover_challenge" varchar(400);--> statement-breakpoint
ALTER TABLE "bank_agent_resource_sales" ADD COLUMN IF NOT EXISTS "recover_expires" timestamp;
