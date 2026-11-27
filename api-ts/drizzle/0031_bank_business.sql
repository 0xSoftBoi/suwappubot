-- Suwappu Bank M9 business banking. Idempotent: co-created by python database/bank_ddl/business.py.
CREATE TABLE IF NOT EXISTS "bank_orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"reporting_currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"owner_user_id" integer NOT NULL,
	"custody_user_id" integer NOT NULL,
	"enterprise_org_id" varchar(64),
	"closed_through" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_org_members" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(16) NOT NULL,
	"team" varchar(64),
	"invited_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_org_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"role" varchar(16) NOT NULL,
	"team" varchar(64),
	"email" varchar(200),
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_by" integer NOT NULL,
	"accepted_by" integer,
	"accepted_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_org_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor_user_id" integer,
	"actor_kind" varchar(8) NOT NULL,
	"actor_agent_id" varchar(64),
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" varchar(96),
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_approval_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"rule_type" varchar(24) NOT NULL,
	"threshold_minor" numeric(78, 0),
	"required_approvals" integer DEFAULT 1 NOT NULL,
	"approver_roles" jsonb NOT NULL,
	"expiry_hours" integer DEFAULT 72 NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"action" varchar(32) NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"requested_by" integer NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"policy_id" text,
	"required_approvals" integer NOT NULL,
	"approver_roles" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"decided_at" timestamp,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_approval_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(16) NOT NULL,
	"decision" varchar(8) NOT NULL,
	"comment" varchar(280),
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_org_payees" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"address" varchar(128) NOT NULL,
	"chain" varchar(32) NOT NULL,
	"label" varchar(120),
	"added_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_treasury_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"account_id" text NOT NULL,
	"floor_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"sweep_enabled" integer DEFAULT 0 NOT NULL,
	"sweep_vault_id" varchar(96),
	"min_sweep_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_org_vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(200),
	"pay_address" varchar(128),
	"pay_chain" varchar(32),
	"category_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_org_bills" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"reference" varchar(120),
	"amount_minor" numeric(78, 0) NOT NULL,
	"asset" varchar(16) NOT NULL,
	"chain" varchar(32) NOT NULL,
	"due_date" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'unpaid' NOT NULL,
	"pay_from_account_id" text,
	"scheduled_for" timestamp,
	"category_id" text,
	"approval_request_id" text,
	"transfer_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_by" integer NOT NULL,
	"scheduled_by" integer,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_org_dunning" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" varchar(96) NOT NULL,
	"stage" integer DEFAULT 0 NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"last_stage_at" timestamp,
	"next_stage_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_org_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" varchar(12) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_org_books" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"transfer_id" text NOT NULL,
	"account_id" text NOT NULL,
	"direction" varchar(6) NOT NULL,
	"scope" varchar(10) NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"asset" varchar(16) NOT NULL,
	"reporting_currency" varchar(8) NOT NULL,
	"rate" varchar(40) NOT NULL,
	"rate_source" varchar(48) NOT NULL,
	"rate_at" timestamp NOT NULL,
	"reporting_minor" numeric(78, 0) NOT NULL,
	"category_id" text,
	"memo" varchar(280),
	"occurred_at" timestamp NOT NULL,
	"rate_lag_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_org_card_budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"scope" varchar(8) NOT NULL,
	"scope_id" varchar(64) NOT NULL,
	"monthly_cap_minor" numeric(78, 0),
	"per_tx_cap_minor" numeric(78, 0),
	"category_budgets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_org_members_org_user" ON "bank_org_members" ("org_id", "user_id");
CREATE INDEX IF NOT EXISTS "ix_bank_org_members_user" ON "bank_org_members" ("user_id");
CREATE INDEX IF NOT EXISTS "ix_bank_org_invites_org" ON "bank_org_invites" ("org_id");
CREATE INDEX IF NOT EXISTS "ix_bank_org_audit_org" ON "bank_org_audit" ("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "ix_bank_approval_policies_org" ON "bank_approval_policies" ("org_id");
CREATE INDEX IF NOT EXISTS "ix_bank_approval_requests_org" ON "bank_approval_requests" ("org_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "ix_bank_approval_requests_hash" ON "bank_approval_requests" ("org_id", "action", "payload_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_approval_decisions_req_user" ON "bank_approval_decisions" ("request_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_org_payees" ON "bank_org_payees" ("org_id", "chain", "address");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_treasury_policies_acct" ON "bank_treasury_policies" ("org_id", "account_id");
CREATE INDEX IF NOT EXISTS "ix_bank_org_vendors_org" ON "bank_org_vendors" ("org_id");
CREATE INDEX IF NOT EXISTS "ix_bank_org_bills_org" ON "bank_org_bills" ("org_id", "status", "due_date");
CREATE INDEX IF NOT EXISTS "ix_bank_org_bills_sched" ON "bank_org_bills" ("status", "scheduled_for");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_org_dunning" ON "bank_org_dunning" ("org_id", "invoice_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_org_categories" ON "bank_org_categories" ("org_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_org_books_entry" ON "bank_org_books" ("ledger_entry_id");
CREATE INDEX IF NOT EXISTS "ix_bank_org_books_org" ON "bank_org_books" ("org_id", "occurred_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_org_card_budgets" ON "bank_org_card_budgets" ("org_id", "scope", "scope_id");
