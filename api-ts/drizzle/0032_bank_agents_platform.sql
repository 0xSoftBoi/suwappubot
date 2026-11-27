-- Suwappu Bank M10-M13 (agents, platform, privacy). Idempotent; co-created by python database/bank_ddl/agents_platform.py.
CREATE TABLE IF NOT EXISTS "bank_agent_mandates" (
	id text PRIMARY KEY,
	agent_id varchar(64) NOT NULL,
	account_id text NOT NULL,
	per_call_max_minor numeric(78,0) NOT NULL,
	daily_cap_minor numeric(78,0) NOT NULL,
	allowed_hosts jsonb NOT NULL DEFAULT '[]'::jsonb,
	allowed_payees jsonb NOT NULL DEFAULT '[]'::jsonb,
	allowed_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
	expires_at timestamp,
	status varchar(16) NOT NULL DEFAULT 'active',
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_agent_spend" (
	id text PRIMARY KEY,
	mandate_id text NOT NULL,
	agent_id varchar(64) NOT NULL,
	account_id text NOT NULL,
	host varchar(255) NOT NULL,
	payee varchar(128) NOT NULL,
	asset varchar(16) NOT NULL,
	chain varchar(32) NOT NULL,
	amount_minor numeric(78,0) NOT NULL,
	status varchar(16) NOT NULL DEFAULT 'reserved',
	transfer_id text,
	tx_hash varchar(128),
	resource_url text,
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_agent_resources" (
	id text PRIMARY KEY,
	seller_agent_id varchar(64) NOT NULL,
	account_id text NOT NULL,
	slug varchar(64) NOT NULL,
	title varchar(120) NOT NULL,
	description text,
	upstream_url text NOT NULL,
	price_minor numeric(78,0) NOT NULL,
	asset varchar(16) NOT NULL,
	chain varchar(32) NOT NULL,
	status varchar(16) NOT NULL DEFAULT 'active',
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_agent_resource_sales" (
	id text PRIMARY KEY,
	resource_id text NOT NULL,
	payer varchar(128) NOT NULL,
	tx_hash varchar(128) NOT NULL,
	amount_minor numeric(78,0) NOT NULL,
	asset varchar(16) NOT NULL,
	chain varchar(32) NOT NULL,
	credited varchar(5) NOT NULL DEFAULT 'false',
	created_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_partners" (
	org_id varchar(64) PRIMARY KEY,
	fee_bps_transfer integer NOT NULL DEFAULT 0,
	fee_bps_fx integer NOT NULL DEFAULT 0,
	revenue_account_id text,
	webhook_url text,
	webhook_secret varchar(128),
	status varchar(16) NOT NULL DEFAULT 'active',
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_partner_customers" (
	id text PRIMARY KEY,
	partner_id varchar(64) NOT NULL,
	external_ref varchar(128) NOT NULL,
	display_name varchar(200),
	email varchar(254),
	country varchar(2),
	status varchar(16) NOT NULL DEFAULT 'active',
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_partner_events" (
	id text PRIMARY KEY,
	partner_id varchar(64) NOT NULL,
	event varchar(64) NOT NULL,
	payload jsonb NOT NULL DEFAULT '{}'::jsonb,
	status varchar(12) NOT NULL DEFAULT 'pending',
	attempts integer NOT NULL DEFAULT 0,
	next_attempt_at timestamp DEFAULT now() NOT NULL,
	last_error text,
	delivered_at timestamp,
	created_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_payment_addresses" (
	handle varchar(64) PRIMARY KEY,
	owner_type varchar(24) NOT NULL,
	owner_id varchar(64) NOT NULL,
	document jsonb NOT NULL,
	signature text,
	signer varchar(64),
	signature_scheme varchar(16),
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_stealth_view_keys" (
	id text PRIMARY KEY,
	owner_type varchar(24) NOT NULL,
	owner_id varchar(64) NOT NULL,
	secret varchar(66) NOT NULL,
	created_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_stealth_payouts" (
	id text PRIMARY KEY,
	owner_type varchar(24) NOT NULL,
	owner_id varchar(64) NOT NULL,
	payout_ref varchar(128) NOT NULL,
	stealth_address varchar(42) NOT NULL,
	ephemeral_pub varchar(68) NOT NULL,
	view_tag varchar(4) NOT NULL,
	payee_meta varchar(140) NOT NULL,
	chain varchar(32),
	announce_tx varchar(128),
	created_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_agent_mandates_agent" ON bank_agent_mandates(agent_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_agent_spend_mandate" ON bank_agent_spend(mandate_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_agent_resources_slug" ON bank_agent_resources(slug);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_agent_sales_tx" ON bank_agent_resource_sales(tx_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_partner_customers_ref" ON bank_partner_customers(partner_id, external_ref);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_partner_events_due" ON bank_partner_events(status, next_attempt_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_stealth_payouts_ref" ON bank_stealth_payouts(owner_type, owner_id, payout_ref);
