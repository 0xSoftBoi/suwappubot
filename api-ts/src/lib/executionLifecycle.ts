import { createHash, randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { DbClient, DbTransaction } from '../db/client'
import {
	executionCandidatePlans,
	executionEvents,
	executionIntents,
	executionOutbox,
	executionParentOrders,
	executionSettlements,
	type ExecutionIntent,
	type ExecutionParentOrder,
	type ExecutionSettlement,
} from '../db/schema/execution'
import {
	canonicalAuditJson,
	type InstitutionalDecisionAuditRecord,
} from './routeDecisionAudit'
import {
	evaluateRouteFeasibility,
	type ControlledRouteCandidate,
	type FeasibilityContext,
	type InstitutionalExecutionPolicy,
} from './routeFeasibility'

type ExecutionDb = DbClient | DbTransaction

type JsonObject = Record<string, unknown>

export type ExecutionParentState =
	| 'draft'
	| 'authorized'
	| 'preflight_validated'
	| 'submitting'
	| 'submitted'
	| 'source_confirmed'
	| 'settlement_pending'
	| 'settled'
	| 'recovery_pending'
	| 'cancelled'
	| 'expired'
	| 'failed'

export type SettlementObservationState =
	| 'pending'
	| 'source_confirmed'
	| 'destination_confirmed'
	| 'recovery_pending'
	| 'failed'
	| 'refunded'

const TERMINAL_PARENT_STATES = new Set<ExecutionParentState>([
	'settled',
	'cancelled',
	'expired',
	'failed',
])

const PARENT_TRANSITIONS: Readonly<Record<ExecutionParentState, readonly ExecutionParentState[]>> = {
	draft: ['authorized', 'cancelled', 'expired', 'failed'],
	authorized: ['preflight_validated', 'cancelled', 'expired', 'failed'],
	preflight_validated: ['submitting', 'cancelled', 'expired', 'failed'],
	submitting: ['submitted', 'recovery_pending', 'failed'],
	submitted: ['source_confirmed', 'settlement_pending', 'recovery_pending', 'failed'],
	source_confirmed: ['settlement_pending', 'settled', 'recovery_pending', 'failed'],
	settlement_pending: ['settled', 'recovery_pending', 'failed'],
	recovery_pending: ['settlement_pending', 'settled', 'failed'],
	settled: [],
	cancelled: [],
	expired: [],
	failed: [],
}

const SETTLEMENT_TRANSITIONS: Readonly<
	Record<SettlementObservationState, readonly SettlementObservationState[]>
> = {
	pending: ['source_confirmed', 'destination_confirmed', 'recovery_pending', 'failed', 'refunded'],
	source_confirmed: ['destination_confirmed', 'recovery_pending', 'failed', 'refunded'],
	destination_confirmed: [],
	recovery_pending: ['source_confirmed', 'destination_confirmed', 'failed', 'refunded'],
	failed: ['recovery_pending', 'refunded'],
	refunded: [],
}

export class ExecutionLifecycleError extends Error {}
export class ExecutionIdempotencyConflictError extends ExecutionLifecycleError {}
export class ExecutionStateConflictError extends ExecutionLifecycleError {}
export class ExecutionPreflightError extends ExecutionLifecycleError {}

function asObject(value: unknown): JsonObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonObject)
		: {}
}

function nonEmpty(value: string, name: string): string {
	const normalized = value.trim()
	if (!normalized) throw new ExecutionLifecycleError(`${name} is required`)
	return normalized
}

export function executionRequestFingerprint(value: unknown): string {
	return createHash('sha256').update(canonicalAuditJson(value), 'utf8').digest('hex')
}

function intentFingerprintOf(row: ExecutionIntent): string | null {
	const metadata = asObject(row.metadataJson)
	const control = asObject(metadata.executionControl)
	return typeof control.requestFingerprint === 'string' ? control.requestFingerprint : null
}

export interface CreateExecutionIntentInput {
	principalKey: string
	idempotencyKey: string
	userId?: number | null
	intentType: string
	side?: string | null
	amountMode?: string | null
	fromChain?: string | null
	toChain?: string | null
	fromAsset?: string | null
	toAsset?: string | null
	requestedQuantity?: string | null
	quantityAsset?: string | null
	requestedNotional?: string | null
	constraints?: JsonObject | null
	metadata?: JsonObject | null
}

function fingerprintableIntent(input: CreateExecutionIntentInput): JsonObject {
	return {
		principalKey: input.principalKey,
		intentType: input.intentType,
		side: input.side ?? null,
		amountMode: input.amountMode ?? null,
		fromChain: input.fromChain ?? null,
		toChain: input.toChain ?? null,
		fromAsset: input.fromAsset ?? null,
		toAsset: input.toAsset ?? null,
		requestedQuantity: input.requestedQuantity ?? null,
		quantityAsset: input.quantityAsset ?? null,
		requestedNotional: input.requestedNotional ?? null,
		constraints: input.constraints ?? null,
		metadata: input.metadata ?? null,
	}
}

/**
 * Creates an execution intent exactly once for a principal-scoped idempotency key.
 * A retry with identical terms returns the durable row; reusing the same key with
 * different terms is rejected instead of silently executing a different request.
 */
export async function createOrLoadExecutionIntent(
	db: ExecutionDb,
	input: CreateExecutionIntentInput,
): Promise<{ intent: ExecutionIntent; created: boolean; requestFingerprint: string }> {
	const principalKey = nonEmpty(input.principalKey, 'principalKey')
	const idempotencyKey = nonEmpty(input.idempotencyKey, 'idempotencyKey')
	const requestFingerprint = executionRequestFingerprint(fingerprintableIntent(input))
	const metadata = {
		...(input.metadata ?? {}),
		executionControl: {
			schemaVersion: 'execution-intent/v1',
			requestFingerprint,
		},
	}

	const inserted = await db
		.insert(executionIntents)
		.values({
			id: randomUUID(),
			userId: input.userId ?? null,
			principalKey,
			idempotencyKey,
			intentType: nonEmpty(input.intentType, 'intentType'),
			side: input.side ?? null,
			amountMode: input.amountMode ?? null,
			fromChain: input.fromChain ?? null,
			toChain: input.toChain ?? null,
			fromAsset: input.fromAsset ?? null,
			toAsset: input.toAsset ?? null,
			requestedQuantity: input.requestedQuantity ?? null,
			quantityAsset: input.quantityAsset ?? null,
			requestedNotional: input.requestedNotional ?? null,
			constraintsJson: input.constraints ?? null,
			metadataJson: metadata,
		})
		.onConflictDoNothing({
			target: [executionIntents.principalKey, executionIntents.idempotencyKey],
		})
		.returning()

	const created = inserted[0]
	if (created) return { intent: created, created: true, requestFingerprint }

	const existing = await db
		.select()
		.from(executionIntents)
		.where(
			and(
				eq(executionIntents.principalKey, principalKey),
				eq(executionIntents.idempotencyKey, idempotencyKey),
			),
		)
		.limit(1)
	const intent = existing[0]
	if (!intent) {
		throw new ExecutionLifecycleError('Idempotent intent conflict returned no durable row')
	}
	if (intentFingerprintOf(intent) !== requestFingerprint) {
		throw new ExecutionIdempotencyConflictError(
			'Idempotency key was already used for different execution intent terms',
		)
	}
	return { intent, created: false, requestFingerprint }
}

function decisionPlanJson(
	record: InstitutionalDecisionAuditRecord,
	candidate: InstitutionalDecisionAuditRecord['snapshot']['candidates'][number],
): JsonObject {
	return {
		institutionalDecision: {
			schemaVersion: record.snapshot.schemaVersion,
			auditDigest: record.digest,
			policyVersion: record.snapshot.policyVersion,
			policyDigest: record.snapshot.policyDigest,
			optimizerVersion: record.snapshot.optimizerVersion,
			buildVersion: record.snapshot.buildVersion,
			routeCandidateId: candidate.id,
			candidate,
		},
	}
}

function persistedDecisionIdentity(planJson: unknown): {
	auditDigest: string | null
	routeCandidateId: string | null
} {
	const plan = asObject(planJson)
	const decision = asObject(plan.institutionalDecision)
	return {
		auditDigest: typeof decision.auditDigest === 'string' ? decision.auditDigest : null,
		routeCandidateId:
			typeof decision.routeCandidateId === 'string' ? decision.routeCandidateId : null,
	}
}

async function insertLifecycleEvent(
	tx: DbTransaction,
	input: {
		parentOrderId: string
		sequence: number
		eventType: string
		fromState: string | null
		toState: string | null
		payload?: JsonObject | null
		actorType?: string | null
		actorId?: string | null
		correlationId?: string | null
		causationId?: string | null
	},
): Promise<void> {
	const eventId = randomUUID()
	await tx.insert(executionEvents).values({
		id: eventId,
		parentOrderId: input.parentOrderId,
		sequence: input.sequence,
		eventType: input.eventType,
		fromState: input.fromState,
		toState: input.toState,
		payloadJson: input.payload ?? null,
		actorType: input.actorType ?? 'system',
		actorId: input.actorId ?? null,
		correlationId: input.correlationId ?? null,
		causationId: input.causationId ?? null,
	})
	await tx.insert(executionOutbox).values({
		id: randomUUID(),
		eventId,
		topic: `execution.${input.eventType}`,
		payloadJson: {
			eventId,
			parentOrderId: input.parentOrderId,
			sequence: input.sequence,
			eventType: input.eventType,
			fromState: input.fromState,
			toState: input.toState,
			payload: input.payload ?? null,
		},
	})
}

export interface PersistInstitutionalDecisionInput {
	intent: CreateExecutionIntentInput
	decision: InstitutionalDecisionAuditRecord
	submitIdempotencyKey: string
	sourceType?: string | null
	sourceRef?: string | null
	authorizationMethod?: string | null
	requestedQuantity?: string | null
	quantityAsset?: string | null
}

/**
 * Persists the complete route decision into the existing execution substrate.
 * Candidate ordinals are deterministic because the audit snapshot is canonicalized
 * by route id. The parent order and its first event/outbox record are committed in
 * the same database transaction.
 */
export async function persistInstitutionalDecision(
	db: DbClient,
	input: PersistInstitutionalDecisionInput,
): Promise<{
	intent: ExecutionIntent
	parentOrder: ExecutionParentOrder | null
	created: boolean
}> {
	return db.transaction(async (tx) => {
		const { intent } = await createOrLoadExecutionIntent(tx, input.intent)
		const rejected = new Map(
			input.decision.snapshot.rejected.map((row) => [row.candidateId, row.reasonCodes]),
		)
		const selectedRouteId = input.decision.snapshot.winner?.candidateId ?? null
		let selectedCandidateId: string | null = null

		for (const [ordinal, candidate] of input.decision.snapshot.candidates.entries()) {
			const reasonCodes = rejected.get(candidate.id) ?? []
			const planJson = decisionPlanJson(input.decision, candidate)
			const costJson = {
				quotedToAmountUsd: candidate.quotedToAmountUsd,
				quotedGasUsd: candidate.quotedGasUsd,
				quotedFeeUsd: candidate.quotedFeeUsd,
			}
			const inserted = await tx
				.insert(executionCandidatePlans)
				.values({
					id: randomUUID(),
					intentId: intent.id,
					ordinal,
					substrate: candidate.settlementType ?? 'unknown',
					provider: candidate.provider,
					strategy: candidate.tool,
					feasible: reasonCodes.length === 0,
					rejectionCode: reasonCodes[0] ?? null,
					expectedDurationMs:
						candidate.quotedDurationS === null ? null : Math.round(candidate.quotedDurationS * 1000),
					planJson,
					costJson,
					selected: candidate.id === selectedRouteId,
					quoteExpiresAt:
						candidate.expiresAtMs === null ? null : new Date(candidate.expiresAtMs),
				})
				.onConflictDoNothing({
					target: [executionCandidatePlans.intentId, executionCandidatePlans.ordinal],
				})
				.returning()

			let row = inserted[0]
			if (!row) {
				const existing = await tx
					.select()
					.from(executionCandidatePlans)
					.where(
						and(
							eq(executionCandidatePlans.intentId, intent.id),
							eq(executionCandidatePlans.ordinal, ordinal),
						),
					)
					.limit(1)
				row = existing[0]
				if (!row) throw new ExecutionLifecycleError('Candidate conflict returned no durable row')
				const identity = persistedDecisionIdentity(row.planJson)
				if (
					identity.auditDigest !== input.decision.digest ||
					identity.routeCandidateId !== candidate.id
				) {
					throw new ExecutionIdempotencyConflictError(
						'Persisted candidate does not match the retried institutional decision',
					)
				}
			}
			if (candidate.id === selectedRouteId) selectedCandidateId = row.id
		}

		if (selectedRouteId === null) return { intent, parentOrder: null, created: false }
		if (!selectedCandidateId) {
			throw new ExecutionLifecycleError('Winning route has no persisted candidate row')
		}

		const submitIdempotencyKey = nonEmpty(input.submitIdempotencyKey, 'submitIdempotencyKey')
		const insertedParent = await tx
			.insert(executionParentOrders)
			.values({
				id: randomUUID(),
				intentId: intent.id,
				selectedCandidateId,
				sourceType: input.sourceType ?? 'route_decision',
				sourceRef: input.sourceRef ?? null,
				state: 'draft',
				stateVersion: 1,
				strategy: input.decision.snapshot.optimizerVersion,
				authorizationMethod: input.authorizationMethod ?? null,
				requestedQuantity: input.requestedQuantity ?? input.intent.requestedQuantity ?? null,
				quantityAsset: input.quantityAsset ?? input.intent.quantityAsset ?? null,
				submitIdempotencyKey,
				requestFingerprint: input.decision.digest,
			})
			.onConflictDoNothing({
				target: [executionParentOrders.intentId, executionParentOrders.submitIdempotencyKey],
			})
			.returning()

		const createdParent = insertedParent[0]
		if (createdParent) {
			await insertLifecycleEvent(tx, {
				parentOrderId: createdParent.id,
				sequence: createdParent.stateVersion,
				eventType: 'decision_persisted',
				fromState: null,
				toState: 'draft',
				payload: {
					auditDigest: input.decision.digest,
					policyVersion: input.decision.snapshot.policyVersion,
					policyDigest: input.decision.snapshot.policyDigest,
					optimizerVersion: input.decision.snapshot.optimizerVersion,
					buildVersion: input.decision.snapshot.buildVersion,
					selectedRouteId,
				},
			})
			return { intent, parentOrder: createdParent, created: true }
		}

		const existingParentRows = await tx
			.select()
			.from(executionParentOrders)
			.where(
				and(
					eq(executionParentOrders.intentId, intent.id),
					eq(executionParentOrders.submitIdempotencyKey, submitIdempotencyKey),
				),
			)
			.limit(1)
		const parentOrder = existingParentRows[0]
		if (!parentOrder) throw new ExecutionLifecycleError('Parent conflict returned no durable row')
		if (
			parentOrder.requestFingerprint !== input.decision.digest ||
			parentOrder.selectedCandidateId !== selectedCandidateId
		) {
			throw new ExecutionIdempotencyConflictError(
				'Submit idempotency key was already used for a different execution decision',
			)
		}
		return { intent, parentOrder, created: false }
	})
}

export interface TransitionParentOrderInput {
	parentOrderId: string
	expectedState: ExecutionParentState
	expectedVersion: number
	toState: ExecutionParentState
	eventType: string
	payload?: JsonObject | null
	actorType?: string | null
	actorId?: string | null
	correlationId?: string | null
	causationId?: string | null
}

export function assertParentTransitionAllowed(
	fromState: ExecutionParentState,
	toState: ExecutionParentState,
): void {
	if (!PARENT_TRANSITIONS[fromState].includes(toState)) {
		throw new ExecutionStateConflictError(`Illegal execution transition: ${fromState} -> ${toState}`)
	}
}

/**
 * Compare-and-swap transition. The state mutation, ordered event, and outbox row
 * are one transaction. A stale worker cannot overwrite a newer state/version.
 */
export async function transitionParentOrder(
	db: DbClient,
	input: TransitionParentOrderInput,
): Promise<ExecutionParentOrder> {
	assertParentTransitionAllowed(input.expectedState, input.toState)
	if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
		throw new ExecutionStateConflictError('expectedVersion must be a positive integer')
	}
	const now = new Date()

	return db.transaction(async (tx) => {
		const rows = await tx
			.update(executionParentOrders)
			.set({
				state: input.toState,
				stateVersion: sql`${executionParentOrders.stateVersion} + 1`,
				updatedAt: now,
				startedAt: input.toState === 'submitting' ? now : undefined,
				completedAt: TERMINAL_PARENT_STATES.has(input.toState) ? now : undefined,
			})
			.where(
				and(
					eq(executionParentOrders.id, input.parentOrderId),
					eq(executionParentOrders.state, input.expectedState),
					eq(executionParentOrders.stateVersion, input.expectedVersion),
				),
			)
			.returning()
		const row = rows[0]
		if (!row) {
			throw new ExecutionStateConflictError(
				`Execution state/version changed before ${input.eventType}; reload before retrying`,
			)
		}
		await insertLifecycleEvent(tx, {
			parentOrderId: row.id,
			sequence: row.stateVersion,
			eventType: nonEmpty(input.eventType, 'eventType'),
			fromState: input.expectedState,
			toState: input.toState,
			payload: input.payload ?? null,
			actorType: input.actorType,
			actorId: input.actorId,
			correlationId: input.correlationId,
			causationId: input.causationId,
		})
		return row
	})
}

function selectedDecisionIdentity(planJson: unknown): {
	auditDigest: string | null
	routeCandidateId: string | null
} {
	return persistedDecisionIdentity(planJson)
}

export interface InstitutionalPreflightInput {
	parentOrderId: string
	expectedVersion: number
	expectedDecisionDigest: string
	freshCandidate: ControlledRouteCandidate
	policy: InstitutionalExecutionPolicy
	context: FeasibilityContext
	actorType?: string | null
	actorId?: string | null
	correlationId?: string | null
}

/**
 * Revalidates the selected route immediately before submission. The original
 * persisted decision digest must still match, the quote must still be live, and
 * every current hard feasibility control must pass. Successful preflight is
 * itself persisted as a state transition with a tamper-evident control digest.
 */
export async function preflightInstitutionalOrder(
	db: DbClient,
	input: InstitutionalPreflightInput,
): Promise<{ parentOrder: ExecutionParentOrder; preflightDigest: string }> {
	const rows = await db
		.select({ parent: executionParentOrders, candidate: executionCandidatePlans })
		.from(executionParentOrders)
		.leftJoin(
			executionCandidatePlans,
			eq(executionParentOrders.selectedCandidateId, executionCandidatePlans.id),
		)
		.where(eq(executionParentOrders.id, input.parentOrderId))
		.limit(1)
	const joined = rows[0]
	if (!joined || !joined.candidate) throw new ExecutionPreflightError('Selected execution candidate not found')
	if (joined.parent.state !== 'authorized') {
		throw new ExecutionPreflightError(`Preflight requires authorized state, got ${joined.parent.state}`)
	}
	if (joined.parent.stateVersion !== input.expectedVersion) {
		throw new ExecutionStateConflictError('Execution version changed before preflight')
	}
	if (joined.parent.requestFingerprint !== input.expectedDecisionDigest) {
		throw new ExecutionPreflightError('Parent decision digest does not match approved decision')
	}

	const persisted = selectedDecisionIdentity(joined.candidate.planJson)
	if (persisted.auditDigest !== input.expectedDecisionDigest) {
		throw new ExecutionPreflightError('Selected candidate decision digest does not match parent')
	}
	if (persisted.routeCandidateId !== input.freshCandidate.id) {
		throw new ExecutionPreflightError('Fresh route identity differs from approved selected route')
	}
	if (joined.candidate.quoteExpiresAt && joined.candidate.quoteExpiresAt.getTime() <= input.context.nowMs) {
		throw new ExecutionPreflightError('Persisted selected quote is expired')
	}

	const feasibility = evaluateRouteFeasibility(input.freshCandidate, input.policy, input.context)
	if (!feasibility.eligible) {
		throw new ExecutionPreflightError(
			`Fresh route failed hard preflight: ${feasibility.reasonCodes.join(',')}`,
		)
	}

	const preflightSnapshot = {
		schemaVersion: 'institutional-preflight/v1',
		decisionDigest: input.expectedDecisionDigest,
		policyVersion: input.policy.version,
		evaluatedAtMs: input.context.nowMs,
		orderNotionalUsd: input.context.orderNotionalUsd,
		candidate: {
			id: input.freshCandidate.id,
			quoteTimestampMs: input.freshCandidate.quoteTimestampMs ?? null,
			expiresAtMs: input.freshCandidate.expiresAtMs ?? null,
			capacityUsd: input.freshCandidate.capacityUsd ?? null,
			recoveryAvailable: input.freshCandidate.recoveryAvailable ?? null,
			authorizationSatisfied: input.freshCandidate.authorizationSatisfied ?? null,
			venueStatus: input.freshCandidate.venueStatus ?? null,
			eligibilityStatus: input.freshCandidate.eligibilityStatus ?? null,
			dataConfidence: input.freshCandidate.dataConfidence ?? null,
		},
		settlementType: feasibility.settlementType,
	}
	const preflightDigest = executionRequestFingerprint(preflightSnapshot)
	const parentOrder = await transitionParentOrder(db, {
		parentOrderId: input.parentOrderId,
		expectedState: 'authorized',
		expectedVersion: input.expectedVersion,
		toState: 'preflight_validated',
		eventType: 'preflight_validated',
		payload: { ...preflightSnapshot, preflightDigest },
		actorType: input.actorType ?? 'execution_service',
		actorId: input.actorId,
		correlationId: input.correlationId,
	})
	return { parentOrder, preflightDigest }
}

export interface SettlementObservationInput {
	parentOrderId: string
	childPlacementId?: string | null
	settlementType: string
	externalSource: string
	externalRef: string
	state: SettlementObservationState
	chain?: string | null
	asset?: string | null
	amount?: string | null
	confirmations?: number | null
	finalityTarget?: number | null
	recovery?: JsonObject | null
	observedAt?: Date
}

function assertSettlementTransitionAllowed(
	fromState: SettlementObservationState,
	toState: SettlementObservationState,
): void {
	if (fromState === toState) return
	if (!SETTLEMENT_TRANSITIONS[fromState].includes(toState)) {
		throw new ExecutionStateConflictError(`Illegal settlement transition: ${fromState} -> ${toState}`)
	}
}

async function loadSettlementByExternalKey(
	db: ExecutionDb,
	input: Pick<SettlementObservationInput, 'externalSource' | 'externalRef' | 'settlementType'>,
): Promise<ExecutionSettlement | null> {
	const rows = await db
		.select()
		.from(executionSettlements)
		.where(
			and(
				eq(executionSettlements.externalSource, input.externalSource),
				eq(executionSettlements.externalRef, input.externalRef),
				eq(executionSettlements.settlementType, input.settlementType),
			),
		)
		.limit(1)
	return rows[0] ?? null
}

/**
 * Replay-safe external settlement observation. Provider/webhook duplicates are
 * collapsed by the database unique key. State may only move forward through the
 * explicit settlement state machine; retries cannot manufacture a second record.
 */
export async function recordSettlementObservation(
	db: DbClient,
	input: SettlementObservationInput,
): Promise<{ settlement: ExecutionSettlement; duplicate: boolean }> {
	const settlementType = nonEmpty(input.settlementType, 'settlementType')
	const externalSource = nonEmpty(input.externalSource, 'externalSource')
	const externalRef = nonEmpty(input.externalRef, 'externalRef')

	return db.transaction(async (tx) => {
		const inserted = await tx
			.insert(executionSettlements)
			.values({
				id: randomUUID(),
				parentOrderId: input.parentOrderId,
				childPlacementId: input.childPlacementId ?? null,
				settlementType,
				externalSource,
				externalRef,
				state: input.state,
				chain: input.chain ?? null,
				asset: input.asset ?? null,
				amount: input.amount ?? null,
				confirmations: input.confirmations ?? null,
				finalityTarget: input.finalityTarget ?? null,
				recoveryJson: input.recovery ?? null,
				updatedAt: input.observedAt ?? new Date(),
			})
			.onConflictDoNothing({
				target: [
					executionSettlements.externalSource,
					executionSettlements.externalRef,
					executionSettlements.settlementType,
				],
			})
			.returning()
		const created = inserted[0]
		if (created) return { settlement: created, duplicate: false }

		const existing = await loadSettlementByExternalKey(tx, {
			externalSource,
			externalRef,
			settlementType,
		})
		if (!existing) throw new ExecutionLifecycleError('Settlement conflict returned no durable row')
		if (existing.parentOrderId !== input.parentOrderId) {
			throw new ExecutionIdempotencyConflictError(
				'External settlement identity is already bound to a different parent order',
			)
		}
		const currentState = existing.state as SettlementObservationState
		assertSettlementTransitionAllowed(currentState, input.state)
		if (currentState === input.state) return { settlement: existing, duplicate: true }

		const updated = await tx
			.update(executionSettlements)
			.set({
				state: input.state,
				confirmations: input.confirmations ?? existing.confirmations,
				finalityTarget: input.finalityTarget ?? existing.finalityTarget,
				recoveryJson: input.recovery ?? existing.recoveryJson,
				updatedAt: input.observedAt ?? new Date(),
			})
			.where(
				and(
					eq(executionSettlements.id, existing.id),
					eq(executionSettlements.state, existing.state),
				),
			)
			.returning()
		const row = updated[0]
		if (!row) {
			throw new ExecutionStateConflictError(
				'Settlement state changed concurrently; reload before retrying observation',
			)
		}
		return { settlement: row, duplicate: false }
	})
}

export interface ReconcileAuthoritativeSettlementInput {
	parentOrderId: string
	expectedParentState: 'source_confirmed' | 'settlement_pending' | 'recovery_pending'
	expectedParentVersion: number
	settlementType: string
	externalSource: string
	externalRef: string
	actorId?: string | null
	correlationId?: string | null
}

/**
 * A provider submit/source confirmation is never treated as success. Only a
 * durable settlement observation in destination_confirmed may close the parent.
 * This can be called after process restart because every required identifier is
 * loaded from the database rather than process memory.
 */
export async function reconcileAuthoritativeSettlement(
	db: DbClient,
	input: ReconcileAuthoritativeSettlementInput,
): Promise<ExecutionParentOrder> {
	const settlement = await loadSettlementByExternalKey(db, input)
	if (!settlement || settlement.parentOrderId !== input.parentOrderId) {
		throw new ExecutionLifecycleError('Authoritative settlement record not found for parent order')
	}
	if (settlement.state !== 'destination_confirmed') {
		throw new ExecutionStateConflictError(
			`Settlement is not authoritative completion: ${settlement.state}`,
		)
	}
	return transitionParentOrder(db, {
		parentOrderId: input.parentOrderId,
		expectedState: input.expectedParentState,
		expectedVersion: input.expectedParentVersion,
		toState: 'settled',
		eventType: 'settlement_reconciled',
		payload: {
			settlementId: settlement.id,
			settlementType: settlement.settlementType,
			externalSource: settlement.externalSource,
			externalRef: settlement.externalRef,
		},
		actorType: 'reconciler',
		actorId: input.actorId,
		correlationId: input.correlationId,
	})
}

/** Restart-safe work discovery for a reconciliation worker. */
export async function listParentsNeedingReconciliation(
	db: ExecutionDb,
	limit = 100,
): Promise<ExecutionParentOrder[]> {
	const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)))
	return db
		.select()
		.from(executionParentOrders)
		.where(
			inArray(executionParentOrders.state, [
				'submitted',
				'source_confirmed',
				'settlement_pending',
				'recovery_pending',
			]),
		)
		.orderBy(asc(executionParentOrders.updatedAt), asc(executionParentOrders.id))
		.limit(boundedLimit)
}
