-- Hand-edited to be idempotent, following the pattern established in 0012/0013:
-- CREATE TABLE IF NOT EXISTS + a guarded DO $$ block for the FK (in case a
-- concurrent deploy or the Python runtime creates the same objects
-- independently) + CREATE INDEX IF NOT EXISTS.
--
-- approval_step_up_challenges backs an INTERIM re-confirmation step for
-- POST /webapp/approvals/:id/decide (approve only), gated by
-- APPROVAL_STEP_UP_REQUIRED. This is a server-issued single-use short-TTL
-- nonce ("step-up" challenge) — NOT cryptographic WebAuthn/passkey
-- user-presence proof; there is no WebAuthn library in this repo. See
-- src/db/schema/approvalStepUpChallenges.ts for the upgrade path to real
-- passkey step-up.
CREATE TABLE IF NOT EXISTS "approval_step_up_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_telegram_id" bigint NOT NULL,
	"approval_id" varchar(36) NOT NULL,
	"challenge" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "approval_step_up_challenges" ADD CONSTRAINT "approval_step_up_challenges_approval_id_agent_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."agent_approvals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_approval_step_up_challenges_approval_id" ON "approval_step_up_challenges" USING btree ("approval_id");
