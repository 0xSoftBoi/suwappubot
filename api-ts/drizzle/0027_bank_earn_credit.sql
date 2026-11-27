-- Suwappu Bank M2 Earn + M3 Credit. Idempotent: co-created by python database/bank_ddl/earn_credit.py.
CREATE TABLE IF NOT EXISTS "bank_earn_positions" (
	"savings_account_id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"checking_account_id" text NOT NULL,
	"chain" varchar(32) NOT NULL,
	"asset" varchar(16) NOT NULL,
	"vault" varchar(64) NOT NULL,
	"shares_minor" numeric(78,0) DEFAULT '0' NOT NULL,
	"pledged_shares_minor" numeric(78,0) DEFAULT '0' NOT NULL,
	"realized_yield_minor" numeric(78,0) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_earn_ops" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"kind" varchar(12) NOT NULL,
	"source" varchar(12) NOT NULL DEFAULT 'manual',
	"savings_account_id" text NOT NULL,
	"checking_account_id" text NOT NULL,
	"vault" varchar(64) NOT NULL,
	"chain" varchar(32) NOT NULL,
	"assets_minor" numeric(78,0) NOT NULL,
	"shares_minor" numeric(78,0),
	"status" varchar(12) NOT NULL DEFAULT 'pending',
	"tx_hash" varchar(128),
	"approve_tx_hash" varchar(128),
	"transfer_id" text,
	"failure_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_earn_settings" (
	"account_id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"enabled" integer NOT NULL DEFAULT 1,
	"floor_minor" numeric(78,0) DEFAULT '0' NOT NULL,
	"vault" varchar(64) NOT NULL,
	"min_sweep_minor" numeric(78,0) NOT NULL DEFAULT '1000000',
	"last_sweep_period" varchar(16),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_earn_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"savings_account_id" text NOT NULL,
	"vault" varchar(64) NOT NULL,
	"shares_minor" numeric(78,0) NOT NULL,
	"principal_minor" numeric(78,0) NOT NULL,
	"value_minor" numeric(78,0) NOT NULL,
	"period" varchar(16) NOT NULL,
	"taken_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_credit_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"status" varchar(12) NOT NULL DEFAULT 'active',
	"chain" varchar(32) NOT NULL,
	"loan_asset" varchar(16) NOT NULL,
	"account_id" text NOT NULL,
	"market_id" varchar(66),
	"collateral_token" varchar(64),
	"collateral_decimals" integer,
	"collateral_savings_account_id" text,
	"collateral_minor" numeric(78,0) DEFAULT '0' NOT NULL,
	"pool_account_id" text,
	"limit_minor" numeric(78,0) DEFAULT '0' NOT NULL,
	"principal_minor" numeric(78,0) DEFAULT '0' NOT NULL,
	"accrued_interest_minor" numeric(78,0) DEFAULT '0' NOT NULL,
	"apr_bps" integer NOT NULL DEFAULT 0,
	"last_accrual_at" timestamp DEFAULT now() NOT NULL,
	"receivable_id" varchar(64),
	"face_minor" numeric(78,0),
	"last_level" varchar(10) NOT NULL DEFAULT 'ok',
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_credit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"line_id" text NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"type" varchar(24) NOT NULL,
	"level" varchar(10) NOT NULL DEFAULT 'info',
	"ltv_bps" integer,
	"health_factor_bps" integer,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_credit_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"asset" varchar(16) NOT NULL,
	"chain" varchar(32) NOT NULL,
	"score" integer NOT NULL,
	"tier" varchar(12) NOT NULL,
	"proposed_limit_minor" numeric(78,0) NOT NULL,
	"apr_bps" integer NOT NULL,
	"factors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_earn_pos_owner" ON "bank_earn_positions" USING btree ("owner_type", "owner_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_earn_ops_idem" ON "bank_earn_ops" USING btree ("owner_type", "owner_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_earn_ops_status" ON "bank_earn_ops" USING btree ("status", "updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_earn_snap_period" ON "bank_earn_snapshots" USING btree ("savings_account_id", "vault", "period");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_credit_lines_owner" ON "bank_credit_lines" USING btree ("owner_type", "owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_credit_lines_kind" ON "bank_credit_lines" USING btree ("kind", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_credit_lines_recv" ON "bank_credit_lines" USING btree ("receivable_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_credit_events_owner" ON "bank_credit_events" USING btree ("owner_type", "owner_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_credit_events_line" ON "bank_credit_events" USING btree ("line_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_credit_scores_owner" ON "bank_credit_scores" USING btree ("owner_type", "owner_id", "computed_at");
