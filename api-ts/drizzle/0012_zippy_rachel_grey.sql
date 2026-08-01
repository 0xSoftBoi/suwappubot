-- Hand-edited to be idempotent against the Python runtime DDL
-- (database/db.py._ensure_schema), which may create these same objects
-- independently. code_hash is a sha256 hex digest (always 64 chars) and is
-- UNIQUE — the Python side assumes one code hash maps to exactly one code.
-- All timestamp columns are timestamptz to avoid host-timezone drift between
-- the Python and TypeScript writers.
CREATE TABLE IF NOT EXISTS "agent_link_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"used_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "owner_user_id" integer;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_link_codes" ADD CONSTRAINT "agent_link_codes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ix_agent_link_codes_code_hash" ON "agent_link_codes" USING btree ("code_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_agent_link_codes_agent_id" ON "agent_link_codes" USING btree ("agent_id");
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_agents_owner_user_id" ON "agents" USING btree ("owner_user_id");
