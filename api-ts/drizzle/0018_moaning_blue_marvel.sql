ALTER TABLE "point_transactions" ADD COLUMN "reference" varchar(120);--> statement-breakpoint
CREATE UNIQUE INDEX "point_transactions_user_reference_idx" ON "point_transactions" USING btree ("user_id","reference");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_recovery_email_unique" UNIQUE("recovery_email");