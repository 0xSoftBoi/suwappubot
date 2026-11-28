-- Suwappu Bank core (M0). Idempotent: co-created by python database/bank_ddl/core.py.
CREATE TABLE IF NOT EXISTS "bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"asset" varchar(16) NOT NULL,
	"chain" varchar(32) NOT NULL,
	"wallet_id" integer,
	"wallet_user_id" integer,
	"address" varchar(128),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"segment_profile" varchar(32),
	"balance_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"label" varchar(80),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"type" varchar(16) NOT NULL,
	"from_account" text,
	"to_account" text,
	"to_external" jsonb,
	"amount_minor" numeric(78, 0) NOT NULL,
	"asset" varchar(16) NOT NULL,
	"chain" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"tx_hash" varchar(128),
	"failure_reason" text,
	"memo" varchar(280),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"transfer_id" text NOT NULL,
	"account_id" text NOT NULL,
	"direction" varchar(6) NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"asset" varchar(16) NOT NULL,
	"balance_after" numeric(78, 0),
	"phase" varchar(24) DEFAULT 'submit' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_accounts_owner" ON "bank_accounts" ("owner_type","owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_accounts_wallet" ON "bank_accounts" ("chain","address","asset");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_accounts_owner_kind_asset" ON "bank_accounts" ("owner_type","owner_id","kind","asset","chain",coalesce("label", ''));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_transfers_idem" ON "bank_transfers" ("owner_type","owner_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_transfers_owner" ON "bank_transfers" ("owner_type","owner_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_transfers_status" ON "bank_transfers" ("status","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_transfers_from" ON "bank_transfers" ("from_account");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_transfers_to" ON "bank_transfers" ("to_account");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_transfers_tx" ON "bank_transfers" ("tx_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_ledger_account" ON "bank_ledger_entries" ("account_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_ledger_transfer" ON "bank_ledger_entries" ("transfer_id");
