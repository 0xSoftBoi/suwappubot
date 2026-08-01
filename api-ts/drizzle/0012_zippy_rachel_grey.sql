CREATE TABLE "agent_link_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"code_hash" varchar(128) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "owner_user_id" integer;--> statement-breakpoint
ALTER TABLE "agent_link_codes" ADD CONSTRAINT "agent_link_codes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_agent_link_codes_code_hash" ON "agent_link_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "ix_agent_link_codes_agent_id" ON "agent_link_codes" USING btree ("agent_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_agents_owner_user_id" ON "agents" USING btree ("owner_user_id");