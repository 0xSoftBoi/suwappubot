import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { executionOutbox } from '../db/schema/execution'
import { ExecutionLifecycleError } from './executionLifecycle'

export interface ExecutionOutboxEnvelope {
	/** Stable dedupe key. Consumers MUST persist this before applying side effects. */
	idempotencyKey: string
	topic: string
	payload: unknown
}

export interface ExecutionOutboxTransport {
	/**
	 * At-least-once delivery contract. Implementations must forward
	 * idempotencyKey to the broker/consumer boundary; a crash after publish and
	 * before published_at is persisted can cause this exact envelope to be sent
	 * again.
	 */
	publish(envelope: ExecutionOutboxEnvelope): Promise<void>
}

export interface PublishOutboxOptions {
	limit?: number
	now?: Date
	baseRetryMs?: number
	maxRetryMs?: number
}

export interface PublishOutboxResult {
	attempted: number
	published: number
	failed: number
}

function retryDelayMs(attempt: number, baseMs: number, maxMs: number): number {
	const exponent = Math.max(0, Math.min(20, attempt - 1))
	return Math.min(maxMs, baseMs * 2 ** exponent)
}

/**
 * Publish pending execution events with explicit AT-LEAST-ONCE semantics.
 *
 * We intentionally do not claim exactly-once delivery: if the process dies
 * after transport.publish() succeeds but before published_at commits, the row
 * will be retried. Correctness therefore depends on event_id being treated as
 * the consumer-side idempotency key. Multiple publisher workers may race the
 * same row; they still emit the same idempotency key.
 */
export async function publishExecutionOutboxBatch(
	db: DbClient,
	transport: ExecutionOutboxTransport,
	options: PublishOutboxOptions = {},
): Promise<PublishOutboxResult> {
	const now = options.now ?? new Date()
	const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)))
	const baseRetryMs = Math.max(100, Math.floor(options.baseRetryMs ?? 1_000))
	const maxRetryMs = Math.max(baseRetryMs, Math.floor(options.maxRetryMs ?? 60_000))

	const rows = await db
		.select()
		.from(executionOutbox)
		.where(
			and(
				isNull(executionOutbox.publishedAt),
				or(isNull(executionOutbox.nextAttemptAt), lte(executionOutbox.nextAttemptAt, now)),
			),
		)
		.orderBy(asc(executionOutbox.createdAt))
		.limit(limit)

	let published = 0
	let failed = 0
	for (const row of rows) {
		if (!row.eventId || !row.topic) {
			throw new ExecutionLifecycleError('Outbox row is missing event identity/topic')
		}

		try {
			await transport.publish({
				idempotencyKey: row.eventId,
				topic: row.topic,
				payload: row.payloadJson ?? null,
			})

			const updated = await db
				.update(executionOutbox)
				.set({ publishedAt: now, nextAttemptAt: null, lastError: null })
				.where(and(eq(executionOutbox.id, row.id), isNull(executionOutbox.publishedAt)))
				.returning({ id: executionOutbox.id })
			if (updated.length > 0) published += 1
		} catch (error) {
			failed += 1
			const nextAttempt = (row.attempts ?? 0) + 1
			const nextAttemptAt = new Date(now.getTime() + retryDelayMs(nextAttempt, baseRetryMs, maxRetryMs))
			const message = error instanceof Error ? error.message : String(error)
			await db
				.update(executionOutbox)
				.set({
					attempts: sql`${executionOutbox.attempts} + 1`,
					nextAttemptAt,
					lastError: message.slice(0, 2_000),
				})
				.where(and(eq(executionOutbox.id, row.id), isNull(executionOutbox.publishedAt)))
		}
	}

	return { attempted: rows.length, published, failed }
}
