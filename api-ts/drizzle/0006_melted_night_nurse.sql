CREATE TABLE "agent_registration_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip" varchar(64) NOT NULL,
	"day" varchar(10) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "p2p_trades" ADD COLUMN "buyer_address" varchar(255);--> statement-breakpoint
ALTER TABLE "p2p_trades" ADD COLUMN "seller_address" varchar(255);--> statement-breakpoint
ALTER TABLE "p2p_trades" ADD COLUMN "disputed_by" bigint;--> statement-breakpoint
ALTER TABLE "p2p_trades" ADD COLUMN "dispute_resolution" varchar(16);--> statement-breakpoint
ALTER TABLE "p2p_trades" ADD COLUMN "resolved_by" bigint;--> statement-breakpoint
ALTER TABLE "p2p_trades" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "p2p_trades" ADD COLUMN "resolution_note" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_registration_grants_ip_day" ON "agent_registration_grants" USING btree ("ip","day");