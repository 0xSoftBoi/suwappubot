CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar(64) NOT NULL,
	"organization_id" uuid,
	"user_id" integer,
	"action_type" varchar(40) NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"policy_decision_id" bigint,
	"reason" varchar(300),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- reward_entries / reward_epochs pre-date this migration file (created via an
-- earlier `db:push` with no recorded migration — schema drift, unrelated to
-- approval_requests). IF NOT EXISTS so this migration can't be rolled back
-- with approval_requests if it re-runs against a DB where they already exist.
CREATE TABLE IF NOT EXISTS "reward_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"epoch_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"cashback_usd" real DEFAULT 0 NOT NULL,
	"carryover_usd" real DEFAULT 0 NOT NULL,
	"amount_usd" real DEFAULT 0 NOT NULL,
	"fee_basis_usd" real DEFAULT 0 NOT NULL,
	"claim_address" varchar(64),
	"leaf_index" integer,
	"amount_base_units" varchar(40),
	"merkle_proof" text,
	"status" varchar(20) DEFAULT 'claimable' NOT NULL,
	"claimed_tx_hash" varchar(80),
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reward_epochs" (
	"id" serial PRIMARY KEY NOT NULL,
	"epoch_index" integer NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'accruing' NOT NULL,
	"total_amount_usd" real DEFAULT 0 NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"merkle_root" varchar(66),
	"published_tx_hash" varchar(80),
	"claim_deadline" timestamp,
	"created_at" timestamp DEFAULT now(),
	"finalized_at" timestamp,
	"published_at" timestamp,
	CONSTRAINT "reward_epochs_epoch_index_unique" UNIQUE("epoch_index")
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_agent_idx" ON "approval_requests" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_org_status_idx" ON "approval_requests" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_user_idx" ON "approval_requests" USING btree ("user_id","status");