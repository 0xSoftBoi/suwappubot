-- Table is created defensively by the Python side too (database/db.py,
-- _create_agent_approvals_table) — IF NOT EXISTS so either side may run first.
CREATE TABLE IF NOT EXISTS "agent_approvals" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"org_id" varchar(36),
	"agent_id" text NOT NULL,
	"agent_name" text,
	"user_telegram_id" bigint,
	"intent_json" jsonb,
	"intent_hash" varchar(128),
	"value_usd" numeric,
	"chain" varchar(50),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"channel" varchar(20),
	"decided_by" varchar(64),
	"decided_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"notified_at" timestamp,
	"notify_chat_id" bigint,
	"notify_message_id" integer,
	"consumed_at" timestamp
);
--> statement-breakpoint
-- Additive column, guarded in case the table already existed (created by
-- Python, or by an earlier version of this migration) without it.
ALTER TABLE "agent_approvals" ADD COLUMN IF NOT EXISTS "consumed_at" timestamp;
