-- Bank review2 (idempotent, additive): onchain receipt uniqueness, per-hold captured amount, card shortfall receivables.
ALTER TABLE "bank_invoice_payments" ADD COLUMN IF NOT EXISTS "receipt_key" varchar(260);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_invoice_payments_receipt" ON "bank_invoice_payments" USING btree ("receipt_key");
--> statement-breakpoint
ALTER TABLE "bank_card_holds" ADD COLUMN IF NOT EXISTS "captured_minor" numeric(78, 0) DEFAULT '0' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_card_shortfalls" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"card_id" text NOT NULL,
	"card_transaction_id" text NOT NULL,
	"amount_minor" numeric(78, 0) NOT NULL,
	"repaid_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"status" varchar(8) DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"repaid_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_card_shortfalls_txn" ON "bank_card_shortfalls" USING btree ("card_transaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_card_shortfalls_account" ON "bank_card_shortfalls" USING btree ("account_id","status");
