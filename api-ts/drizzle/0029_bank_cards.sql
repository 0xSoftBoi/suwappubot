-- Suwappu Bank cards (M6). Idempotent: co-created by python database/bank_ddl/cards.py.
CREATE TABLE IF NOT EXISTS "bank_cardholders" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"member_id" varchar(64),
	"provider" varchar(16) NOT NULL,
	"provider_cardholder_id" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" varchar(24) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"account_id" text NOT NULL,
	"provider" varchar(16) NOT NULL,
	"provider_card_id" varchar(128) NOT NULL,
	"cardholder_id" text NOT NULL,
	"type" varchar(12) NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"currency" varchar(8) NOT NULL,
	"brand" varchar(24),
	"last4" varchar(4),
	"exp_month" integer,
	"exp_year" integer,
	"label" varchar(80),
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"single_use" boolean DEFAULT false NOT NULL,
	"decline_streak" integer DEFAULT 0 NOT NULL,
	"org_id" varchar(64),
	"member_id" varchar(64),
	"team_id" varchar(64),
	"expense_category" varchar(64),
	"memo" varchar(280),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_card_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"account_id" text NOT NULL,
	"authorization_id" text NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"release_reason" varchar(40),
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_card_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"provider_authorization_id" varchar(128) NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"provider_amount_minor" numeric(78, 0) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"merchant_amount_minor" numeric(78, 0),
	"merchant_currency" varchar(8),
	"merchant_name" varchar(200),
	"mcc" varchar(8),
	"merchant_country" varchar(8),
	"decision" varchar(12) NOT NULL,
	"decided_by" varchar(40) NOT NULL,
	"reason" text,
	"hold_id" text,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"member_id" varchar(64),
	"org_id" varchar(64),
	"team_id" varchar(64),
	"expense_category" varchar(64),
	"memo" varchar(280),
	"receipts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_card_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"authorization_id" text,
	"provider_transaction_id" varchar(128) NOT NULL,
	"type" varchar(12) NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"provider_amount_minor" numeric(78, 0) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"merchant_name" varchar(200),
	"mcc" varchar(8),
	"merchant_country" varchar(8),
	"transfer_id" text,
	"settlement_status" varchar(16) DEFAULT 'pending' NOT NULL,
	"settlement_error" text,
	"member_id" varchar(64),
	"org_id" varchar(64),
	"team_id" varchar(64),
	"expense_category" varchar(64),
	"memo" varchar(280),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_cardholders_provider" ON "bank_cardholders" ("provider","provider_cardholder_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_cardholders_owner" ON "bank_cardholders" ("owner_type","owner_id","provider",coalesce("member_id", ''));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_cards_provider" ON "bank_cards" ("provider","provider_card_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_cards_owner" ON "bank_cards" ("owner_type","owner_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_cards_account" ON "bank_cards" ("account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_cards_member" ON "bank_cards" ("owner_type","owner_id","member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_card_holds_account" ON "bank_card_holds" ("account_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_card_holds_auth" ON "bank_card_holds" ("authorization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_card_auth_provider" ON "bank_card_authorizations" ("provider_authorization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_card_auth_card" ON "bank_card_authorizations" ("card_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_card_txn_provider" ON "bank_card_transactions" ("provider_transaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_card_txn_card" ON "bank_card_transactions" ("card_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_card_txn_settle" ON "bank_card_transactions" ("settlement_status");
