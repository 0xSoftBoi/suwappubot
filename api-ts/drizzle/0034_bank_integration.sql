-- Bank integration pass B: per-org dedicated custody wallets (idempotent, additive).
CREATE TABLE IF NOT EXISTS "bank_org_wallets" (
	"org_id" text NOT NULL,
	"family" varchar(8) NOT NULL,
	"wallet_id" integer NOT NULL,
	"wallet_user_id" integer NOT NULL,
	"address" text NOT NULL,
	"turnkey_sub_org_id" text NOT NULL,
	"turnkey_wallet_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_org_wallets_org_family" ON "bank_org_wallets" USING btree ("org_id","family");
