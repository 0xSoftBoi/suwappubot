CREATE TABLE "world_id_nullifiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"nullifier" numeric(78, 0) NOT NULL,
	"consumed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "world_id_nullifiers_nullifier_action_unique" ON "world_id_nullifiers" USING btree ("nullifier","action");
