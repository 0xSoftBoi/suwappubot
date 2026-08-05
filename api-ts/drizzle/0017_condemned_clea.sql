-- Passkey recovery feature only. The pre-existing pending schema drift that
-- drizzle-kit also picked up here (web_checkout_tier enum value, and the
-- agent_credits/api_credits/x402_payments money-column type changes to
-- double precision) was deliberately dropped from this file — it is
-- unrelated to passkey recovery, touches money-path balance columns, and
-- the enum ADD VALUE statement is unsafe to run in the same transaction as
-- other DDL on Postgres < 12. Regenerate it as its own migration and route
-- it through money-path-reviewer separately.
CREATE TABLE "passkey_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"credential_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"sub_org_id" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_email_set_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_recovery_email_unique" UNIQUE("recovery_email");--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;