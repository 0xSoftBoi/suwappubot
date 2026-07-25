CREATE TYPE "public"."web_checkout_status" AS ENUM('pending', 'active', 'linked', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."web_checkout_tier" AS ENUM('pro', 'premium');--> statement-breakpoint
CREATE TABLE "reward_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"epoch_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"cashback_usd" real DEFAULT 0 NOT NULL,
	"carryover_usd" real DEFAULT 0 NOT NULL,
	"amount_usd" real DEFAULT 0 NOT NULL,
	"fee_basis_usd" real DEFAULT 0 NOT NULL,
	"claim_address" varchar(64),
	"leaf_index" integer,
	"amount_base_units" varchar(40),
	"merkle_proof" text,
	"status" varchar(20) DEFAULT 'claimable' NOT NULL,
	"claimed_tx_hash" varchar(80),
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reward_epochs" (
	"id" serial PRIMARY KEY NOT NULL,
	"epoch_index" integer NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'accruing' NOT NULL,
	"total_amount_usd" real DEFAULT 0 NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"merkle_root" varchar(66),
	"published_tx_hash" varchar(80),
	"claim_deadline" timestamp,
	"created_at" timestamp DEFAULT now(),
	"finalized_at" timestamp,
	"published_at" timestamp,
	CONSTRAINT "reward_epochs_epoch_index_unique" UNIQUE("epoch_index")
);
--> statement-breakpoint
CREATE TABLE "web_checkouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"stripe_session_id" varchar(255) NOT NULL,
	"stripe_customer_id" varchar(255),
	"customer_email" varchar(255),
	"tier" "web_checkout_tier" NOT NULL,
	"status" "web_checkout_status" DEFAULT 'pending' NOT NULL,
	"linked_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "web_checkouts_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
ALTER TABLE "web_checkouts" ADD CONSTRAINT "web_checkouts_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "web_checkouts_customer_email_idx" ON "web_checkouts" USING btree ("customer_email");