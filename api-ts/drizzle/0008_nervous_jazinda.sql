CREATE TABLE "agent_registration_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip" varchar(64) NOT NULL,
	"day" varchar(10) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_registration_grants_ip_day" ON "agent_registration_grants" USING btree ("ip","day");