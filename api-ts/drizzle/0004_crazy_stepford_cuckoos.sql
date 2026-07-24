ALTER TABLE "swap_transactions" ADD COLUMN "entry_price_usd" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD COLUMN "to_entry_price_usd" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD COLUMN "gas_cost_usd" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD COLUMN "fee_cost_usd" numeric(20, 8);