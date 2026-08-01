-- DB-level idempotency for the cap-accounting 'allow' override insert in
-- agent.ts's approval-resubmit path: at most one policy_decisions row per
-- approval_id, so even a re-entrant insert (e.g. a retried request after a
-- crash between finalizeConsume() and the override insert) can't double-count
-- the same approved trade toward daily/session/velocity caps. Partial (WHERE
-- approval_id IS NOT NULL) so it does not constrain the many rows with no
-- associated approval. IF NOT EXISTS for db:push-drift safety, matching 0007/0008.
CREATE UNIQUE INDEX IF NOT EXISTS "policy_decisions_approval_id_unique_idx" ON "policy_decisions" USING btree ("approval_id") WHERE "policy_decisions"."approval_id" IS NOT NULL;
