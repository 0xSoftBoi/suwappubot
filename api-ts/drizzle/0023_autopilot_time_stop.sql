-- The time stop committed at entry had nowhere to live, so it was dropped at
-- persistence and the exit check received `undefined` on every cycle. Additive
-- and idempotent, per docs/development/migrations.md.
ALTER TABLE "autopilot_positions" ADD COLUMN IF NOT EXISTS "max_hold_minutes" integer;
