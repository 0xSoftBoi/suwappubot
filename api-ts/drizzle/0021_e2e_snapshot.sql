-- IF NOT EXISTS on every statement is deliberate (matches 0018 and the passkey
-- migrations). market_candles / api_usage_daily are dual-owned: the Python stack's
-- _ensure_schema() creates them idempotently at bot startup, and start.sh runs
-- `drizzle-kit migrate` verbatim on production where a failure fails the deploy.
-- Without IF NOT EXISTS, whichever service deploys second dies on
-- "relation already exists". Inline UNIQUE constraints are lifted out to
-- CREATE UNIQUE INDEX IF NOT EXISTS for the same reason (a table-level CONSTRAINT
-- has no IF NOT EXISTS form, and ADD CONSTRAINT is not idempotent).
CREATE TABLE IF NOT EXISTS "api_usage_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"api_key_id" text NOT NULL,
	"route" text NOT NULL,
	"day" date NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_candles" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"chain" varchar(50) NOT NULL,
	"token_address" varchar(255),
	"timeframe" varchar(10) NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"open" numeric(38, 18) NOT NULL,
	"high" numeric(38, 18) NOT NULL,
	"low" numeric(38, 18) NOT NULL,
	"close" numeric(38, 18) NOT NULL,
	"volume" numeric(38, 18),
	"source" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_api_usage_daily_key_route_day" ON "api_usage_daily" USING btree ("api_key_id","route","day");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_market_candles_symbol_chain_timeframe_ts" ON "market_candles" USING btree ("symbol","chain","timeframe","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_api_usage_daily_key_day" ON "api_usage_daily" USING btree ("api_key_id","day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_market_candles_symbol_chain_timeframe_ts" ON "market_candles" USING btree ("symbol","chain","timeframe","ts" DESC NULLS LAST);
