-- Made idempotent by hand (drizzle-kit emits bare ALTER/CREATE): audit_logs is
-- co-owned with the Python stack, which creates overlapping objects at boot, so
-- either side may run first. The paired meta/0016_snapshot.json WAS generated
-- from the schema, so the next `db:generate` still diffs against reality.
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "ts_raw" varchar(40);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_approval_step_up_challenges_challenge" ON "approval_step_up_challenges" USING btree ("challenge");
