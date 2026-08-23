-- A swap whose outcome we never learned is not a failure. Marking it `failed`
-- lets the agent spend the same money twice: it books no position, still
-- believes it holds the cash, and buys again next cycle.
ALTER TYPE "public"."autopilot_decision_status" ADD VALUE IF NOT EXISTS 'unknown' BEFORE 'revealed';
