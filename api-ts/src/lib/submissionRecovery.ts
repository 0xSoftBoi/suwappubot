import type { DbClient } from '../db/client'
import type { ExecutionChildPlacement, ExecutionParentOrder } from '../db/schema/execution'
import {
	ExecutionLifecycleError,
	ExecutionStateConflictError,
} from './executionLifecycle'
import { recordSubmissionAcknowledgement } from './executionSubmission'

export interface RecoverableSubmissionIdentity {
	externalOrderId?: string | null
	externalTxHash?: string | null
	externalIntentId?: string | null
}

export interface SubmissionRecoveryRequest {
	parentOrder: ExecutionParentOrder
	child: ExecutionChildPlacement
}

export type SubmissionRecoveryResult =
	| {
			status: 'found'
			identity: RecoverableSubmissionIdentity
			providerState?: string | null
		}
	| {
			status: 'not_found'
			/**
			 * True only when the provider/chain can authoritatively prove that the
			 * durable client/transaction identity never produced an external side
			 * effect. Generic HTTP 404s and indexer misses MUST leave this false.
			 */
			authoritative: boolean
			reason?: string | null
		}
	| {
			status: 'unknown'
			reason: string
			retryAfterMs?: number | null
		}

export interface SubmissionRecoveryAdapter {
	readonly provider: string
	/**
	 * Lookup only. This method MUST NOT submit, rebroadcast, replace, or mint a
	 * new client order id. Recovery and submission are deliberately separate
	 * capabilities so an outage cannot silently turn into duplicate money movement.
	 */
	recover(request: SubmissionRecoveryRequest): Promise<SubmissionRecoveryResult>
}

export interface RecoveryOutcome {
	status: 'recovered' | 'still_unknown' | 'authoritative_absence'
	parentOrder: ExecutionParentOrder
	child: ExecutionChildPlacement
	reason?: string | null
}

function providerOf(child: ExecutionChildPlacement): string {
	const provider = child.provider?.trim()
	if (!provider) throw new ExecutionLifecycleError('Recovery requires a persisted provider')
	return provider
}

/**
 * Reconcile one durable UNKNOWN/prepared attempt through a provider-specific
 * read path. A successful lookup attaches the external identity to the SAME
 * child and advances it to submitted. Neither unknown nor not_found grants
 * permission to resubmit: authoritative absence is surfaced to a higher-level
 * policy/operator, never converted into a second instruction here.
 */
export async function recoverSubmissionAttempt(
	db: DbClient,
	request: SubmissionRecoveryRequest,
	adapter: SubmissionRecoveryAdapter,
): Promise<RecoveryOutcome> {
	const provider = providerOf(request.child)
	if (provider !== adapter.provider) {
		throw new ExecutionLifecycleError(
			`Recovery adapter mismatch: child provider=${provider}, adapter=${adapter.provider}`,
		)
	}
	if (!['submitting', 'recovery_pending'].includes(request.parentOrder.state)) {
		throw new ExecutionStateConflictError(
			`Recovery requires submitting/recovery_pending parent; got ${request.parentOrder.state}`,
		)
	}
	if (!['prepared', 'unknown'].includes(request.child.state)) {
		throw new ExecutionStateConflictError(
			`Recovery requires prepared/unknown child; got ${request.child.state}`,
		)
	}
	if (!request.child.idempotencyKey || !request.child.requestFingerprint) {
		throw new ExecutionLifecycleError('Recovery requires persisted idempotency key and request fingerprint')
	}

	const result = await adapter.recover(request)
	if (result.status === 'unknown') {
		return {
			status: 'still_unknown',
			parentOrder: request.parentOrder,
			child: request.child,
			reason: result.reason,
		}
	}
	if (result.status === 'not_found') {
		return {
			status: result.authoritative ? 'authoritative_absence' : 'still_unknown',
			parentOrder: request.parentOrder,
			child: request.child,
			reason: result.reason ?? null,
		}
	}

	const ack = await recordSubmissionAcknowledgement(db, {
		parentOrderId: request.parentOrder.id,
		expectedParentVersion: request.parentOrder.stateVersion,
		childPlacementId: request.child.id,
		idempotencyKey: request.child.idempotencyKey,
		requestFingerprint: request.child.requestFingerprint,
		externalOrderId: result.identity.externalOrderId ?? null,
		externalTxHash: result.identity.externalTxHash ?? null,
		externalIntentId: result.identity.externalIntentId ?? null,
		actorType: 'reconciler',
		actorId: adapter.provider,
	})

	return {
		status: 'recovered',
		parentOrder: ack.parentOrder,
		child: ack.child,
		reason: result.providerState ?? null,
	}
}
