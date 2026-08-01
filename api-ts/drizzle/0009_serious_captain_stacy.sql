CREATE TABLE "swap_route_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" varchar(128) NOT NULL,
	"swap_id" integer,
	"user_id" integer,
	"agent_id" integer,
	"from_chain" varchar(50) NOT NULL,
	"to_chain" varchar(50) NOT NULL,
	"from_token" varchar(40) NOT NULL,
	"to_token" varchar(40) NOT NULL,
	"from_amount_usd" real,
	"provider" varchar(50),
	"tool" varchar(80),
	"quoted_to_amount" varchar(78),
	"quoted_to_amount_usd" real,
	"quoted_gas_usd" real,
	"quoted_fee_usd" real,
	"quoted_duration_s" integer,
	"rank" integer,
	"was_selected" boolean DEFAULT false NOT NULL,
	"route_hash" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policies" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "approval_mode" varchar(20) DEFAULT 'above_limit' NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "allowed_contracts" text[];--> statement-breakpoint
CREATE INDEX "ix_swap_route_candidates_quote_id" ON "swap_route_candidates" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "ix_swap_route_candidates_swap_id" ON "swap_route_candidates" USING btree ("swap_id");--> statement-breakpoint
CREATE INDEX "ix_swap_route_candidates_created_at" ON "swap_route_candidates" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "policies_agent_only_idx" ON "policies" USING btree ("agent_id");