import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/pglite'
import type { DbClient } from '../db/client'
import { executionOutbox } from '../db/schema/execution'
import {
	buildExecutionAuditChainEntry,
	createSignedAuditCheckpoint,
} from '../lib/executionAuditCheckpoint'
import { publishExecutionOutboxBatch } from '../lib/executionOutboxPublisher'
import { deriveEvmSubmissionIdentity } from '../lib/submissionIdentity'

const DECISION_A = 'a'.repeat(64)
const DECISION_B = 'b'.repeat(64)

let pg: PGlite | null = null

afterEach(async () => {
	if (pg) await pg.close()
	pg = null
})

describe('pre-broadcast submission identity', () => {
	test('signed EVM bytes deterministically produce the external transaction identity', () => {
		const first = deriveEvmSubmissionIdentity('0x01')
		const second = deriveEvmSubmissionIdentity('0x01')
		expect(first.externalTxHash).toBe(second.externalTxHash)
		expect(first.externalTxHash).toMatch(/^0x[0-9a-f]{64}$/)
	})

	test('empty/unsigned placeholder bytes are rejected', () => {
		expect(() => deriveEvmSubmissionIdentity('0x')).toThrow('Signed EVM transaction bytes are required')
	})
})

describe('externally signable audit chain', () => {
	test('each entry commits to the previous chain head', () => {
		const first = buildExecutionAuditChainEntry({
			sequence: 1,
			parentOrderId: 'parent-1',
			decisionDigest: DECISION_A,
		})
		const second = buildExecutionAuditChainEntry({
			sequence: 2,
			parentOrderId: 'parent-2',
			decisionDigest: DECISION_B,
			previousChainDigest: first.chainDigest,
		})
		const reordered = buildExecutionAuditChainEntry({
			sequence: 2,
			parentOrderId: 'parent-2',
			decisionDigest: DECISION_B,
			previousChainDigest: null,
		})

		expect(first.chainDigest).toMatch(/^[0-9a-f]{64}$/)
		expect(second.chainDigest).not.toBe(reordered.chainDigest)
	})

	test('checkpoint signing is delegated to a key boundary outside the DB', async () => {
		const entry = buildExecutionAuditChainEntry({
			sequence: 7,
			parentOrderId: 'parent-7',
			decisionDigest: DECISION_A,
		})
		let signedBytes = 0
		const checkpoint = await createSignedAuditCheckpoint(
			entry,
			{
				keyId: 'kms://audit-prod/key-1',
				sign: async (payload) => {
					signedBytes = payload.byteLength
					return 'test-signature'
				},
			},
			new Date('2026-08-25T00:00:00Z'),
		)

		expect(signedBytes).toBeGreaterThan(0)
		expect(checkpoint.chainDigest).toBe(entry.chainDigest)
		expect(checkpoint.keyId).toBe('kms://audit-prod/key-1')
		expect(checkpoint.signature).toBe('test-signature')
	})
})

describe('execution outbox delivery contract', () => {
	async function outboxDb(): Promise<DbClient> {
		pg = new PGlite()
		await pg.exec(`
			CREATE TABLE execution_outbox (
				id varchar(36) PRIMARY KEY,
				event_id varchar(36) NOT NULL UNIQUE,
				topic varchar(128) NOT NULL,
				payload_json jsonb,
				attempts integer DEFAULT 0 NOT NULL,
				published_at timestamp,
				next_attempt_at timestamp,
				last_error text,
				created_at timestamp DEFAULT now() NOT NULL
			);
		`)
		return drizzle(pg) as unknown as DbClient
	}

	test('publishes event_id as the stable consumer idempotency key', async () => {
		const db = await outboxDb()
		await db.insert(executionOutbox).values({
			id: '00000000-0000-0000-0000-000000000001',
			eventId: '00000000-0000-0000-0000-000000000002',
			topic: 'execution.submission_acknowledged',
			payloadJson: { parentOrderId: 'p1' },
		})
		const envelopes: Array<{ idempotencyKey: string; topic: string }> = []
		const result = await publishExecutionOutboxBatch(db, {
			publish: async (envelope) => {
				envelopes.push({ idempotencyKey: envelope.idempotencyKey, topic: envelope.topic })
			},
		})

		expect(result).toEqual({ attempted: 1, published: 1, failed: 0 })
		expect(envelopes).toEqual([
			{
				idempotencyKey: '00000000-0000-0000-0000-000000000002',
				topic: 'execution.submission_acknowledged',
			},
		])
	})

	test('failed delivery remains unpublished and receives bounded retry metadata', async () => {
		const db = await outboxDb()
		await db.insert(executionOutbox).values({
			id: '00000000-0000-0000-0000-000000000011',
			eventId: '00000000-0000-0000-0000-000000000012',
			topic: 'execution.submission_indeterminate',
		})
		const now = new Date('2026-08-25T00:00:00Z')
		const result = await publishExecutionOutboxBatch(
			db,
			{ publish: async () => Promise.reject(new Error('broker unavailable')) },
			{ now, baseRetryMs: 1_000, maxRetryMs: 10_000 },
		)
		const [row] = await db.select().from(executionOutbox)

		expect(result).toEqual({ attempted: 1, published: 0, failed: 1 })
		expect(row?.publishedAt).toBeNull()
		expect(row?.attempts).toBe(1)
		expect(row?.nextAttemptAt?.getTime()).toBe(now.getTime() + 1_000)
		expect(row?.lastError).toBe('broker unavailable')
	})
})
