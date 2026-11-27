-- Bank review1b (core / earn / credit). Idempotent, additive.
CREATE TABLE IF NOT EXISTS "bank_credit_ops" (
	"id" text PRIMARY KEY NOT NULL,
	"line_id" text NOT NULL,
	"op_key" varchar(200) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"transfer_id" text,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"principal_minor" numeric(78,0) DEFAULT '0' NOT NULL,
	"interest_minor" numeric(78,0) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_credit_ops_line_key" ON "bank_credit_ops" USING btree ("line_id","op_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_credit_ops_status" ON "bank_credit_ops" USING btree ("status","kind");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_credit_lines_unsecured_active" ON "bank_credit_lines" USING btree ("owner_type","owner_id","loan_asset","chain") WHERE "kind" = 'undercollateralized' AND "status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_credit_lines_recv_active" ON "bank_credit_lines" USING btree ("receivable_id") WHERE "kind" = 'receivable' AND "status" = 'active';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_invoice_acceptances" (
	"invoice_id" text PRIMARY KEY NOT NULL,
	"payer_owner_type" varchar(24) NOT NULL,
	"payer_owner_id" varchar(64) NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL
);
