-- Suwappu Bank M7 payments + M8 payroll. Idempotent: co-created by python database/bank_ddl/payments_payroll.py.
CREATE TABLE IF NOT EXISTS "bank_escrow_events" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_id" text NOT NULL,
	"milestone_id" text,
	"actor" varchar(96) NOT NULL,
	"action" varchar(24) NOT NULL,
	"from_status" varchar(16),
	"to_status" varchar(16),
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_escrow_events_escrow" ON "bank_escrow_events" ("escrow_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_escrow_milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_id" text NOT NULL,
	"seq" integer NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"description" varchar(280),
	"status" varchar(16) DEFAULT 'funded' NOT NULL,
	"delivery_proof" text,
	"delivered_at" timestamp,
	"deliver_by" timestamp,
	"auto_release_at" timestamp,
	"released_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"refunded_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"settlement" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_escrow_milestones_seq" ON "bank_escrow_milestones" ("escrow_id", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_escrow_milestones_status" ON "bank_escrow_milestones" ("status", "auto_release_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_escrows" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"payer_owner_type" varchar(24) NOT NULL,
	"payer_owner_id" varchar(64) NOT NULL,
	"payee_owner_type" varchar(24) NOT NULL,
	"payee_owner_id" varchar(64) NOT NULL,
	"arbiter_owner_type" varchar(24),
	"arbiter_owner_id" varchar(64),
	"payer_account_id" text NOT NULL,
	"payee_account_id" text NOT NULL,
	"escrow_account_id" text,
	"asset" varchar(16) NOT NULL,
	"chain" varchar(32) NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"released_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"refunded_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"status" varchar(16) DEFAULT 'funding' NOT NULL,
	"description" varchar(280),
	"auto_release_seconds" integer DEFAULT 604800 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_escrows_idem" ON "bank_escrows" ("payer_owner_type", "payer_owner_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_escrows_payer" ON "bank_escrows" ("payer_owner_type", "payer_owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_escrows_payee" ON "bank_escrows" ("payee_owner_type", "payee_owner_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_invoice_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"payer_owner_type" varchar(24),
	"payer_owner_id" varchar(64),
	"source" varchar(12) NOT NULL,
	"ref_key" varchar(160) NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"transfer_id" text,
	"tx_hash" varchar(128),
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_invoice_payments_ref" ON "bank_invoice_payments" ("invoice_id", "ref_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_invoice_payments_status" ON "bank_invoice_payments" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(32) NOT NULL,
	"payee_owner_type" varchar(24) NOT NULL,
	"payee_owner_id" varchar(64) NOT NULL,
	"payee_account_id" text NOT NULL,
	"payer_owner_type" varchar(24),
	"payer_owner_id" varchar(64),
	"amount_minor" numeric(78, 0) NOT NULL,
	"tag_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"asset" varchar(16) NOT NULL,
	"chain" varchar(32) NOT NULL,
	"reference" varchar(64),
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_at" timestamp,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"paid_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"memo" varchar(280),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scan_cursor" numeric(78, 0),
	"idempotency_key" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_invoices_slug" ON "bank_invoices" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_invoices_payee" ON "bank_invoices" ("payee_owner_type", "payee_owner_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_invoices_payer" ON "bank_invoices" ("payer_owner_type", "payer_owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_invoices_status" ON "bank_invoices" ("status", "due_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_invoices_idem" ON "bank_invoices" ("payee_owner_type", "payee_owner_id", "idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_payees" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"kind" varchar(12) NOT NULL,
	"name" varchar(120) NOT NULL,
	"method" varchar(16) NOT NULL,
	"account_id" text,
	"address" varchar(128),
	"chain" varchar(32),
	"rail_account_id" varchar(128),
	"rail" varchar(24),
	"currency" varchar(8) NOT NULL,
	"linked_owner_type" varchar(24),
	"linked_owner_id" varchar(64),
	"tax" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_payees_owner" ON "bank_payees" ("owner_type", "owner_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_payout_pools" (
	"id" text PRIMARY KEY NOT NULL,
	"operator_owner_type" varchar(24) NOT NULL,
	"operator_owner_id" varchar(64) NOT NULL,
	"pool_account_id" text NOT NULL,
	"asset" varchar(16) NOT NULL,
	"chain" varchar(32) NOT NULL,
	"default_payer_limit_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"payer_limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_payout_pools_op" ON "bank_payout_pools" ("operator_owner_type", "operator_owner_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_payroll_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"payee_id" text NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"fx_transfer_id" text,
	"transfer_id" text,
	"payout" jsonb,
	"pool_receivable_id" text,
	"paid_amount_minor" numeric(78, 0),
	"paid_asset" varchar(16),
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"memo" varchar(140),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_payroll_items_line" ON "bank_payroll_items" ("run_id", "line_no");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_payroll_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"funding_account_id" text NOT NULL,
	"asset" varchar(16) NOT NULL,
	"chain" varchar(32) NOT NULL,
	"label" varchar(120),
	"status" varchar(12) DEFAULT 'draft' NOT NULL,
	"total_minor" numeric(78, 0) NOT NULL,
	"pool_id" text,
	"approval_token" varchar(128),
	"approved_by" varchar(96),
	"schedule_id" text,
	"period_key" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"executed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_payroll_runs_owner" ON "bank_payroll_runs" ("owner_type", "owner_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_payroll_runs_period" ON "bank_payroll_runs" ("schedule_id", "period_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_payroll_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"funding_account_id" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"frequency" varchar(12) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"local_time" varchar(5) DEFAULT '09:00' NOT NULL,
	"items" jsonb NOT NULL,
	"pool_id" text,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"next_run_at" timestamp NOT NULL,
	"last_period_key" varchar(32),
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_payroll_schedules_due" ON "bank_payroll_schedules" ("status", "next_run_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_pool_receivables" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_id" text NOT NULL,
	"payer_owner_type" varchar(24) NOT NULL,
	"payer_owner_id" varchar(64) NOT NULL,
	"payer_account_id" text NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"settled_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"payroll_item_id" text,
	"payout_transfer_id" text,
	"settle_transfer_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_pool_receivables_item" ON "bank_pool_receivables" ("payroll_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_pool_receivables_payer" ON "bank_pool_receivables" ("pool_id", "payer_owner_type", "payer_owner_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_stream_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"units" numeric(78, 0) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_stream_usage_idem" ON "bank_stream_usage" ("stream_id", "idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_streams" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"payer_owner_type" varchar(24) NOT NULL,
	"payer_owner_id" varchar(64) NOT NULL,
	"payee_owner_type" varchar(24) NOT NULL,
	"payee_owner_id" varchar(64) NOT NULL,
	"payer_account_id" text NOT NULL,
	"payee_account_id" text NOT NULL,
	"asset" varchar(16) NOT NULL,
	"chain" varchar(32) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"rate_minor" numeric(78, 0),
	"period_seconds" integer,
	"unit_price_minor" numeric(78, 0),
	"cap_minor" numeric(78, 0) NOT NULL,
	"dust_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"active_seconds" numeric(78, 0) DEFAULT '0' NOT NULL,
	"resumed_at" timestamp,
	"units" numeric(78, 0) DEFAULT '0' NOT NULL,
	"settled_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"settle_seq" integer DEFAULT 0 NOT NULL,
	"pending_minor" numeric(78, 0),
	"last_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_streams_idem" ON "bank_streams" ("payer_owner_type", "payer_owner_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_streams_payer" ON "bank_streams" ("payer_owner_type", "payer_owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_streams_payee" ON "bank_streams" ("payee_owner_type", "payee_owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_streams_status" ON "bank_streams" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_wage_advances" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" varchar(12) NOT NULL,
	"source_id" text NOT NULL,
	"worker_owner_type" varchar(24) NOT NULL,
	"worker_owner_id" varchar(64) NOT NULL,
	"payee_id" text,
	"period_key" varchar(32),
	"amount_minor" numeric(78, 0) NOT NULL,
	"transfer_id" text,
	"idempotency_key" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_wage_advances_idem" ON "bank_wage_advances" ("worker_owner_type", "worker_owner_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_wage_advances_src" ON "bank_wage_advances" ("source_type", "source_id", "period_key");
