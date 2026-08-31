import { describe, expect, it } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { agents } from '../db/schema'
import { DrizzleService } from '../db/DrizzleService'
import { AgentService, AgentServiceLive } from '../services/AgentService'
import {
	findReservedAgentMetadataKeys,
	mergeAgentMetadata,
	RESERVED_AGENT_METADATA_KEYS,
} from '../services/agentMetadataKeys'
import { UpdateAgentSchema } from '../routes/validators'

/**
 * Regression coverage for the custodial-wallet-rebind vulnerability: PATCH
 * /v1/agent/me wrote params.metadata wholesale with no reserved-key filter
 * and no merge, letting an agent overwrite its own wallet_address /
 * internal_user_id / internal_wallet_id / wallet_sub_org_id (and the
 * Polymarket walletAddress/subOrgId pair) to rebind to an arbitrary —
 * including victim — custodial wallet.
 *
 * Fix: AgentService.updateAgent now merges caller metadata into the stored
 * row and strips reserved keys (agentMetadataKeys.mergeAgentMetadata), and
 * UpdateAgentSchema additionally rejects (400) any request whose metadata
 * contains a reserved key.
 */

const BOUND_METADATA = {
	wallet_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	internal_user_id: 42,
	internal_wallet_id: 7,
	wallet_sub_org_id: 'sub-org-victim',
	walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	subOrgId: 'sub-org-victim',
	custom_note: 'set at provisioning time',
}

function makeFakeDb(initialMetadata: Record<string, unknown>) {
	const rows = new Map<number, any>()
	rows.set(1, {
		id: 1,
		name: 'agent-a',
		description: 'orig',
		callbackUrl: null,
		metadata: initialMetadata,
		updatedAt: new Date(0),
	})

	const db: any = {
		select() {
			return {
				from(table: unknown) {
					if (table !== agents) throw new Error('unexpected select table')
					return {
						where: async (_cond: unknown) => {
							// Tests only ever query agent id 1.
							const row = rows.get(1)
							return row ? [{ metadata: row.metadata }] : []
						},
					}
				},
			}
		},
		update(table: unknown) {
			if (table !== agents) throw new Error('unexpected update table')
			return {
				set(updates: Record<string, unknown>) {
					return {
						where: () => ({
							returning: async () => {
								const row = rows.get(1)
								if (!row) return []
								Object.assign(row, updates)
								rows.set(1, row)
								return [row]
							},
						}),
					}
				},
			}
		},
	}

	return { db, rows }
}

function runUpdate(db: unknown, agentId: number, params: { metadata?: Record<string, unknown> }) {
	const dbLayer = Layer.succeed(DrizzleService, Option.some(db as never))
	const program = Effect.gen(function* () {
		const svc = yield* AgentService
		return yield* svc.updateAgent(agentId, params)
	})
	return Effect.runPromise(program.pipe(Effect.provide(Layer.merge(AgentServiceLive, dbLayer))))
}

function runBind(db: unknown, agentId: number, binding: Record<string, unknown>) {
	const dbLayer = Layer.succeed(DrizzleService, Option.some(db as never))
	const program = Effect.gen(function* () {
		const svc = yield* AgentService
		return yield* svc.bindManagedWallet(agentId, binding)
	})
	return Effect.runPromise(program.pipe(Effect.provide(Layer.merge(AgentServiceLive, dbLayer))))
}

describe('agentMetadataKeys reserved-key set', () => {
	it('covers every metadata key the swap/signing/ownership path trusts', () => {
		expect(new Set(RESERVED_AGENT_METADATA_KEYS)).toEqual(
			new Set([
				'wallet_address',
				'internal_user_id',
				'internal_wallet_id',
				'wallet_sub_org_id',
				'walletAddress',
				'subOrgId',
			]),
		)
	})
})

describe('AgentService.updateAgent (MONEY-PATH: custodial wallet binding)', () => {
	it('strips each reserved key from caller metadata one at a time and preserves the stored binding', async () => {
		for (const key of RESERVED_AGENT_METADATA_KEYS) {
			const { db, rows } = makeFakeDb(BOUND_METADATA)
			const attackerValue =
				key === 'internal_user_id' || key === 'internal_wallet_id' ? 999 : 'attacker-controlled'

			await runUpdate(db, 1, { metadata: { [key]: attackerValue, unrelated: 'ok' } })

			const stored = rows.get(1)!.metadata as Record<string, unknown>
			expect(stored[key]).toBe((BOUND_METADATA as Record<string, unknown>)[key])
			expect(stored[key]).not.toBe(attackerValue)
			// Non-reserved fields still merge through.
			expect(stored.unrelated).toBe('ok')
			// The rest of the binding is untouched too.
			for (const otherKey of RESERVED_AGENT_METADATA_KEYS) {
				expect(stored[otherKey]).toBe((BOUND_METADATA as Record<string, unknown>)[otherKey])
			}
		}
	})

	it('rejects an attempt to overwrite the entire binding in a single PATCH', async () => {
		const { db, rows } = makeFakeDb(BOUND_METADATA)

		await runUpdate(db, 1, {
			metadata: {
				wallet_address: '0x000000000000000000000000000000000000ff',
				internal_user_id: 1,
				internal_wallet_id: 1,
				wallet_sub_org_id: 'attacker-org',
				walletAddress: '0x000000000000000000000000000000000000ff',
				subOrgId: 'attacker-org',
			},
		})

		const stored = rows.get(1)!.metadata as Record<string, unknown>
		expect(stored).toEqual(BOUND_METADATA)
	})

	it('merges non-reserved keys normally and preserves existing reserved values untouched', async () => {
		const { db, rows } = makeFakeDb(BOUND_METADATA)

		const result = await runUpdate(db, 1, {
			metadata: { display_name: 'My Agent', theme: 'dark' },
		})

		const stored = result.metadata as Record<string, unknown>
		expect(stored.display_name).toBe('My Agent')
		expect(stored.theme).toBe('dark')
		expect(stored.custom_note).toBe('set at provisioning time')
		for (const key of RESERVED_AGENT_METADATA_KEYS) {
			expect(stored[key]).toBe((BOUND_METADATA as Record<string, unknown>)[key])
		}
	})

	it('a second merge only touches the newly-supplied keys, never reintroducing stale reserved input', async () => {
		const { db, rows } = makeFakeDb(BOUND_METADATA)

		await runUpdate(db, 1, { metadata: { a: 1 } })
		await runUpdate(db, 1, { metadata: { b: 2, wallet_address: 'attacker' } })

		const stored = rows.get(1)!.metadata as Record<string, unknown>
		expect(stored.a).toBe(1)
		expect(stored.b).toBe(2)
		expect(stored.wallet_address).toBe(BOUND_METADATA.wallet_address)
	})
})

describe('AgentService.bindManagedWallet (MONEY-PATH: privileged provisioning path)', () => {
	it('regression: a newly-provisioned agent (empty metadata) gets its full reserved binding persisted', async () => {
		// This is exactly the POST /v1/agent/wallets flow at agent.ts:2494 — a
		// fresh agent has NO existing metadata. Routing this write through the
		// caller-facing updateAgent/mergeAgentMetadata strip would delete every
		// reserved key it just tried to set (force-restore else-branch has
		// nothing to restore from), silently failing to bind the wallet and
		// leaving every subsequent POST /swap/execute returning WALLET_NOT_FOUND.
		const { db, rows } = makeFakeDb({})

		const result = await runBind(db, 1, {
			wallet_address: BOUND_METADATA.wallet_address,
			wallet_sub_org_id: BOUND_METADATA.wallet_sub_org_id,
			internal_user_id: BOUND_METADATA.internal_user_id,
			internal_wallet_id: BOUND_METADATA.internal_wallet_id,
		})

		const stored = result.metadata as Record<string, unknown>
		expect(stored.wallet_address).toBe(BOUND_METADATA.wallet_address)
		expect(stored.wallet_sub_org_id).toBe(BOUND_METADATA.wallet_sub_org_id)
		expect(stored.internal_user_id).toBe(BOUND_METADATA.internal_user_id)
		expect(stored.internal_wallet_id).toBe(BOUND_METADATA.internal_wallet_id)
		// Also reflected in the persisted row (not just the returned value).
		expect(rows.get(1)!.metadata).toEqual(stored)
	})

	it('preserves unrelated existing metadata when binding a wallet onto an already-customized agent', async () => {
		const { db, rows } = makeFakeDb({ display_name: 'My Agent', theme: 'dark' })

		await runBind(db, 1, {
			wallet_address: BOUND_METADATA.wallet_address,
			wallet_sub_org_id: BOUND_METADATA.wallet_sub_org_id,
		})

		const stored = rows.get(1)!.metadata as Record<string, unknown>
		expect(stored.display_name).toBe('My Agent')
		expect(stored.theme).toBe('dark')
		expect(stored.wallet_address).toBe(BOUND_METADATA.wallet_address)
	})

	it('PATCH /me (updateAgent) still cannot set reserved keys even right after a fresh bind', async () => {
		const { db, rows } = makeFakeDb({})

		await runBind(db, 1, {
			wallet_address: BOUND_METADATA.wallet_address,
			wallet_sub_org_id: BOUND_METADATA.wallet_sub_org_id,
			internal_user_id: BOUND_METADATA.internal_user_id,
			internal_wallet_id: BOUND_METADATA.internal_wallet_id,
		})

		// Attacker (or the agent itself) now tries to rebind via the caller-facing path.
		await runUpdate(db, 1, {
			metadata: { wallet_address: 'attacker-controlled', internal_wallet_id: 999 },
		})

		const stored = rows.get(1)!.metadata as Record<string, unknown>
		expect(stored.wallet_address).toBe(BOUND_METADATA.wallet_address)
		expect(stored.internal_wallet_id).toBe(BOUND_METADATA.internal_wallet_id)
	})
})

describe('mergeAgentMetadata (unit)', () => {
	it('drops reserved keys from incoming and keeps existing reserved values', () => {
		const merged = mergeAgentMetadata(BOUND_METADATA, {
			wallet_address: 'attacker',
			note: 'hi',
		})
		expect(merged.wallet_address).toBe(BOUND_METADATA.wallet_address)
		expect(merged.note).toBe('hi')
	})

	it('handles null/undefined existing and incoming gracefully', () => {
		expect(mergeAgentMetadata(null, { a: 1 })).toEqual({ a: 1 })
		expect(mergeAgentMetadata({ a: 1 }, null)).toEqual({ a: 1 })
		expect(mergeAgentMetadata(undefined, undefined)).toEqual({})
	})
})

describe('UpdateAgentSchema (belt-and-suspenders 400 on reserved keys)', () => {
	it('rejects a PATCH body containing any reserved key', () => {
		for (const key of RESERVED_AGENT_METADATA_KEYS) {
			const result = UpdateAgentSchema.safeParse({ metadata: { [key]: 'x' } })
			expect(result.success).toBe(false)
		}
	})

	it('rejects when a reserved key is mixed in with legitimate fields', () => {
		const result = UpdateAgentSchema.safeParse({
			description: 'hello',
			metadata: { theme: 'dark', internal_wallet_id: 5 },
		})
		expect(result.success).toBe(false)
	})

	it('accepts a PATCH body with only non-reserved metadata', () => {
		const result = UpdateAgentSchema.safeParse({
			metadata: { theme: 'dark', display_name: 'Agent' },
		})
		expect(result.success).toBe(true)
	})

	it('findReservedAgentMetadataKeys reports the exact offending keys', () => {
		expect(
			findReservedAgentMetadataKeys({ wallet_address: 'x', subOrgId: 'y', theme: 'dark' }),
		).toEqual(expect.arrayContaining(['wallet_address', 'subOrgId']))
		expect(findReservedAgentMetadataKeys({ theme: 'dark' })).toEqual([])
		expect(findReservedAgentMetadataKeys(undefined)).toEqual([])
	})
})
