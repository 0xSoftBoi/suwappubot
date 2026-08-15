ALTER TABLE "api_keys" ADD COLUMN "spend_limit_credits" integer;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "spent_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD COLUMN "realized_to_amount" varchar(78);--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD COLUMN "realized_to_amount_usd" real;