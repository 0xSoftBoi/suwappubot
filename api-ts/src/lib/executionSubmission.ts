import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
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
	 * true means this exact write-ahead record already existed. The caller MUST
	 * NOT blindly call the venue/provider again. Reconcile the existing attempt.
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

/**
 * Write-ahead fence for external submission.
 *
 * The child placement is durable BEFORE any provider/chain call is allowed and
 * the parent is CAS-moved from preflight_validated -> submitting in the same
 * transaction. If the caller retries after this transaction committed, the
 * function returns the existing child with replayRequiresReconciliation=true;
 * the caller must reconcile it and may not submit again blindly.
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

	return db.transaction(async (tx) => {
		const existingChildren = await tx
			.select()
			.from(executionChildPlacements)
			.where(
				and(
					eq(executionChildPlacements.parentOrderId, input.parentOrderId),
					eq(executionChildPlacements.childSequence, input.childSequence),
				),
			)
			.limit(1)
		const existingChild = existingChildren[0]
		if (existingChild) {
			if (!childMatchesPrepare(existingChild, { ...input, idempotencyKey, requestFingerprint, substrate })) {
				throw new ExecutionIdempotencyConflictError(
					'Child sequence is already bound to different submission terms',
				)
			}
			const parentRows = await tx
				.select()
				.from(executionParentOrders)
				.where(eq(executionParentOrders.id, input.parentOrderId))
				.limit(1)
			const parent = parentRows[0]
			if (!parent) throw new ExecutionLifecycleError('Parent order not found for existing child')
			if (!['submitting', 'submitted', 'source_confirmed', 'settlement_pending', 'recovery_pending', 'settled'].includes(parent.state)) {
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

		const parentRows = await tx
			.select()
			.from(executionParentOrders)
			.where(eq(executionParentOrders.id, input.parentOrderId))
			.limit(1)
		const parent = parentRows[0]
		if (!parent) throw new ExecutionLifecycleError('Parent order not found')
		if (parent.state !== 'preflight_validated' || parent.stateVersion !== input.expectedParentVersion) {
			throw new ExecutionStateConflictError(
				`Submission fence requires preflight_validated@${input.expectedParentVersion}; got ${parent.state}@${parent.stateVersion}`,
			)
		}

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
			.returning()
		const child = insertedChildren[0]
		if (!child) throw new ExecutionLifecycleError('Child placement insert returned no row')

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
				childPlacementId: child.id,
				childSequence: child.childSequence,
				idempotencyKey: child.idempotencyKey,
				requestFingerprint: child.requestFingerprint,
				provider: child.provider,
				venue: child.venue,
			},
			actorType: input.actorType,
			actorId: input.actorId,
			correlationId: input.correlationId,
		})

		return {
			parentOrder: updatedParent,
			child,
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

function externalIdentityCount(input: RecordSubmissionAcknowledgementInput): number {
	return [input.externalOrderId, input.externalTxHash, input.externalIntentId].filter(
		(value) => typeof value === 'string' && value.trim().length > 0,
	).length
}

/**
 * Durable acknowledgement after the external submit returned an identity.
 * At least one external identifier is mandatory; `submitted` without a venue
 * order id / tx hash / intent id is not an auditable or recoverable state.
 */
export async function recordSubmissionAcknowledgement(
	db: DbClient,
	input: RecordSubmissionAcknowledgementInput,
): Promise<{ parentOrder: ExecutionParentOrder; child: ExecutionChildPlacement; duplicate: boolean }> {
	if (externalIdentityCount(input) === 0) {
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

		const normalizedExternalOrderId = input.externalOrderId?.trim() || null
		const normalizedExternalTxHash = input.externalTxHash?.trim() || null
		const normalizedExternalIntentId = input.externalIntentId?.trim() || null

		if (child.state === 'submitted') {
			if (
				(child.externalOrderId ?? null) !== normalizedExternalOrderId ||
				(child.externalTxHash ?? null) !== normalizedExternalTxHash ||
				(child.externalIntentId ?? null) !== normalizedExternalIntentId
			) {
				throw new ExecutionIdempotencyConflictError(
					'Prepared child is already acknowledged with a different external identity',
				)
			}
			const parentRows = await tx
				.select()
				.from(executionParentOrders)
				.where(eq(executionParentOrders.id, input.parentOrderId))
				.limit(1)
			const parent = parentRows[0]
			if (!parent) throw new ExecutionLifecycleError('Parent order not found for submitted child')
			return { parentOrder: parent, child, duplicate: true }
		}
		if (child.state !== 'prepared') {
			throw new ExecutionStateConflictError(`Cannot acknowledge child from state ${child.state}`)
		}

		const parentRows = await tx
			.select()
			.from(executionParentOrders)
			.where(eq(executionParentOrders.id, input.parentOrderId))
			.limit(1)
		const parent = parentRows[0]
		if (!parent) throw new ExecutionLifecycleError('Parent order not found')
		if (parent.state !== 'submitting' || parent.stateVersion !== input.expectedParentVersion) {
			throw new ExecutionStateConflictError(
				`Submission acknowledgement requires submitting@${input.expectedParentVersion}; got ${parent.state}@${parent.stateVersion}`,
			)
		}

		const now = new Date()
		const updatedChildren = await tx
			.update(executionChildPlacements)
			.set({
				state: 'submitted',
				externalOrderId: normalizedExternalOrderId,
				externalTxHash: normalizedExternalTxHash,
				externalIntentId: normalizedExternalIntentId,
				submittedAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(executionChildPlacements.id, child.id),
					eq(executionChildPlacements.state, 'prepared'),
				),
			)
			.returning()
		const updatedChild = updatedChildren[0]
		if (!updatedChild) throw new ExecutionStateConflictError('Child changed before acknowledgement')

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
					eq(executionParentOrders.state, 'submitting'),
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
			fromState: 'submitting',
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

/**
 * Discover attempts where write-ahead persistence happened but no durable
 * external acknowledgement was recorded. This is the crash/timeout queue.
 * Nothing in this function resubmits; it exists specifically to prevent a
 * restart from treating `prepared` as proof that no external side effect occurred.
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
			and(
				eq(executionParentOrders.state, 'submitting'),
				eq(executionChildPlacements.state, 'prepared'),
			),
		)
		.orderBy(asc(executionParentOrders.updatedAt), asc(executionChildPlacements.childSequence))
		.limit(boundedLimit)
}
