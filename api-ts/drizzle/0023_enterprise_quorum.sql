-- Enterprise approval quorum.
-- Additive/idempotent: production runs every committed Drizzle migration exactly once,
-- while dev may already have equivalent schema from drizzle-kit push.

ALTER TABLE "policies"
  ADD COLUMN IF NOT EXISTS "required_approvals" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests"
  ADD COLUMN IF NOT EXISTS "required_approvals" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_votes" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "approval_request_id" uuid NOT NULL,
  "user_id" integer NOT NULL,
  "decision" varchar(10) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "approval_votes"
    ADD CONSTRAINT "approval_votes_approval_request_id_approval_requests_id_fk"
    FOREIGN KEY ("approval_request_id")
    REFERENCES "public"."approval_requests"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "approval_votes"
    ADD CONSTRAINT "approval_votes_user_id_users_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_votes_approval_idx"
  ON "approval_votes" USING btree ("approval_request_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_votes_approval_request_id_user_id_unique"
  ON "approval_votes" USING btree ("approval_request_id","user_id");
