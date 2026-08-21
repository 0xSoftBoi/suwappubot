-- Passkey recovery feature only. The pre-existing pending schema drift that
-- drizzle-kit also picked up here (web_checkout_tier enum value, and the
-- agent_credits/api_credits/x402_payments money-column type changes to
-- double precision) was deliberately dropped from this file — it is
-- unrelated to passkey recovery, touches money-path balance columns, and
-- the enum ADD VALUE statement is unsafe to run in the same transaction as
-- other DDL on Postgres < 12. Regenerate it as its own migration and route
-- it through money-path-reviewer separately.
-- This database is shared with the Python service. Python already owns
-- users.recovery_email, so every operation here must tolerate that column (or a
-- prior partial bootstrap) already existing.
CREATE TABLE IF NOT EXISTS "passkey_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"credential_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"sub_org_id" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "recovery_email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "recovery_email_set_at" timestamp;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'users_recovery_email_unique'
			AND conrelid = 'public.users'::regclass
	) THEN
		ALTER TABLE "users" ADD CONSTRAINT "users_recovery_email_unique" UNIQUE("recovery_email");
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'passkey_credentials_user_id_users_id_fk'
			AND conrelid = 'public.passkey_credentials'::regclass
	) THEN
		ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkey_credentials_user_id_idx" ON "passkey_credentials" ("user_id");
