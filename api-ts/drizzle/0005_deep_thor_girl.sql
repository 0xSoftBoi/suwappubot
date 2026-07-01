CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" varchar(64),
	"name" varchar(120) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"max_tx_usd" real,
	"max_slippage_bps" integer,
	"max_gas_usd" real,
	"daily_cap_usd" real,
	"session_cap_usd" real,
	"max_tx_per_hour" integer,
	"allowed_chains" text[],
	"blocked_chains" text[],
	"allowed_tokens" text[],
	"blocked_tokens" text[],
	"destination_allowlist" text[],
	"require_approval_above_usd" real,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_decisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"agent_id" varchar(64),
	"decision" varchar(20) NOT NULL,
	"reason" varchar(300),
	"matched_policy_id" uuid,
	"intent" jsonb,
	"value_usd" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_kill_switches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" varchar(10) NOT NULL,
	"scope_id" varchar(64),
	"active" boolean DEFAULT true NOT NULL,
	"reason" varchar(300),
	"activated_by" integer,
	"activated_at" timestamp DEFAULT now() NOT NULL,
	"deactivated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_kill_switches" ADD CONSTRAINT "policy_kill_switches_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policies_org_idx" ON "policies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "policies_org_agent_idx" ON "policies" USING btree ("organization_id","agent_id");--> statement-breakpoint
CREATE INDEX "policy_decisions_org_created_idx" ON "policy_decisions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "policy_decisions_agent_created_idx" ON "policy_decisions" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "policy_kill_switches_scope_idx" ON "policy_kill_switches" USING btree ("scope","scope_id","active");