import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/pglite'
import type { DbClient } from '../db/client'
import {
	executionChildPlacements,
	executionEvents,
	executionOutbox,
	executionParentOrders,
} from '../db/schema/execution'
import {
	ExecutionIdempotencyConflictError,
	ExecutionLifecycleError,
	ExecutionPreflightError,
} from '../lib/executionLifecycle'
import {
	listSubmissionAttemptsNeedingReconciliation,
	markSubmissionIndeterminate,
	prepareChildSubmission,
	recordSubmissionAcknowledgement,
} from '../lib/executionSubmission'

let pg: PGlite
let db: DbClient

const PARENT_ID = '00000000-0000-0000-0000-000000000100'
const INTENT_ID = '00000000-0000-0000-0000-000000000101'
const CANDIDATE_ID = '00000000-0000-0000-0000-000000000102'

async function createSchema(): Promise<void> {
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

		CREATE TABLE execution_child_placements (
			id varchar(36) PRIMARY KEY,
			parent_order_id varchar(36) NOT NULL REFERENCES execution_parent_orders(id),
			child_sequence integer NOT NULL,
			substrate varchar(40) NOT NULL,
			provider varchar(80),
			venue varchar(80),
			chain varchar(50),
			side varchar(12),
			requested_quantity varchar(78),
			quantity_asset varchar(128),
			limit_price varchar(78),
			state varchar(32) DEFAULT 'created' NOT NULL,
			idempotency_key varchar(128),
			request_fingerprint varchar(128),
			external_order_id varchar(255),
			external_tx_hash varchar(255),
			external_intent_id varchar(255),
			submitted_at timestamp,
			created_at timestamp DEFAULT now() NOT NULL,
			updated_at timestamp DEFAULT now() NOT NULL,
			UNIQUE (parent_order_id, child_sequence),
			UNIQUE (provider, external_order_id)
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

	await pg.exec(`
		INSERT INTO execution_intents
			(id, principal_key, idempotency_key, intent_type, from_chain, to_chain, from_asset, to_asset, requested_notional)
		VALUES
			('${INTENT_ID}', 'institution:portfolio:42', 'intent-1', 'cross_chain_swap', '1', '8453', 'USDC', 'USDC', '100000');

		INSERT INTO execution_candidate_plans
			(id, intent_id, ordinal, substrate, provider, feasible, selected)
		VALUES
			('${CANDIDATE_ID}', '${INTENT_ID}', 0, 'issuer_native', 'circle', true, true);

		INSERT INTO execution_parent_orders
			(id, intent_id, selected_candidate_id, state, state_version, submit_idempotency_key, request_fingerprint)
		VALUES
			('${PARENT_ID}', '${INTENT_ID}', '${CANDIDATE_ID}', 'preflight_validated', 3, 'submit-1', 'decision-digest');
	`)
}

function prepareInput(overrides: Partial<Parameters<typeof prepareChildSubmission>[1]> = {}) {
	return {
		parentOrderId: PARENT_ID,
		expectedParentVersion: 3,
		childSequence: 0,
		idempotencyKey: 'child-submit-1',
		requestFingerprint: 'signed-plan-digest',
		substrate: 'issuer_native',
		provider: 'circle',
		venue: 'cctp',
		chain: '1',
		side: 'sell',
		requestedQuantity: '100000',
		quantityAsset: 'USDC',
		riskLimits: {
			maxOpenOrders: 10,
			maxSingleOrderNotionalUsd: 250_000,
			maxOpenNotionalUsd: 1_000_000,
		},
		...overrides,
	}
}

beforeEach(async () => {
	pg = new PGlite()
	await createSchema()
	db = drizzle(pg) as unknown as DbClient
})

afterEach(async () => {
	await pg.close()
})

describe('write-ahead submission fencing', () => {
	test('persists child before external call and atomically CASes parent to submitting', async () => {
		const prepared = await prepareChildSubmission(db, prepareInput())

		expect(prepared.replayRequiresReconciliation).toBe(false)
		expect(prepared.child.state).toBe('prepared')
		expect(prepared.parentOrder.state).toBe('submitting')
		expect(prepared.parentOrder.stateVersion).toBe(4)
		expect(await db.select().from(executionChildPlacements)).toHaveLength(1)
		expect(await db.select().from(executionEvents)).toHaveLength(1)
		expect(await db.select().from(executionOutbox)).toHaveLength(1)
	})

	test('principal risk limit blocks a new child inside the submission transaction', async () => {
		await expect(
			prepareChildSubmission(
				db,
				prepareInput({
					riskLimits: {
						maxOpenOrders: 10,
						maxSingleOrderNotionalUsd: 50_000,
						maxOpenNotionalUsd: 1_000_000,
					},
				}),
			),
		).rejects.toBeInstanceOf(ExecutionPreflightError)
		expect(await db.select().from(executionChildPlacements)).toHaveLength(0)
		expect(await db.select().from(executionEvents)).toHaveLength(0)
	})

	test('retry after write-ahead commit never grants permission to blindly submit again', async () => {
		const first = await prepareChildSubmission(db, prepareInput())
		const replay = await prepareChildSubmission(
			db,
			prepareInput({
				riskLimits: {
					maxOpenOrders: 1,
					maxSingleOrderNotionalUsd: 1,
					maxOpenNotionalUsd: 1,
				},
			}),
		)

		expect(first.replayRequiresReconciliation).toBe(false)
		expect(replay.replayRequiresReconciliation).toBe(true)
		expect(replay.child.id).toBe(first.child.id)
		expect(replay.parentOrder.state).toBe('submitting')
		expect(await db.select().from(executionChildPlacements)).toHaveLength(1)
		expect(await db.select().from(executionEvents)).toHaveLength(1)
		expect(await db.select().from(executionOutbox)).toHaveLength(1)
	})

	test('concurrent prepare workers collapse onto one durable child', async () => {
		const [a, b] = await Promise.all([
			prepareChildSubmission(db, prepareInput()),
			prepareChildSubmission(db, prepareInput()),
		])
		const outcomes = [a.replayRequiresReconciliation, b.replayRequiresReconciliation].sort()
		expect(outcomes).toEqual([false, true])
		expect(a.child.id).toBe(b.child.id)
		expect(await db.select().from(executionChildPlacements)).toHaveLength(1)
		expect(await db.select().from(executionEvents)).toHaveLength(1)
	})

	test('same child sequence with different terms is a hard idempotency conflict', async () => {
		await prepareChildSubmission(db, prepareInput())

		await expect(
			prepareChildSubmission(db, prepareInput({ requestFingerprint: 'different-plan' })),
		).rejects.toBeInstanceOf(ExecutionIdempotencyConflictError)
	})

	test('prepared attempts are discoverable after restart and are never auto-resubmitted', async () => {
		const prepared = await prepareChildSubmission(db, prepareInput())
		const queue = await listSubmissionAttemptsNeedingReconciliation(db)

		expect(queue).toHaveLength(1)
		expect(queue[0]?.parentOrder.id).toBe(PARENT_ID)
		expect(queue[0]?.child.id).toBe(prepared.child.id)
		expect(queue[0]?.child.externalTxHash).toBeNull()
	})

	test('timeout or transport failure becomes UNKNOWN/recovery_pending, never terminal failed', async () => {
		const prepared = await prepareChildSubmission(db, prepareInput())
		const unknown = await markSubmissionIndeterminate(db, {
			parentOrderId: PARENT_ID,
			expectedParentVersion: 4,
			childPlacementId: prepared.child.id,
			idempotencyKey: 'child-submit-1',
			requestFingerprint: 'signed-plan-digest',
			reasonCode: 'provider_timeout',
			detail: 'socket closed after request body was sent',
		})

		expect(unknown.child.state).toBe('unknown')
		expect(unknown.parentOrder.state).toBe('recovery_pending')
		expect(unknown.parentOrder.stateVersion).toBe(5)
		const queue = await listSubmissionAttemptsNeedingReconciliation(db)
		expect(queue).toHaveLength(1)
		expect(queue[0]?.child.state).toBe('unknown')
		expect(await db.select().from(executionEvents)).toHaveLength(2)
	})

	test('provider recovery may attach identity to UNKNOWN attempt without creating a second child', async () => {
		const prepared = await prepareChildSubmission(db, prepareInput())
		await markSubmissionIndeterminate(db, {
			parentOrderId: PARENT_ID,
			expectedParentVersion: 4,
			childPlacementId: prepared.child.id,
			idempotencyKey: 'child-submit-1',
			requestFingerprint: 'signed-plan-digest',
			reasonCode: 'http_500',
		})

		const recovered = await recordSubmissionAcknowledgement(db, {
			parentOrderId: PARENT_ID,
			expectedParentVersion: 5,
			childPlacementId: prepared.child.id,
			idempotencyKey: 'child-submit-1',
			requestFingerprint: 'signed-plan-digest',
			externalTxHash: '0xrecovered',
		})

		expect(recovered.child.id).toBe(prepared.child.id)
		expect(recovered.child.state).toBe('submitted')
		expect(recovered.parentOrder.state).toBe('submitted')
		expect(await db.select().from(executionChildPlacements)).toHaveLength(1)
		expect(await listSubmissionAttemptsNeedingReconciliation(db)).toHaveLength(0)
	})

	test('external acknowledgement requires identity and atomically moves child+parent to submitted', async () => {
		const prepared = await prepareChildSubmission(db, prepareInput())

		await expect(
			recordSubmissionAcknowledgement(db, {
				parentOrderId: PARENT_ID,
				expectedParentVersion: 4,
				childPlacementId: prepared.child.id,
				idempotencyKey: 'child-submit-1',
				requestFingerprint: 'signed-plan-digest',
			}),
		).rejects.toBeInstanceOf(ExecutionLifecycleError)

		const ack = await recordSubmissionAcknowledgement(db, {
			parentOrderId: PARENT_ID,
			expectedParentVersion: 4,
			childPlacementId: prepared.child.id,
			idempotencyKey: 'child-submit-1',
			requestFingerprint: 'signed-plan-digest',
			externalTxHash: '0xabc123',
		})

		expect(ack.duplicate).toBe(false)
		expect(ack.child.state).toBe('submitted')
		expect(ack.child.externalTxHash).toBe('0xabc123')
		expect(ack.parentOrder.state).toBe('submitted')
		expect(ack.parentOrder.stateVersion).toBe(5)
		expect(await listSubmissionAttemptsNeedingReconciliation(db)).toHaveLength(0)
		expect(await db.select().from(executionEvents)).toHaveLength(2)
		expect(await db.select().from(executionOutbox)).toHaveLength(2)
	})

	test('ack retry is idempotent but changing the external identity is rejected', async () => {
		const prepared = await prepareChildSubmission(db, prepareInput())
		const baseAck = {
			parentOrderId: PARENT_ID,
			expectedParentVersion: 4,
			childPlacementId: prepared.child.id,
			idempotencyKey: 'child-submit-1',
			requestFingerprint: 'signed-plan-digest',
			externalTxHash: '0xabc123',
		}
		await recordSubmissionAcknowledgement(db, baseAck)
		const duplicate = await recordSubmissionAcknowledgement(db, baseAck)
		expect(duplicate.duplicate).toBe(true)

		await expect(
			recordSubmissionAcknowledgement(db, { ...baseAck, externalTxHash: '0xdifferent' }),
		).rejects.toBeInstanceOf(ExecutionIdempotencyConflictError)
	})

	test('concurrent identical acknowledgements collapse onto the same external identity', async () => {
		const prepared = await prepareChildSubmission(db, prepareInput())
		const ack = {
			parentOrderId: PARENT_ID,
			expectedParentVersion: 4,
			childPlacementId: prepared.child.id,
			idempotencyKey: 'child-submit-1',
			requestFingerprint: 'signed-plan-digest',
			externalTxHash: '0xabc123',
		}
		const [a, b] = await Promise.all([
			recordSubmissionAcknowledgement(db, ack),
			recordSubmissionAcknowledgement(db, ack),
		])
		expect([a.duplicate, b.duplicate].sort()).toEqual([false, true])
		expect(a.child.externalTxHash).toBe('0xabc123')
		expect(b.child.externalTxHash).toBe('0xabc123')
		expect(await db.select().from(executionEvents)).toHaveLength(2)
	})
})
