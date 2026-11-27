-- Suwappu Bank M4 remittance + M5 ramps. Idempotent: co-created by python database/bank_ddl/remit_ramps.py.
CREATE TABLE IF NOT EXISTS "bank_ramp_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"provider" varchar(24) NOT NULL,
	"provider_customer_id" varchar(128) NOT NULL,
	"kyc_status" varchar(24) DEFAULT 'not_started' NOT NULL,
	"kyc_link" text,
	"tos_link" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_external_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"provider" varchar(24) NOT NULL,
	"provider_id" varchar(128) NOT NULL,
	"rail" varchar(16) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"label" varchar(80),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_virtual_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"provider" varchar(24) NOT NULL,
	"provider_id" varchar(128) NOT NULL,
	"source_currency" varchar(8) NOT NULL,
	"dest_account_id" text NOT NULL,
	"dest_asset" varchar(16) NOT NULL,
	"dest_chain" varchar(32) NOT NULL,
	"dest_address" varchar(128) NOT NULL,
	"instructions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_ramp_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"provider" varchar(24) NOT NULL,
	"provider_id" varchar(128) NOT NULL,
	"direction" varchar(12) NOT NULL,
	"provider_state" varchar(48) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"source_rail" varchar(24) NOT NULL,
	"source_currency" varchar(8) NOT NULL,
	"dest_rail" varchar(24) NOT NULL,
	"dest_currency" varchar(8) NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"receive_minor" numeric(78, 0),
	"fee_minor" numeric(78, 0),
	"account_id" text,
	"bank_transfer_id" text,
	"external_account_id" text,
	"virtual_account_id" text,
	"client_reference_id" varchar(128),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_ramp_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" varchar(24) NOT NULL,
	"event_id" varchar(160) NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_remittances" (
	"id" text PRIMARY KEY NOT NULL,
	"sender_type" varchar(24) NOT NULL,
	"sender_id" varchar(64) NOT NULL,
	"recipient_type" varchar(24),
	"recipient_id" varchar(64),
	"recipient_ref" varchar(160),
	"mode" varchar(12) NOT NULL,
	"status" varchar(28) DEFAULT 'pending' NOT NULL,
	"corridor" varchar(16) NOT NULL,
	"send_asset" varchar(16) NOT NULL,
	"send_chain" varchar(32) NOT NULL,
	"send_currency" varchar(8) NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"receive_currency" varchar(8),
	"receive_minor" numeric(78, 0),
	"fee_minor" numeric(78, 0),
	"from_account_id" text NOT NULL,
	"escrow_account_id" text,
	"to_account_id" text,
	"bank_transfer_id" text,
	"ramp_transfer_id" text,
	"claim_token_hash" varchar(64),
	"claim_expires_at" timestamp,
	"auto_earn" varchar(5) DEFAULT 'false' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"memo" varchar(280),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_ramp_customers_owner" ON "bank_ramp_customers" ("owner_type","owner_id","provider");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_ramp_customers_prov" ON "bank_ramp_customers" ("provider","provider_customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_external_accounts_owner" ON "bank_external_accounts" ("owner_type","owner_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_external_accounts_prov" ON "bank_external_accounts" ("provider","provider_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_virtual_accounts_owner" ON "bank_virtual_accounts" ("owner_type","owner_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_virtual_accounts_prov" ON "bank_virtual_accounts" ("provider","provider_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_ramp_transfers_prov" ON "bank_ramp_transfers" ("provider","provider_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_ramp_transfers_owner" ON "bank_ramp_transfers" ("owner_type","owner_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_ramp_transfers_status" ON "bank_ramp_transfers" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_ramp_events" ON "bank_ramp_events" ("provider","event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_remittances_idem" ON "bank_remittances" ("sender_type","sender_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_remittances_sender" ON "bank_remittances" ("sender_type","sender_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_remittances_recipient" ON "bank_remittances" ("recipient_type","recipient_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_remittances_claim" ON "bank_remittances" ("claim_token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_remittances_corridor" ON "bank_remittances" ("corridor","status");
