-- Autopilot: the autonomous trading agent's tables (agents, cycles, decisions,
-- positions, journal), plus the market-metrics tables that had drifted ahead of
-- the migration folder.
--
-- Every statement is idempotent (IF NOT EXISTS, or a DO block that swallows
-- duplicate_object) for the reason spelled out in 0021: start.sh runs
-- `drizzle-kit migrate` verbatim on production and a failure fails the deploy,
-- while some of these tables are also created by the Python stack's
-- _ensure_schema() at bot startup. Whichever service deploys second must not die
-- on "relation already exists".

DO $$ BEGIN
	CREATE TYPE "public"."autopilot_action" AS ENUM('buy', 'sell', 'hold');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."autopilot_cycle_status" AS ENUM('running', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."autopilot_decision_status" AS ENUM('sealed', 'rejected', 'executing', 'filled', 'failed', 'revealed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."autopilot_mode" AS ENUM('paper', 'live');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."autopilot_status" AS ENUM('active', 'paused', 'stopped');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "autopilot_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"mode" "autopilot_mode" DEFAULT 'paper' NOT NULL,
	"status" "autopilot_status" DEFAULT 'paused' NOT NULL,
	"chain" varchar(32) NOT NULL,
	"base_token" varchar(64) NOT NULL,
	"base_token_symbol" varchar(20) DEFAULT 'USDC' NOT NULL,
	"wallet_address" varchar(64),
	"executor_agent_id" integer,
	"starting_equity_usd" real DEFAULT 0 NOT NULL,
	"thesis_engine" varchar(32) DEFAULT 'rules' NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_cycle_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "autopilot_agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "autopilot_cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"status" "autopilot_cycle_status" DEFAULT 'running' NOT NULL,
	"stage" varchar(24) DEFAULT 'read' NOT NULL,
	"candidates_scanned" integer DEFAULT 0 NOT NULL,
	"theses_formed" integer DEFAULT 0 NOT NULL,
	"decisions_sealed" integer DEFAULT 0 NOT NULL,
	"decisions_executed" integer DEFAULT 0 NOT NULL,
	"equity_usd" real,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "autopilot_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"cycle_id" integer,
	"action" "autopilot_action" NOT NULL,
	"chain" varchar(32) NOT NULL,
	"token_address" varchar(64) NOT NULL,
	"token_symbol" varchar(32) NOT NULL,
	"size_usd" real DEFAULT 0 NOT NULL,
	"confidence" real,
	"headline" text,
	"thesis" jsonb,
	"seal_algo" varchar(32) NOT NULL,
	"commitment" varchar(64) NOT NULL,
	"nonce" varchar(64) NOT NULL,
	"sealed_at" timestamp DEFAULT now() NOT NULL,
	"seal_tx_hash" varchar(128),
	"seal_chain" varchar(32),
	"gate_passed" boolean DEFAULT false NOT NULL,
	"gates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejection_reason" text,
	"status" "autopilot_decision_status" DEFAULT 'sealed' NOT NULL,
	"tx_hash" varchar(128),
	"quote_id" varchar(128),
	"executed_at" timestamp,
	"fill_price_usd" real,
	"fill_amount" varchar(78),
	"realized_slippage_bps" integer,
	"execution_error" text,
	"revealed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "autopilot_journal" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"cycle_id" integer,
	"decision_id" integer,
	"stage" varchar(24) NOT NULL,
	"level" varchar(16) DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "autopilot_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"chain" varchar(32) NOT NULL,
	"token_address" varchar(64) NOT NULL,
	"token_symbol" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"amount" varchar(78) DEFAULT '0' NOT NULL,
	"cost_basis_usd" real DEFAULT 0 NOT NULL,
	"avg_entry_price_usd" real,
	"last_price_usd" real,
	"unrealized_pnl_usd" real,
	"realized_pnl_usd" real DEFAULT 0 NOT NULL,
	"take_profit_pct" real,
	"stop_loss_pct" real,
	"invalidation" text,
	"entry_decision_id" integer,
	"exit_decision_id" integer,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lend_metrics" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"venue" text NOT NULL,
	"market_id" text NOT NULL,
	"chain_id" integer,
	"loan_symbol" text,
	"collateral_symbol" text,
	"ts" timestamp with time zone NOT NULL,
	"supply_apy" numeric(38, 18),
	"borrow_apy" numeric(38, 18),
	"tvl" numeric(38, 18),
	"utilization" numeric(38, 18),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uq_lend_metrics_venue_market_id_ts" UNIQUE("venue","market_id","ts")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "perp_metrics" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"venue" text NOT NULL,
	"symbol" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"funding_rate" numeric(38, 18),
	"open_interest" numeric(38, 18),
	"mark_price" numeric(38, 18),
	"index_price" numeric(38, 18),
	"volume_24h" numeric(38, 18),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uq_perp_metrics_venue_symbol_ts" UNIQUE("venue","symbol","ts")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prediction_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"venue" text NOT NULL,
	"market_id" text NOT NULL,
	"condition_id" text,
	"question" text,
	"outcome" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"price" numeric(38, 18),
	"volume" numeric(38, 18),
	"liquidity" numeric(38, 18),
	"end_date" timestamp with time zone,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uq_prediction_snapshots_venue_market_id_outcome_ts" UNIQUE("venue","market_id","outcome","ts")
);
--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD COLUMN IF NOT EXISTS "realized_to_amount" varchar(78);
--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD COLUMN IF NOT EXISTS "realized_to_amount_usd" real;
--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD COLUMN IF NOT EXISTS "price_improvement_usd" real;
--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD COLUMN IF NOT EXISTS "runner_up_provider" varchar(50);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "autopilot_cycles" ADD CONSTRAINT "autopilot_cycles_agent_id_autopilot_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."autopilot_agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "autopilot_decisions" ADD CONSTRAINT "autopilot_decisions_agent_id_autopilot_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."autopilot_agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "autopilot_decisions" ADD CONSTRAINT "autopilot_decisions_cycle_id_autopilot_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."autopilot_cycles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "autopilot_journal" ADD CONSTRAINT "autopilot_journal_agent_id_autopilot_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."autopilot_agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "autopilot_positions" ADD CONSTRAINT "autopilot_positions_agent_id_autopilot_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."autopilot_agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopilot_agents_status_idx" ON "autopilot_agents" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopilot_cycles_agent_idx" ON "autopilot_cycles" USING btree ("agent_id","started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopilot_decisions_agent_idx" ON "autopilot_decisions" USING btree ("agent_id","sealed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopilot_decisions_commitment_idx" ON "autopilot_decisions" USING btree ("commitment");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopilot_decisions_status_idx" ON "autopilot_decisions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopilot_journal_agent_idx" ON "autopilot_journal" USING btree ("agent_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopilot_positions_agent_idx" ON "autopilot_positions" USING btree ("agent_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_lend_metrics_venue_market_id_ts" ON "lend_metrics" USING btree ("venue","market_id","ts" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_perp_metrics_venue_symbol_ts" ON "perp_metrics" USING btree ("venue","symbol","ts" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_prediction_snapshots_venue_market_id_ts" ON "prediction_snapshots" USING btree ("venue","market_id","ts" DESC NULLS LAST);
