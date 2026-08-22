import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const executionIntents = pgTable(
	'execution_intents',
	{
		id: varchar('id', { length: 36 }).primaryKey(),
		userId: integer('user_id').references(() => users.id),
		principalKey: varchar('principal_key', { length: 160 }).notNull(),
		idempotencyKey: varchar('idempotency_key', { length: 128 }),
		intentType: varchar('intent_type', { length: 40 }).notNull(),
		side: varchar('side', { length: 12 }),
		fromChain: varchar('from_chain', { length: 50 }),
		toChain: varchar('to_chain', { length: 50 }),
		fromAsset: varchar('from_asset', { length: 128 }),
		toAsset: varchar('to_asset', { length: 128 }),
		requestedQuantity: varchar('requested_quantity', { length: 78 }),
		requestedNotional: varchar('requested_notional', { length: 78 }),
		constraintsJson: jsonb('constraints_json'),
		metadataJson: jsonb('metadata_json'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => ({
		userIdx: index('ix_execution_intents_user_id').on(table.userId),
		principalIdx: index('ix_execution_intents_principal_key').on(table.principalKey),
		principalIdempotency: uniqueIndex('uq_exec_intent_principal_idempotency').on(
			table.principalKey,
			table.idempotencyKey,
		),
	}),
)

export const executionCandidatePlans = pgTable(
	'execution_candidate_plans',
	{
		id: varchar('id', { length: 36 }).primaryKey(),
		intentId: varchar('intent_id', { length: 36 })
			.notNull()
			.references(() => executionIntents.id),
		ordinal: integer('ordinal').notNull(),
		substrate: varchar('substrate', { length: 40 }).notNull(),
		provider: varchar('provider', { length: 80 }),
		strategy: varchar('strategy', { length: 80 }),
		feasible: boolean('feasible').default(true).notNull(),
		rejectionCode: varchar('rejection_code', { length: 80 }),
		expectedToAmount: varchar('expected_to_amount', { length: 78 }),
		expectedCostBps: varchar('expected_cost_bps', { length: 78 }),
		expectedDurationMs: integer('expected_duration_ms'),
		planJson: jsonb('plan_json'),
		costJson: jsonb('cost_json'),
		selected: boolean('selected').default(false).notNull(),
		quoteExpiresAt: timestamp('quote_expires_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		intentIdx: index('ix_execution_candidate_plans_intent_id').on(table.intentId),
		intentOrdinal: uniqueIndex('uq_exec_candidate_intent_ordinal').on(
			table.intentId,
			table.ordinal,
		),
		selectedIdx: index('ix_exec_candidate_intent_selected').on(table.intentId, table.selected),
	}),
)

export const executionParentOrders = pgTable(
	'execution_parent_orders',
	{
		id: varchar('id', { length: 36 }).primaryKey(),
		intentId: varchar('intent_id', { length: 36 })
			.notNull()
			.references(() => executionIntents.id),
		selectedCandidateId: varchar('selected_candidate_id', { length: 36 }).references(
			() => executionCandidatePlans.id,
		),
		// SQLAlchemy owns the self-FK. Drizzle mirrors the column without a
		// recursive reference to keep the schema module initialization simple.
		resubmissionOfParentId: varchar('resubmission_of_parent_id', { length: 36 }),
		state: varchar('state', { length: 24 }).default('draft').notNull(),
		stateVersion: integer('state_version').default(0).notNull(),
		strategy: varchar('strategy', { length: 80 }),
		authorizationMethod: varchar('authorization_method', { length: 40 }),
		requestedQuantity: varchar('requested_quantity', { length: 78 }),
		filledQuantity: varchar('filled_quantity', { length: 78 }).default('0').notNull(),
		averageFillPrice: varchar('average_fill_price', { length: 78 }),
		submitIdempotencyKey: varchar('submit_idempotency_key', { length: 128 }),
		requestFingerprint: varchar('request_fingerprint', { length: 128 }),
		startedAt: timestamp('started_at'),
		completedAt: timestamp('completed_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => ({
		intentIdx: index('ix_execution_parent_orders_intent_id').on(table.intentId),
		candidateIdx: index('ix_execution_parent_orders_selected_candidate_id').on(
			table.selectedCandidateId,
		),
		resubmissionIdx: index('ix_execution_parent_orders_resubmission_of_parent_id').on(
			table.resubmissionOfParentId,
		),
		intentSubmitKey: uniqueIndex('uq_exec_parent_intent_submit_key').on(
			table.intentId,
			table.submitIdempotencyKey,
		),
		stateUpdatedIdx: index('ix_exec_parent_state_updated').on(table.state, table.updatedAt),
	}),
)

export const executionChildPlacements = pgTable(
	'execution_child_placements',
	{
		id: varchar('id', { length: 36 }).primaryKey(),
		parentOrderId: varchar('parent_order_id', { length: 36 })
			.notNull()
			.references(() => executionParentOrders.id),
		childSequence: integer('child_sequence').notNull(),
		substrate: varchar('substrate', { length: 40 }).notNull(),
		provider: varchar('provider', { length: 80 }),
		venue: varchar('venue', { length: 80 }),
		chain: varchar('chain', { length: 50 }),
		side: varchar('side', { length: 12 }),
		requestedQuantity: varchar('requested_quantity', { length: 78 }),
		limitPrice: varchar('limit_price', { length: 78 }),
		state: varchar('state', { length: 32 }).default('created').notNull(),
		idempotencyKey: varchar('idempotency_key', { length: 128 }),
		requestFingerprint: varchar('request_fingerprint', { length: 128 }),
		externalOrderId: varchar('external_order_id', { length: 255 }),
		externalTxHash: varchar('external_tx_hash', { length: 255 }),
		externalIntentId: varchar('external_intent_id', { length: 255 }),
		submittedAt: timestamp('submitted_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => ({
		parentIdx: index('ix_execution_child_placements_parent_order_id').on(table.parentOrderId),
		parentSequence: uniqueIndex('uq_exec_child_parent_sequence').on(
			table.parentOrderId,
			table.childSequence,
		),
		providerOrder: uniqueIndex('uq_exec_child_provider_order').on(
			table.provider,
			table.externalOrderId,
		),
		parentStateIdx: index('ix_exec_child_parent_state').on(table.parentOrderId, table.state),
	}),
)

export const executionFills = pgTable(
	'execution_fills',
	{
		id: varchar('id', { length: 36 }).primaryKey(),
		parentOrderId: varchar('parent_order_id', { length: 36 })
			.notNull()
			.references(() => executionParentOrders.id),
		childPlacementId: varchar('child_placement_id', { length: 36 }).references(
			() => executionChildPlacements.id,
		),
		externalSource: varchar('external_source', { length: 80 }).notNull(),
		externalFillId: varchar('external_fill_id', { length: 255 }),
		quantity: varchar('quantity', { length: 78 }).notNull(),
		price: varchar('price', { length: 78 }).notNull(),
		feeAmount: varchar('fee_amount', { length: 78 }),
		feeAsset: varchar('fee_asset', { length: 128 }),
		liquidityRole: varchar('liquidity_role', { length: 16 }),
		metadataJson: jsonb('metadata_json'),
		occurredAt: timestamp('occurred_at').notNull(),
		observedAt: timestamp('observed_at').defaultNow().notNull(),
	},
	(table) => ({
		parentIdx: index('ix_execution_fills_parent_order_id').on(table.parentOrderId),
		childIdx: index('ix_execution_fills_child_placement_id').on(table.childPlacementId),
		sourceFill: uniqueIndex('uq_exec_fill_source_external').on(
			table.externalSource,
			table.externalFillId,
		),
		parentOccurredIdx: index('ix_exec_fill_parent_occurred').on(
			table.parentOrderId,
			table.occurredAt,
		),
	}),
)

export const executionSettlements = pgTable(
	'execution_settlements',
	{
		id: varchar('id', { length: 36 }).primaryKey(),
		parentOrderId: varchar('parent_order_id', { length: 36 })
			.notNull()
			.references(() => executionParentOrders.id),
		childPlacementId: varchar('child_placement_id', { length: 36 }).references(
			() => executionChildPlacements.id,
		),
		settlementType: varchar('settlement_type', { length: 40 }).notNull(),
		externalSource: varchar('external_source', { length: 80 }).notNull(),
		externalRef: varchar('external_ref', { length: 255 }).notNull(),
		state: varchar('state', { length: 32 }).default('pending').notNull(),
		chain: varchar('chain', { length: 50 }),
		asset: varchar('asset', { length: 128 }),
		amount: varchar('amount', { length: 78 }),
		confirmations: integer('confirmations'),
		finalityTarget: integer('finality_target'),
		recoveryJson: jsonb('recovery_json'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => ({
		parentIdx: index('ix_execution_settlements_parent_order_id').on(table.parentOrderId),
		childIdx: index('ix_execution_settlements_child_placement_id').on(table.childPlacementId),
		externalKey: uniqueIndex('uq_exec_settlement_external').on(
			table.externalSource,
			table.externalRef,
			table.settlementType,
		),
		parentStateIdx: index('ix_exec_settlement_parent_state').on(
			table.parentOrderId,
			table.state,
		),
	}),
)

export const executionEvents = pgTable(
	'execution_events',
	{
		id: varchar('id', { length: 36 }).primaryKey(),
		parentOrderId: varchar('parent_order_id', { length: 36 })
			.notNull()
			.references(() => executionParentOrders.id),
		sequence: integer('sequence').notNull(),
		eventType: varchar('event_type', { length: 64 }).notNull(),
		fromState: varchar('from_state', { length: 24 }),
		toState: varchar('to_state', { length: 24 }),
		payloadJson: jsonb('payload_json'),
		actorType: varchar('actor_type', { length: 24 }),
		actorId: varchar('actor_id', { length: 160 }),
		correlationId: varchar('correlation_id', { length: 128 }),
		causationId: varchar('causation_id', { length: 128 }),
		occurredAt: timestamp('occurred_at').defaultNow().notNull(),
	},
	(table) => ({
		parentIdx: index('ix_execution_events_parent_order_id').on(table.parentOrderId),
		correlationIdx: index('ix_execution_events_correlation_id').on(table.correlationId),
		parentSequence: uniqueIndex('uq_exec_event_parent_sequence').on(
			table.parentOrderId,
			table.sequence,
		),
		parentOccurredIdx: index('ix_exec_event_parent_occurred').on(
			table.parentOrderId,
			table.occurredAt,
		),
	}),
)

export const executionOutbox = pgTable(
	'execution_outbox',
	{
		id: varchar('id', { length: 36 }).primaryKey(),
		eventId: varchar('event_id', { length: 36 })
			.notNull()
			.references(() => executionEvents.id),
		topic: varchar('topic', { length: 128 }).notNull(),
		payloadJson: jsonb('payload_json'),
		attempts: integer('attempts').default(0).notNull(),
		publishedAt: timestamp('published_at'),
		nextAttemptAt: timestamp('next_attempt_at'),
		lastError: text('last_error'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		eventUnique: uniqueIndex('uq_execution_outbox_event_id').on(table.eventId),
		publishIdx: index('ix_exec_outbox_publish').on(table.publishedAt, table.nextAttemptAt),
	}),
)

export type ExecutionIntent = typeof executionIntents.$inferSelect
export type NewExecutionIntent = typeof executionIntents.$inferInsert
export type ExecutionCandidatePlan = typeof executionCandidatePlans.$inferSelect
export type ExecutionParentOrder = typeof executionParentOrders.$inferSelect
export type ExecutionChildPlacement = typeof executionChildPlacements.$inferSelect
export type ExecutionFill = typeof executionFills.$inferSelect
export type ExecutionSettlement = typeof executionSettlements.$inferSelect
export type ExecutionEvent = typeof executionEvents.$inferSelect
