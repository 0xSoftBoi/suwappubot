CREATE TABLE "agent_trust" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"trust_score" real DEFAULT 100 NOT NULL,
	"threat_count" integer DEFAULT 0 NOT NULL,
	"clean_count" integer DEFAULT 0 NOT NULL,
	"quarantined_until" timestamp,
	"last_threat_at" timestamp,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_trust" ADD CONSTRAINT "agent_trust_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_trust_agent_id_unique_idx" ON "agent_trust" USING btree ("agent_id");
