-- An exit that cannot fill is not an exit. Track consecutive failed closes so
-- the slippage allowance can escalate toward exitSlippageCeilingBps.
ALTER TABLE "autopilot_positions" ADD COLUMN IF NOT EXISTS "exit_attempts" integer DEFAULT 0 NOT NULL;
