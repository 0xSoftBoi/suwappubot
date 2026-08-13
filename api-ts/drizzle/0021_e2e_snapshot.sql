CREATE TABLE "api_usage_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"api_key_id" text NOT NULL,
	"route" text NOT NULL,
	"day" date NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "uq_api_usage_daily_key_route_day" UNIQUE("api_key_id","route","day")
);
--> statement-breakpoint
CREATE TABLE "market_candles" (
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
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uq_market_candles_symbol_chain_timeframe_ts" UNIQUE("symbol","chain","timeframe","ts")
);
--> statement-breakpoint
CREATE INDEX "ix_api_usage_daily_key_day" ON "api_usage_daily" USING btree ("api_key_id","day");--> statement-breakpoint
CREATE INDEX "ix_market_candles_symbol_chain_timeframe_ts" ON "market_candles" USING btree ("symbol","chain","timeframe","ts" DESC NULLS LAST);