-- value_usd was float4 (`real`): loses precision above ~16.7M and accumulates
-- rounding error in the cap SUMs. policy_decisions is api-ts-owned (no Python
-- model / _ensure_schema entry). Idempotent: ALTER TYPE to the current type is a
-- no-op. Existing float4 values widen exactly (they keep their float4 value).
-- The type change rewrites the table under ACCESS EXCLUSIVE, and every agent
-- swap reads/writes it. Give up after 5s rather than queue live traffic behind
-- the lock: the migrate step then fails and the previous revision keeps serving.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "policy_decisions" ALTER COLUMN "value_usd" SET DATA TYPE double precision;
