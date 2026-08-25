import { randomUUID } from 'node:crypto'
import { and, asc, eq, or, sql } from 'drizzle-orm'
import type { DbClient, DbTransaction } from '../db/client'
import {
	executionChildPlacements,
	executionEvents,
	executionOutbox,
	executionParentOrders,
	type ExecutionChildPlacement,
	type ExecutionParentOrder,
} from '../db/schema/execution'
import {
	ExecutionIdempotencyConflictError,
	ExecutionLifecycleError,
	ExecutionStateConflictError,
} from './executionLifecycle'

type JsonObject = Record<string, unknown>

function nonEmpty(value: string, name: string): string {
	const normalized = value.trim()
	if (!normalized) throw new ExecutionLifecycleError(`${name} is required`)
	return normalized
}

async function appendEventAndOutbox(
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
		actorType: input.actorType ?? 'execution_service',
		actorId: input.actorId ?? null,
		correlationId: input.correlationId ?? null,
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

export interface PrepareChildSubmissionInput {
	parentOrderId: string
	expectedParentVersion: number
	childSequence: number
	idempotencyKey: string
	requestFingerprint: string
	substrate: string
	provider?: string | null
	venue?: string | null
	chain?: string | null
	side?: string | null
	requestedQuantity?: string | null
	quantityAsset?: string | null
	limitPrice?: string | null
	actorType?: string | null
	actorId?: string | null
	correlationId?: string | null
}

export interface PreparedChildSubmission {
	parentOrder: ExecutionParentOrder
	child: ExecutionChildPlacement
	/**
	 * true means a write-ahead record for this exact instruction already exists.
	 * The caller MUST reconcile it and MUST NOT blindly invoke the provider again.
	 */
	replayRequiresReconciliation: boolean
}

function childMatchesPrepare(
	child: ExecutionChildPlacement,
	input: PrepareChildSubmissionInput,
): boolean {
	return (
		child.idempotencyKey === input.idempotencyKey &&
		child.requestFingerprint === input.requestFingerprint &&
		child.substrate === input.substrate &&
		(child.provider ?? null) === (input.provider ?? null) &&
		(child.venue ?? null) === (input.venue ?? null) &&
		(child.chain ?? null) === (input.chain ?? null) &&
		(child.side ?? null) === (input.side ?? null) &&
		(child.requestedQuantity ?? null) === (input.requestedQuantity ?? null) &&
		(child.quantityAsset ?? null) === (input.quantityAsset ?? null) &&
		(child.limitPrice ?? null) === (input.limitPrice ?? null)
	)
}

async function loadParent(tx: DbTransaction, parentOrderId: string): Promise<ExecutionParentOrder> {
	const rows = await tx
		.select()
		.from(executionParentOrders)
		.where(eq(executionParentOrders.id, parentOrderId))
		.limit(1)
	const parent = rows[0]
	if (!parent) throw new ExecutionLifecycleError('Parent order not found')
	return parent
}

/**
 * Write-ahead fence for external submission.
 *
 * A child placement is committed before an external call is permitted and the
 * parent is CAS-moved from preflight_validated -> submitting in the SAME
 * transaction. The unique (parent, childSequence) constraint is deliberately
 * used as the cross-worker arbitration point: two workers racing the same
 * economic instruction collapse to one durable child. The loser receives that
 * child with replayRequiresReconciliation=true; it never receives permission to
 * resubmit.
 */
export async function prepareChildSubmission(
	db: DbClient,
	input: PrepareChildSubmissionInput,
): Promise<PreparedChildSubmission> {
	if (!Number.isInteger(input.expectedParentVersion) || input.expectedParentVersion < 1) {
		throw new ExecutionStateConflictError('expectedParentVersion must be a positive integer')
	}
	if (!Number.isInteger(input.childSequence) || input.childSequence < 0) {
		throw new ExecutionLifecycleError('childSequence must be a non-negative integer')
	}
	const idempotencyKey = nonEmpty(input.idempotencyKey, 'idempotencyKey')
	const requestFingerprint = nonEmpty(input.requestFingerprint, 'requestFingerprint')
	const substrate = nonEmpty(input.substrate, 'substrate')
	const normalizedInput = { ...input, idempotencyKey, requestFingerprint, substrate }

	return db.transaction(async (tx) => {
		const insertedChildren = await tx
			.insert(executionChildPlacements)
			.values({
				id: randomUUID(),
				parentOrderId: input.parentOrderId,
				childSequence: input.childSequence,
				substrate,
				provider: input.provider ?? null,
				venue: input.venue ?? null,
				chain: input.chain ?? null,
				side: input.side ?? null,
				requestedQuantity: input.requestedQuantity ?? null,
				quantityAsset: input.quantityAsset ?? null,
				limitPrice: input.limitPrice ?? null,
				state: 'prepared',
				idempotencyKey,
				requestFingerprint,
			})
			.onConflictDoNothing({
				target: [executionChildPlacements.parentOrderId, executionChildPlacements.childSequence],
			})
			.returning()

		const insertedChild = insertedChildren[0]
		if (!insertedChild) {
			const existingRows = await tx
				.select()
				.from(executionChildPlacements)
				.where(
					and(
						eq(executionChildPlacements.parentOrderId, input.parentOrderId),
						eq(executionChildPlacements.childSequence, input.childSequence),
					),
				)
				.limit(1)
			const existingChild = existingRows[0]
			if (!existingChild) {
				throw new ExecutionLifecycleError('Submission conflict returned no durable child')
			}
			if (!childMatchesPrepare(existingChild, normalizedInput)) {
				throw new ExecutionIdempotencyConflictError(
					'Child sequence is already bound to different submission terms',
				)
			}
			const parent = await loadParent(tx, input.parentOrderId)
			if (
				!['submitting', 'submitted', 'source_confirmed', 'settlement_pending', 'recovery_pending', 'settled'].includes(
					parent.state,
				)
			) {
				throw new ExecutionStateConflictError(
					`Existing child has incompatible parent state: ${parent.state}`,
				)
			}
			return {
				parentOrder: parent,
				child: existingChild,
				replayRequiresReconciliation: true,
			}
		}

		const parent = await loadParent(tx, input.parentOrderId)
		if (parent.state !== 'preflight_validated' || parent.stateVersion !== input.expectedParentVersion) {
			throw new ExecutionStateConflictError(
				`Submission fence requires preflight_validated@${input.expectedParentVersion}; got ${parent.state}@${parent.stateVersion}`,
			)
		}

		const now = new Date()
		const updatedParents = await tx
			.update(executionParentOrders)
			.set({
				state: 'submitting',
				stateVersion: sql`${executionParentOrders.stateVersion} + 1`,
				startedAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(executionParentOrders.id, input.parentOrderId),
					eq(executionParentOrders.state, 'preflight_validated'),
					eq(executionParentOrders.stateVersion, input.expectedParentVersion),
				),
			)
			.returning()
		const updatedParent = updatedParents[0]
		if (!updatedParent) {
			throw new ExecutionStateConflictError('Parent changed while preparing child submission')
		}

		await appendEventAndOutbox(tx, {
			parentOrderId: updatedParent.id,
			sequence: updatedParent.stateVersion,
			eventType: 'submission_prepared',
			fromState: 'preflight_validated',
			toState: 'submitting',
			payload: {
				childPlacementId: insertedChild.id,
				childSequence: insertedChild.childSequence,
				idempotencyKey: insertedChild.idempotencyKey,
				requestFingerprint: insertedChild.requestFingerprint,
				provider: insertedChild.provider,
				venue: insertedChild.venue,
			},
			actorType: input.actorType,
			actorId: input.actorId,
			correlationId: input.correlationId,
		})

		return {
			parentOrder: updatedParent,
			child: insertedChild,
			replayRequiresReconciliation: false,
		}
	})
}

export interface RecordSubmissionAcknowledgementInput {
	parentOrderId: string
	expectedParentVersion: number
	childPlacementId: string
	idempotencyKey: string
	requestFingerprint: string
	externalOrderId?: string | null
	externalTxHash?: string | null
	externalIntentId?: string | null
	actorType?: string | null
	actorId?: string | null
	correlationId?: string | null
}

interface NormalizedExternalIdentity {
	externalOrderId: string | null
	externalTxHash: string | null
	externalIntentId: string | null
}

function normalizeExternalIdentity(
	input: Pick<
		RecordSubmissionAcknowledgementInput,
		'externalOrderId' | 'externalTxHash' | 'externalIntentId'
	>,
): NormalizedExternalIdentity {
	return {
		externalOrderId: input.externalOrderId?.trim() || null,
		externalTxHash: input.externalTxHash?.trim() || null,
		externalIntentId: input.externalIntentId?.trim() || null,
	}
}

function hasExternalIdentity(identity: NormalizedExternalIdentity): boolean {
	return Boolean(identity.externalOrderId || identity.externalTxHash || identity.externalIntentId)
}

function childHasIdentity(child: ExecutionChildPlacement, identity: NormalizedExternalIdentity): boolean {
	return (
		(child.externalOrderId ?? null) === identity.externalOrderId &&
		(child.externalTxHash ?? null) === identity.externalTxHash &&
		(child.externalIntentId ?? null) === identity.externalIntentId
	)
}

/**
 * Durable acknowledgement after the provider returns a recoverable external
 * identity. `prepared` and `unknown` are both accepted because an indeterminate
 * request may later be recovered by querying the provider/chain. Two workers
 * racing the same acknowledgement collapse to one durable identity; a different
 * identity is a hard idempotency conflict.
 */
export async function recordSubmissionAcknowledgement(
	db: DbClient,
	input: RecordSubmissionAcknowledgementInput,
): Promise<{ parentOrder: ExecutionParentOrder; child: ExecutionChildPlacement; duplicate: boolean }> {
	const identity = normalizeExternalIdentity(input)
	if (!hasExternalIdentity(identity)) {
		throw new ExecutionLifecycleError('Submission acknowledgement requires an external identity')
	}
	const idempotencyKey = nonEmpty(input.idempotencyKey, 'idempotencyKey')
	const requestFingerprint = nonEmpty(input.requestFingerprint, 'requestFingerprint')

	return db.transaction(async (tx) => {
		const childRows = await tx
			.select()
			.from(executionChildPlacements)
			.where(eq(executionChildPlacements.id, input.childPlacementId))
			.limit(1)
		const child = childRows[0]
		if (!child || child.parentOrderId !== input.parentOrderId) {
			throw new ExecutionLifecycleError('Child placement not found for parent order')
		}
		if (child.idempotencyKey !== idempotencyKey || child.requestFingerprint !== requestFingerprint) {
			throw new ExecutionIdempotencyConflictError('Submission acknowledgement does not match prepared child')
		}

		if (child.state === 'submitted') {
			if (!childHasIdentity(child, identity)) {
				throw new ExecutionIdempotencyConflictError(
					'Prepared child is already acknowledged with a different external identity',
				)
			}
			return { parentOrder: await loadParent(tx, input.parentOrderId), child, duplicate: true }
		}
		if (!['prepared', 'unknown'].includes(child.state)) {
			throw new ExecutionStateConflictError(`Cannot acknowledge child from state ${child.state}`)
		}

		const parent = await loadParent(tx, input.parentOrderId)
		const validParentState =
			(parent.state === 'submitting' || parent.state === 'recovery_pending') &&
			parent.stateVersion === input.expectedParentVersion
		if (!validParentState) {
			throw new ExecutionStateConflictError(
				`Submission acknowledgement requires submitting/recovery_pending@${input.expectedParentVersion}; got ${parent.state}@${parent.stateVersion}`,
			)
		}

		const now = new Date()
		const updatedChildren = await tx
			.update(executionChildPlacements)
			.set({
				state: 'submitted',
				externalOrderId: identity.externalOrderId,
				externalTxHash: identity.externalTxHash,
				externalIntentId: identity.externalIntentId,
				submittedAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(executionChildPlacements.id, child.id),
					or(
						eq(executionChildPlacements.state, 'prepared'),
						eq(executionChildPlacements.state, 'unknown'),
					),
				),
			)
			.returning()
		const updatedChild = updatedChildren[0]

		if (!updatedChild) {
			const racedRows = await tx
				.select()
				.from(executionChildPlacements)
				.where(eq(executionChildPlacements.id, child.id))
				.limit(1)
			const racedChild = racedRows[0]
			if (!racedChild) throw new ExecutionLifecycleError('Child disappeared during acknowledgement')
			if (racedChild.state !== 'submitted' || !childHasIdentity(racedChild, identity)) {
				throw new ExecutionIdempotencyConflictError(
					'Concurrent acknowledgement resolved to a different external identity',
				)
			}
			return {
				parentOrder: await loadParent(tx, input.parentOrderId),
				child: racedChild,
				duplicate: true,
			}
		}

		const updatedParents = await tx
			.update(executionParentOrders)
			.set({
				state: 'submitted',
				stateVersion: sql`${executionParentOrders.stateVersion} + 1`,
				updatedAt: now,
			})
			.where(
				and(
					eq(executionParentOrders.id, parent.id),
					eq(executionParentOrders.state, parent.state),
					eq(executionParentOrders.stateVersion, input.expectedParentVersion),
				),
			)
			.returning()
		const updatedParent = updatedParents[0]
		if (!updatedParent) throw new ExecutionStateConflictError('Parent changed before acknowledgement')

		await appendEventAndOutbox(tx, {
			parentOrderId: updatedParent.id,
			sequence: updatedParent.stateVersion,
			eventType: 'submission_acknowledged',
			fromState: parent.state,
			toState: 'submitted',
			payload: {
				childPlacementId: updatedChild.id,
				externalOrderId: updatedChild.externalOrderId,
				externalTxHash: updatedChild.externalTxHash,
				externalIntentId: updatedChild.externalIntentId,
			},
			actorType: input.actorType,
			actorId: input.actorId,
			correlationId: input.correlationId,
		})

		return { parentOrder: updatedParent, child: updatedChild, duplicate: false }
	})
}

export interface MarkSubmissionIndeterminateInput {
	parentOrderId: string
	expectedParentVersion: number
	childPlacementId: string
	idempotencyKey: string
	requestFingerprint: string
	reasonCode: string
	detail?: string | null
	actorType?: string | null
	actorId?: string | null
	correlationId?: string | null
}

/**
 * Records the only safe interpretation of a timeout/transport/5xx after an
 * external dispatch may have occurred: outcome UNKNOWN. It is deliberately
 * recoverable, not terminal. The existing economic instruction remains fenced
 * and no retry path is granted permission to manufacture a second submission.
 */
export async function markSubmissionIndeterminate(
	db: DbClient,
	input: MarkSubmissionIndeterminateInput,
): Promise<{ parentOrder: ExecutionParentOrder; child: ExecutionChildPlacement; duplicate: boolean }> {
	const idempotencyKey = nonEmpty(input.idempotencyKey, 'idempotencyKey')
	const requestFingerprint = nonEmpty(input.requestFingerprint, 'requestFingerprint')
	const reasonCode = nonEmpty(input.reasonCode, 'reasonCode')

	return db.transaction(async (tx) => {
		const childRows = await tx
			.select()
			.from(executionChildPlacements)
			.where(eq(executionChildPlacements.id, input.childPlacementId))
			.limit(1)
		const child = childRows[0]
		if (!child || child.parentOrderId !== input.parentOrderId) {
			throw new ExecutionLifecycleError('Child placement not found for parent order')
		}
		if (child.idempotencyKey !== idempotencyKey || child.requestFingerprint !== requestFingerprint) {
			throw new ExecutionIdempotencyConflictError('Indeterminate result does not match prepared child')
		}

		const parent = await loadParent(tx, input.parentOrderId)
		if (child.state === 'unknown' && parent.state === 'recovery_pending') {
			return { parentOrder: parent, child, duplicate: true }
		}
		if (child.state !== 'prepared') {
			throw new ExecutionStateConflictError(`Cannot mark child indeterminate from state ${child.state}`)
		}
		if (parent.state !== 'submitting' || parent.stateVersion !== input.expectedParentVersion) {
			throw new ExecutionStateConflictError(
				`Indeterminate result requires submitting@${input.expectedParentVersion}; got ${parent.state}@${parent.stateVersion}`,
			)
		}

		const now = new Date()
		const updatedChildren = await tx
			.update(executionChildPlacements)
			.set({ state: 'unknown', updatedAt: now })
			.where(
				and(
					eq(executionChildPlacements.id, child.id),
					eq(executionChildPlacements.state, 'prepared'),
				),
			)
			.returning()
		const updatedChild = updatedChildren[0]
		if (!updatedChild) throw new ExecutionStateConflictError('Child changed before UNKNOWN persistence')

		const updatedParents = await tx
			.update(executionParentOrders)
			.set({
				state: 'recovery_pending',
				stateVersion: sql`${executionParentOrders.stateVersion} + 1`,
				updatedAt: now,
			})
			.where(
				and(
					eq(executionParentOrders.id, parent.id),
					eq(executionParentOrders.state, 'submitting'),
					eq(executionParentOrders.stateVersion, input.expectedParentVersion),
				),
			)
			.returning()
		const updatedParent = updatedParents[0]
		if (!updatedParent) throw new ExecutionStateConflictError('Parent changed before UNKNOWN persistence')

		await appendEventAndOutbox(tx, {
			parentOrderId: updatedParent.id,
			sequence: updatedParent.stateVersion,
			eventType: 'submission_indeterminate',
			fromState: 'submitting',
			toState: 'recovery_pending',
			payload: {
				childPlacementId: updatedChild.id,
				reasonCode,
				detail: input.detail ?? null,
			},
			actorType: input.actorType,
			actorId: input.actorId,
			correlationId: input.correlationId,
		})

		return { parentOrder: updatedParent, child: updatedChild, duplicate: false }
	})
}

/**
 * Crash/timeout recovery queue. `prepared/submitting` means the process may have
 * died around the provider call. `unknown/recovery_pending` means we KNOW the
 * result was indeterminate. Neither state is proof that no external side effect
 * occurred; callers must use provider/chain recovery, never blind resubmission.
 */
export async function listSubmissionAttemptsNeedingReconciliation(
	db: DbClient,
	limit = 100,
): Promise<Array<{ parentOrder: ExecutionParentOrder; child: ExecutionChildPlacement }>> {
	const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)))
	return db
		.select({ parentOrder: executionParentOrders, child: executionChildPlacements })
		.from(executionParentOrders)
		.innerJoin(
			executionChildPlacements,
			eq(executionChildPlacements.parentOrderId, executionParentOrders.id),
		)
		.where(
			or(
				and(
					eq(executionParentOrders.state, 'submitting'),
					eq(executionChildPlacements.state, 'prepared'),
				),
				and(
					eq(executionParentOrders.state, 'recovery_pending'),
					eq(executionChildPlacements.state, 'unknown'),
				),
			),
		)
		.orderBy(asc(executionParentOrders.updatedAt), asc(executionChildPlacements.childSequence))
		.limit(boundedLimit)
}
