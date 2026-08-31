CREATE TABLE "execution_candidate_plans" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"intent_id" varchar(36) NOT NULL,
	"ordinal" integer NOT NULL,
	"substrate" varchar(40) NOT NULL,
	"provider" varchar(80),
	"strategy" varchar(80),
	"feasible" boolean DEFAULT true NOT NULL,
	"rejection_code" varchar(80),
	"expected_to_amount" varchar(78),
	"expected_cost_bps" varchar(78),
	"expected_duration_ms" integer,
	"plan_json" jsonb,
	"cost_json" jsonb,
	"selected" boolean DEFAULT false NOT NULL,
	"quote_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_child_placements" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"parent_order_id" varchar(36) NOT NULL,
	"child_sequence" integer NOT NULL,
	"substrate" varchar(40) NOT NULL,
	"provider" varchar(80),
	"venue" varchar(80),
	"chain" varchar(50),
	"side" varchar(12),
	"requested_quantity" varchar(78),
	"quantity_asset" varchar(128),
	"limit_price" varchar(78),
	"state" varchar(32) DEFAULT 'created' NOT NULL,
	"idempotency_key" varchar(128),
	"request_fingerprint" varchar(128),
	"external_order_id" varchar(255),
	"external_tx_hash" varchar(255),
	"external_intent_id" varchar(255),
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"parent_order_id" varchar(36) NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"from_state" varchar(24),
	"to_state" varchar(24),
	"payload_json" jsonb,
	"actor_type" varchar(24),
	"actor_id" varchar(160),
	"correlation_id" varchar(128),
	"causation_id" varchar(128),
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_fills" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"parent_order_id" varchar(36) NOT NULL,
	"child_placement_id" varchar(36),
	"external_source" varchar(80) NOT NULL,
	"external_fill_id" varchar(255),
	"quantity" varchar(78) NOT NULL,
	"quantity_asset" varchar(128),
	"price" varchar(78) NOT NULL,
	"price_asset" varchar(128),
	"input_asset" varchar(128),
	"input_amount" varchar(78),
	"output_asset" varchar(128),
	"output_amount" varchar(78),
	"fee_amount" varchar(78),
	"fee_asset" varchar(128),
	"liquidity_role" varchar(16),
	"metadata_json" jsonb,
	"occurred_at" timestamp NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_intents" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" integer,
	"principal_key" varchar(160) NOT NULL,
	"idempotency_key" varchar(128),
	"intent_type" varchar(40) NOT NULL,
	"side" varchar(12),
	"amount_mode" varchar(24),
	"from_chain" varchar(50),
	"to_chain" varchar(50),
	"from_asset" varchar(128),
	"to_asset" varchar(128),
	"requested_quantity" varchar(78),
	"quantity_asset" varchar(128),
	"requested_notional" varchar(78),
	"constraints_json" jsonb,
	"metadata_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_outbox" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"event_id" varchar(36) NOT NULL,
	"topic" varchar(128) NOT NULL,
	"payload_json" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp,
	"next_attempt_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_parent_orders" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"intent_id" varchar(36) NOT NULL,
	"selected_candidate_id" varchar(36),
	"resubmission_of_parent_id" varchar(36),
	"source_type" varchar(40),
	"source_ref" varchar(160),
	"state" varchar(24) DEFAULT 'draft' NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"strategy" varchar(80),
	"authorization_method" varchar(40),
	"requested_quantity" varchar(78),
	"quantity_asset" varchar(128),
	"filled_quantity" varchar(78) DEFAULT '0' NOT NULL,
	"average_fill_price" varchar(78),
	"submit_idempotency_key" varchar(128),
	"request_fingerprint" varchar(128),
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_settlements" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"parent_order_id" varchar(36) NOT NULL,
	"child_placement_id" varchar(36),
	"settlement_type" varchar(40) NOT NULL,
	"external_source" varchar(80) NOT NULL,
	"external_ref" varchar(255) NOT NULL,
	"state" varchar(32) DEFAULT 'pending' NOT NULL,
	"chain" varchar(50),
	"asset" varchar(128),
	"amount" varchar(78),
	"confirmations" integer,
	"finality_target" integer,
	"recovery_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_allowlist_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"chain" varchar(50) NOT NULL,
	"address" varchar(255) NOT NULL,
	"label" varchar(100),
	"added_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_allowlist_addresses_org_id_chain_address_unique" UNIQUE("org_id","chain","address")
);
--> statement-breakpoint
CREATE TABLE "org_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"policy_type" varchar(30) NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"required_approvals" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"policy_id" uuid,
	"requested_by" integer,
	"request_type" varchar(30) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"required_approvals" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"approver_user_id" integer NOT NULL,
	"decision" varchar(10) NOT NULL,
	"comment" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "policy_approvals_request_id_approver_user_id_unique" UNIQUE("request_id","approver_user_id")
);
--> statement-breakpoint
ALTER TABLE "execution_candidate_plans" ADD CONSTRAINT "execution_candidate_plans_intent_id_execution_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."execution_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_child_placements" ADD CONSTRAINT "execution_child_placements_parent_order_id_execution_parent_orders_id_fk" FOREIGN KEY ("parent_order_id") REFERENCES "public"."execution_parent_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_parent_order_id_execution_parent_orders_id_fk" FOREIGN KEY ("parent_order_id") REFERENCES "public"."execution_parent_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_fills" ADD CONSTRAINT "execution_fills_parent_order_id_execution_parent_orders_id_fk" FOREIGN KEY ("parent_order_id") REFERENCES "public"."execution_parent_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_fills" ADD CONSTRAINT "execution_fills_child_placement_id_execution_child_placements_id_fk" FOREIGN KEY ("child_placement_id") REFERENCES "public"."execution_child_placements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_intents" ADD CONSTRAINT "execution_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_outbox" ADD CONSTRAINT "execution_outbox_event_id_execution_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."execution_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_parent_orders" ADD CONSTRAINT "execution_parent_orders_intent_id_execution_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."execution_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_parent_orders" ADD CONSTRAINT "execution_parent_orders_selected_candidate_id_execution_candidate_plans_id_fk" FOREIGN KEY ("selected_candidate_id") REFERENCES "public"."execution_candidate_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_settlements" ADD CONSTRAINT "execution_settlements_parent_order_id_execution_parent_orders_id_fk" FOREIGN KEY ("parent_order_id") REFERENCES "public"."execution_parent_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_settlements" ADD CONSTRAINT "execution_settlements_child_placement_id_execution_child_placements_id_fk" FOREIGN KEY ("child_placement_id") REFERENCES "public"."execution_child_placements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_allowlist_addresses" ADD CONSTRAINT "org_allowlist_addresses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_allowlist_addresses" ADD CONSTRAINT "org_allowlist_addresses_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_policies" ADD CONSTRAINT "org_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_policies" ADD CONSTRAINT "org_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_approval_requests" ADD CONSTRAINT "policy_approval_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_approval_requests" ADD CONSTRAINT "policy_approval_requests_policy_id_org_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."org_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_approval_requests" ADD CONSTRAINT "policy_approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_approvals" ADD CONSTRAINT "policy_approvals_request_id_policy_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."policy_approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_approvals" ADD CONSTRAINT "policy_approvals_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_execution_candidate_plans_intent_id" ON "execution_candidate_plans" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_exec_candidate_intent_ordinal" ON "execution_candidate_plans" USING btree ("intent_id","ordinal");--> statement-breakpoint
CREATE INDEX "ix_exec_candidate_intent_selected" ON "execution_candidate_plans" USING btree ("intent_id","selected");--> statement-breakpoint
CREATE INDEX "ix_execution_child_placements_parent_order_id" ON "execution_child_placements" USING btree ("parent_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_exec_child_parent_sequence" ON "execution_child_placements" USING btree ("parent_order_id","child_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_exec_child_provider_order" ON "execution_child_placements" USING btree ("provider","external_order_id");--> statement-breakpoint
CREATE INDEX "ix_exec_child_parent_state" ON "execution_child_placements" USING btree ("parent_order_id","state");--> statement-breakpoint
CREATE INDEX "ix_execution_events_parent_order_id" ON "execution_events" USING btree ("parent_order_id");--> statement-breakpoint
CREATE INDEX "ix_execution_events_correlation_id" ON "execution_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_exec_event_parent_sequence" ON "execution_events" USING btree ("parent_order_id","sequence");--> statement-breakpoint
CREATE INDEX "ix_exec_event_parent_occurred" ON "execution_events" USING btree ("parent_order_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_execution_fills_parent_order_id" ON "execution_fills" USING btree ("parent_order_id");--> statement-breakpoint
CREATE INDEX "ix_execution_fills_child_placement_id" ON "execution_fills" USING btree ("child_placement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_exec_fill_source_external" ON "execution_fills" USING btree ("external_source","external_fill_id");--> statement-breakpoint
CREATE INDEX "ix_exec_fill_parent_occurred" ON "execution_fills" USING btree ("parent_order_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_execution_intents_user_id" ON "execution_intents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_execution_intents_principal_key" ON "execution_intents" USING btree ("principal_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_exec_intent_principal_idempotency" ON "execution_intents" USING btree ("principal_key","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_execution_outbox_event_id" ON "execution_outbox" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ix_exec_outbox_publish" ON "execution_outbox" USING btree ("published_at","next_attempt_at");--> statement-breakpoint
CREATE INDEX "ix_execution_parent_orders_intent_id" ON "execution_parent_orders" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "ix_execution_parent_orders_selected_candidate_id" ON "execution_parent_orders" USING btree ("selected_candidate_id");--> statement-breakpoint
CREATE INDEX "ix_execution_parent_orders_resubmission_of_parent_id" ON "execution_parent_orders" USING btree ("resubmission_of_parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_exec_parent_intent_submit_key" ON "execution_parent_orders" USING btree ("intent_id","submit_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_exec_parent_source_ref" ON "execution_parent_orders" USING btree ("source_type","source_ref");--> statement-breakpoint
CREATE INDEX "ix_exec_parent_state_updated" ON "execution_parent_orders" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "ix_execution_settlements_parent_order_id" ON "execution_settlements" USING btree ("parent_order_id");--> statement-breakpoint
CREATE INDEX "ix_execution_settlements_child_placement_id" ON "execution_settlements" USING btree ("child_placement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_exec_settlement_external" ON "execution_settlements" USING btree ("external_source","external_ref","settlement_type");--> statement-breakpoint
CREATE INDEX "ix_exec_settlement_parent_state" ON "execution_settlements" USING btree ("parent_order_id","state");--> statement-breakpoint
CREATE INDEX "org_allowlist_addresses_org_idx" ON "org_allowlist_addresses" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_policies_org_idx" ON "org_policies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_policies_org_enabled_idx" ON "org_policies" USING btree ("org_id","enabled");--> statement-breakpoint
CREATE INDEX "policy_approval_requests_org_status_idx" ON "policy_approval_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "policy_approval_requests_policy_idx" ON "policy_approval_requests" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "policy_approvals_request_idx" ON "policy_approvals" USING btree ("request_id");