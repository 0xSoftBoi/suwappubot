ALTER TABLE "point_transactions" ADD COLUMN "reference" varchar(120);--> statement-breakpoint
CREATE UNIQUE INDEX "point_transactions_user_reference_idx" ON "point_transactions" USING btree ("user_id","reference");--> statement-breakpoint
-- 0017 already adds this constraint (guarded) if it doesn't exist yet. This is a
-- drizzle-kit re-emit of that same drift; guard it the same way 0017 does so it
-- doesn't 42P07 on a database where 0017 already applied it.
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
$$;