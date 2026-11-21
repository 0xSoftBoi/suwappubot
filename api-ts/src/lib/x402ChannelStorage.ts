import type {
	Channel,
	ChannelStorage,
	ChannelUpdateResult,
} from '@x402/evm/batch-settlement/server'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { requireDb } from '../db/DrizzleService'
import { x402Channels } from '../db/schema'
import { runEffect } from '../runtime'

/**
 * Postgres-backed {@link ChannelStorage} for the x402 v2 `batch-settlement`
 * scheme.
 *
 * MONEY-PATH. Every row holds the latest signed cumulative voucher for a
 * payment channel — the only thing that lets us claim the money an agent has
 * already spent with us. The SDK's InMemoryChannelStorage would lose every
 * unclaimed voucher on each Railway redeploy, and FileChannelStorage does not
 * survive container replacement either, so neither is acceptable here.
 *
 * Atomicity: `updateChannel` must guarantee no concurrent mutation interleaves
 * between reading `current` and writing the callback result, across every
 * api-ts replica. We do that with an optimistic `version` column:
 *   read (row, version) → run the synchronous callback → write WHERE version = v
 * and retry on a lost race. The SDK contract requires the callback to be
 * synchronous and deterministic precisely so retries are safe. After
 * {@link MAX_CAS_ATTEMPTS} lost races we return `{ status: 'conflict' }`
 * rather than throwing, as the contract asks.
 */

const MAX_CAS_ATTEMPTS = 6

type Row = { data: unknown; version: number }

const db = <A>(f: (d: Effect.Effect.Success<typeof requireDb>) => Promise<A>) =>
	runEffect(
		Effect.gen(function* () {
			const d = yield* requireDb
			return yield* Effect.tryPromise({
				try: () => f(d),
				catch: (e) =>
					new Error(`[x402ChannelStorage] ${e instanceof Error ? e.message : String(e)}`),
			})
		}),
	)

function payerOf(ch: Channel): string | null {
	const cfg = ch.channelConfig as unknown as { payer?: string } | undefined
	return cfg?.payer ? String(cfg.payer).toLowerCase() : null
}

export class PostgresChannelStorage implements ChannelStorage {
	async get(channelId: string): Promise<Channel | undefined> {
		const rows = await db((d) =>
			d
				.select({ data: x402Channels.data })
				.from(x402Channels)
				.where(eq(x402Channels.channelId, channelId))
				.limit(1),
		)
		return rows[0] ? ({ ...(rows[0].data as Channel) } as Channel) : undefined
	}

	async list(): Promise<Channel[]> {
		const rows = await db((d) => d.select({ data: x402Channels.data }).from(x402Channels))
		return rows.map((r) => r.data as Channel)
	}

	async updateChannel(
		channelId: string,
		update: (current: Channel | undefined) => Channel | undefined,
	): Promise<ChannelUpdateResult> {
		for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
			const rows: Row[] = await db((d) =>
				d
					.select({ data: x402Channels.data, version: x402Channels.version })
					.from(x402Channels)
					.where(eq(x402Channels.channelId, channelId))
					.limit(1),
			)
			const row = rows[0]
			const current = row ? ({ ...(row.data as Channel) } as Channel) : undefined
			const next = update(current)

			// Unchanged (callback returned the same object, or both absent).
			if (next === current || (next === undefined && current === undefined)) {
				return { channel: current, status: 'unchanged' }
			}

			if (next === undefined) {
				// Delete — only if nobody bumped the row since we read it.
				const del = await db((d) =>
					d
						.delete(x402Channels)
						.where(
							and(eq(x402Channels.channelId, channelId), eq(x402Channels.version, row!.version)),
						)
						.returning({ id: x402Channels.channelId }),
				)
				if (del.length > 0) return { channel: undefined, status: 'deleted' }
				continue
			}

			if (!row) {
				// Insert — ON CONFLICT DO NOTHING detects a concurrent creator.
				const ins = await db((d) =>
					d
						.insert(x402Channels)
						.values({
							channelId,
							network: next.network ?? null,
							payer: payerOf(next),
							data: next,
							version: 1,
						})
						.onConflictDoNothing()
						.returning({ id: x402Channels.channelId }),
				)
				if (ins.length > 0) return { channel: next, status: 'updated' }
				continue
			}

			const upd = await db((d) =>
				d
					.update(x402Channels)
					.set({
						data: next,
						network: next.network ?? null,
						payer: payerOf(next),
						version: row.version + 1,
						updatedAt: new Date(),
					})
					.where(and(eq(x402Channels.channelId, channelId), eq(x402Channels.version, row.version)))
					.returning({ id: x402Channels.channelId }),
			)
			if (upd.length > 0) return { channel: next, status: 'updated' }
		}
		return { channel: undefined, status: 'conflict' }
	}
}
