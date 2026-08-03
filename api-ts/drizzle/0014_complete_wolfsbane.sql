ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "prev_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "entry_hash" varchar(64);