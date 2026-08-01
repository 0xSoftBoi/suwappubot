ALTER TABLE "audit_logs" ADD COLUMN "prev_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "entry_hash" varchar(64);