CREATE TABLE IF NOT EXISTS "consumed_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain" varchar(32) NOT NULL,
	"tx_hash" varchar(128) NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"consumed_by" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_consumed_payments_chain_tx" UNIQUE("chain","tx_hash")
);
