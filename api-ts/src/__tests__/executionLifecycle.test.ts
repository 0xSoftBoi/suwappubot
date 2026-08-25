import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/pglite'
import type { DbClient } from '../db/client'
import {
	executionEvents,
	executionIntents,
	executionOutbox,
	executionParentOrders,
	executionSettlements,
} from '../db/schema/execution'
import {
	ExecutionIdempotencyConflictError,
	ExecutionStateConflictError,
	listParentsNeedingReconciliation,
	persistInstitutionalDecision,
	preflightInstitutionalOrder,
	reconcileAuthoritativeSettlement,
	recordSettlementObservation,
	transitionParentOrder,
} from '../lib/executionLifecycle'
import { buildInstitutionalDecisionAuditRecord } from '../lib/routeDecisionAudit'
import {
	decideInstitutionalRoute,
	INSTITUTIONAL_SHADOW_POLICY_V1,
	type ControlledRouteCandidate,
} from '../lib/routeFeasibility'

const NOW_MS = 1_800_000_000_000

let pg: PGlite
let db: DbClient

async function createExecutionSchema(): Promise<void> {
	await pg.exec(`
		CREATE TABLE execution_intents (
			id varchar(36) PRIMARY KEY,
			user_id integer,
			principal_key varchar(160) NOT NULL,
			idempotency_key varchar(128),
			intent_type varchar(40) NOT NULL,
			side varchar(12),
			amount_mode varchar(24),
			from_chain varchar(50),
			to_chain varchar(50),
			from_asset varchar(128),
			to_asset varchar(128),
			requested_quantity varchar(78),
			quantity_asset varchar(128),
			requested_notional varchar(78),
			constraints_json jsonb,
			metadata_json jsonb,
			created_at timestamp DEFAULT now() NOT NULL,
			updated_at timestamp DEFAULT now() NOT NULL,
			UNIQUE (principal_key, idempotency_key)
		);

		CREATE TABLE execution_candidate_plans (
			id varchar(36) PRIMARY KEY,
			intent_id varchar(36) NOT NULL REFERENCES execution_intents(id),
			ordinal integer NOT NULL,
			substrate varchar(40) NOT NULL,
			provider varchar(80),
			strategy varchar(80),
			feasible boolean DEFAULT true NOT NULL,
			rejection_code varchar(80),
			expected_to_amount varchar(78),
			expected_cost_bps varchar(78),
			expected_duration_ms integer,
			plan_json jsonb,
			cost_json jsonb,
			selected boolean DEFAULT false NOT NULL,
			quote_expires_at timestamp,
			created_at timestamp DEFAULT now() NOT NULL,
			UNIQUE (intent_id, ordinal)
		);

		CREATE TABLE execution_parent_orders (
			id varchar(36) PRIMARY KEY,
			intent_id varchar(36) NOT NULL REFERENCES execution_intents(id),
			selected_candidate_id varchar(36) REFERENCES execution_candidate_plans(id),
			resubmission_of_parent_id varchar(36),
			source_type varchar(40),
			source_ref varchar(160),
			state varchar(24) DEFAULT 'draft' NOT NULL,
			state_version integer DEFAULT 0 NOT NULL,
			strategy varchar(80),
			authorization_method varchar(40),
			requested_quantity varchar(78),
			quantity_asset varchar(128),
			filled_quantity varchar(78) DEFAULT '0' NOT NULL,
			average_fill_price varchar(78),
			submit_idempotency_key varchar(128),
			request_fingerprint varchar(128),
			started_at timestamp,
			completed_at timestamp,
			created_at timestamp DEFAULT now() NOT NULL,
			updated_at timestamp DEFAULT now() NOT NULL,
			UNIQUE (intent_id, submit_idempotency_key),
			UNIQUE (source_type, source_ref)
		);

		CREATE TABLE execution_settlements (
			id varchar(36) PRIMARY KEY,
			parent_order_id varchar(36) NOT NULL REFERENCES execution_parent_orders(id),
			child_placement_id varchar(36),
			settlement_type varchar(40) NOT NULL,
			external_source varchar(80) NOT NULL,
			external_ref varchar(255) NOT NULL,
			state varchar(32) DEFAULT 'pending' NOT NULL,
			chain varchar(50),
			asset varchar(128),
			amount varchar(78),
			confirmations integer,
			finality_target integer,
			recovery_json jsonb,
			created_at timestamp DEFAULT now() NOT NULL,
			updated_at timestamp DEFAULT now() NOT NULL,
			UNIQUE (external_source, external_ref, settlement_type)
		);

		CREATE TABLE execution_events (
			id varchar(36) PRIMARY KEY,
			parent_order_id varchar(36) NOT NULL REFERENCES execution_parent_orders(id),
			sequence integer NOT NULL,
			event_type varchar(64) NOT NULL,
			from_state varchar(24),
			to_state varchar(24),
			payload_json jsonb,
			actor_type varchar(24),
			actor_id varchar(160),
			correlation_id varchar(128),
			causation_id varchar(128),
			occurred_at timestamp DEFAULT now() NOT NULL,
			UNIQUE (parent_order_id, sequence)
		);

		CREATE TABLE execution_outbox (
			id varchar(36) PRIMARY KEY,
			event_id varchar(36) NOT NULL REFERENCES execution_events(id),
			topic varchar(128) NOT NULL,
			payload_json jsonb,
			attempts integer DEFAULT 0 NOT NULL,
			published_at timestamp,
			next_attempt_at timestamp,
			last_error text,
			created_at timestamp DEFAULT now() NOT NULL,
			UNIQUE (event_id)
		);
	`)
}

function candidate(overrides: Partial<ControlledRouteCandidate> = {}): ControlledRouteCandidate {
	return {
		id: 'cctp-fast',
		rank: 0,
		fromChain: '1',
		toChain: '8453',
		provider: 'circle',
		tool: 'Circle CCTP',
		settlementType: 'issuer_native',
		quotedToAmountUsd: 99_950,
		quotedGasUsd: 3,
		quotedFeeUsd: 47,
		quotedDurationS: 30,
		quoteTimestampMs: NOW_MS - 1_000,
		expiresAtMs: NOW_MS + 30_000,
		capacityUsd: 5_000_000,
		recoveryAvailable: true,
		authorizationSatisfied: true,
		venueStatus: 'healthy',
		eligibilityStatus: 'allowed',
		dataConfidence: 0.999,
		...overrides,
	}
}

function decisionRecord(route = candidate()) {
	const decision = decideInstitutionalRoute(
		[route],
		INSTITUTIONAL_SHADOW_POLICY_V1,
		{ nowMs: NOW_MS, orderNotionalUsd: 100_000 },
	)
	return buildInstitutionalDecisionAuditRecord([route], decision, {
		optimizerVersion: 'best-execution/v1',
		policyDigest: 'policy-sha256',
		buildVersion: 'test-build',
	})
}

async function persist(record = decisionRecord()) {
	return persistInstitutionalDecision(db, {
		intent: {
			principalKey: 'institution:portfolio:42',
			idempotencyKey: 'intent-001',
			intentType: 'cross_chain_swap',
			fromChain: '1',
			toChain: '8453',
			fromAsset: 'USDC',
			toAsset: 'USDC',
			requestedNotional: '100000',
		},
		decision: record,
		submitIdempotencyKey: 'submit-001',
		authorizationMethod: 'policy+operator',
	})
}

beforeEach(async () => {
	pg = new PGlite()
	await createExecutionSchema()
	db = drizzle(pg) as unknown as DbClient
})

afterEach(async () => {
	await pg.close()
})

describe('database-authoritative execution lifecycle', () => {
	test('same intent/submit retry returns one durable parent, event, and outbox row', async () => {
		const first = await persist()
		const second = await persist()

		expect(first.created).toBe(true)
		expect(second.created).toBe(false)
		expect(second.parentOrder?.id).toBe(first.parentOrder?.id)
		expect(await db.select().from(executionIntents)).toHaveLength(1)
		expect(await db.select().from(executionParentOrders)).toHaveLength(1)
		expect(await db.select().from(executionEvents)).toHaveLength(1)
		expect(await db.select().from(executionOutbox)).toHaveLength(1)
	})

	test('same idempotency key with a changed decision is rejected', async () => {
		await persist()
		const changed = decisionRecord(candidate({ quotedToAmountUsd: 98_000 }))

		await expect(persist(changed)).rejects.toBeInstanceOf(ExecutionIdempotencyConflictError)
		expect(await db.select().from(executionParentOrders)).toHaveLength(1)
	})

	test('CAS transition prevents a stale worker and atomically appends outbox event', async () => {
		const persisted = await persist()
		const parent = persisted.parentOrder!

		const authorized = await transitionParentOrder(db, {
			parentOrderId: parent.id,
			expectedState: 'draft',
			expectedVersion: 1,
			toState: 'authorized',
			eventType: 'authorized',
			actorType: 'operator',
			actorId: 'maker-checker:7',
		})
		expect(authorized.stateVersion).toBe(2)

		await expect(
			transitionParentOrder(db, {
				parentOrderId: parent.id,
				expectedState: 'draft',
				expectedVersion: 1,
				toState: 'authorized',
				eventType: 'authorized',
			}),
		).rejects.toBeInstanceOf(ExecutionStateConflictError)

		expect(await db.select().from(executionEvents)).toHaveLength(2)
		expect(await db.select().from(executionOutbox)).toHaveLength(2)
	})

	test('preflight revalidates the fresh route and persists its digest before submit', async () => {
		const record = decisionRecord()
		const persisted = await persist(record)
		const parent = persisted.parentOrder!
		await transitionParentOrder(db, {
			parentOrderId: parent.id,
			expectedState: 'draft',
			expectedVersion: 1,
			toState: 'authorized',
			eventType: 'authorized',
		})

		const result = await preflightInstitutionalOrder(db, {
			parentOrderId: parent.id,
			expectedVersion: 2,
			expectedDecisionDigest: record.digest,
			freshCandidate: candidate(),
			policy: INSTITUTIONAL_SHADOW_POLICY_V1,
			context: { nowMs: NOW_MS, orderNotionalUsd: 100_000 },
		})

		expect(result.parentOrder.state).toBe('preflight_validated')
		expect(result.parentOrder.stateVersion).toBe(3)
		expect(result.preflightDigest).toHaveLength(64)
	})

	test('duplicate settlement callback is idempotent, regression is rejected, restart reconciliation closes only destination-confirmed state', async () => {
		const record = decisionRecord()
		const persisted = await persist(record)
		const parent = persisted.parentOrder!
		const authorized = await transitionParentOrder(db, {
			parentOrderId: parent.id,
			expectedState: 'draft',
			expectedVersion: 1,
			toState: 'authorized',
			eventType: 'authorized',
		})
		const preflight = await preflightInstitutionalOrder(db, {
			parentOrderId: parent.id,
			expectedVersion: authorized.stateVersion,
			expectedDecisionDigest: record.digest,
			freshCandidate: candidate(),
			policy: INSTITUTIONAL_SHADOW_POLICY_V1,
			context: { nowMs: NOW_MS, orderNotionalUsd: 100_000 },
		})
		const submitting = await transitionParentOrder(db, {
			parentOrderId: parent.id,
			expectedState: 'preflight_validated',
			expectedVersion: preflight.parentOrder.stateVersion,
			toState: 'submitting',
			eventType: 'submitting',
		})
		const submitted = await transitionParentOrder(db, {
			parentOrderId: parent.id,
			expectedState: 'submitting',
			expectedVersion: submitting.stateVersion,
			toState: 'submitted',
			eventType: 'submitted',
		})
		const sourceConfirmed = await transitionParentOrder(db, {
			parentOrderId: parent.id,
			expectedState: 'submitted',
			expectedVersion: submitted.stateVersion,
			toState: 'source_confirmed',
			eventType: 'source_confirmed',
		})

		const observation = {
			parentOrderId: parent.id,
			settlementType: 'cctp_mint',
			externalSource: 'circle',
			externalRef: 'message-0xabc',
			state: 'pending' as const,
			chain: '8453',
			asset: 'USDC',
			amount: '100000',
		}
		const first = await recordSettlementObservation(db, observation)
		const duplicate = await recordSettlementObservation(db, observation)
		expect(first.duplicate).toBe(false)
		expect(duplicate.duplicate).toBe(true)
		expect(await db.select().from(executionSettlements)).toHaveLength(1)

		await recordSettlementObservation(db, { ...observation, state: 'destination_confirmed' })
		await expect(recordSettlementObservation(db, observation)).rejects.toBeInstanceOf(
			ExecutionStateConflictError,
		)

		const restartQueue = await listParentsNeedingReconciliation(db)
		expect(restartQueue.map((row) => row.id)).toContain(parent.id)

		const settled = await reconcileAuthoritativeSettlement(db, {
			parentOrderId: parent.id,
			expectedParentState: 'source_confirmed',
			expectedParentVersion: sourceConfirmed.stateVersion,
			settlementType: 'cctp_mint',
			externalSource: 'circle',
			externalRef: 'message-0xabc',
		})
		expect(settled.state).toBe('settled')
		expect(settled.completedAt).toBeInstanceOf(Date)
		expect(await listParentsNeedingReconciliation(db)).toHaveLength(0)
	})
})
