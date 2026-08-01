-- Hand-edited to be idempotent against the Python runtime DDL
-- (database/db.py._ensure_schema), which may create these same objects
-- independently, and to drop unrelated drift (agent_link_codes
-- column-type/index churn) that `drizzle-kit generate` picked up from a
-- prior hand-edited migration (0012) — that drift is not part of this
-- change and must not be re-applied here.
--
-- Additive, nullable agents.organization_id (MCP tool-auth surface has no
-- agent->org mapping today; this closes that gap so org-scoped policies /
-- kill switches can apply to MCP calls). Populates nothing automatically.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agents" ADD CONSTRAINT "agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_agents_organization_id" ON "agents" USING btree ("organization_id");
