ALTER TABLE "policies" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN IF NOT EXISTS "approval_mode" varchar(20) DEFAULT 'above_limit' NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN IF NOT EXISTS "allowed_contracts" text[];--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agents" ADD CONSTRAINT "agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_agents_organization_id" ON "agents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policies_agent_only_idx" ON "policies" USING btree ("agent_id");
