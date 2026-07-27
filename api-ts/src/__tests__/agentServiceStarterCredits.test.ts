import { describe, expect, it } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import {
	agentCreditTopups,
	agentCredits,
	agentRegistrationGrants,
	agents,
} from '../db/schema'
import { auditLogs } from '../db/schema/security'
import { DrizzleService } from '../db/DrizzleService'
import { AgentService, AgentServiceLive, type RegisterAgentParams } from '../services/AgentService'

/**
 * Regression coverage for the starter-credit grant in AgentService.registerAgent
 * (MONEY-PATH: mints free agent_credits on registration). Shipped with zero
 * direct tests — this suite exercises the anti-farm cap, the atomic
 * upsert-increment guard, the onConflictDoNothing honest-zero path, and the
 * fail-closed behavior on any DB error, all without a live database.
 *
 * The fake db below mirrors only the exact chainable shapes AgentService.ts
 * calls (insert().values().returning(), insert().values().onConflictDoUpdate()
 * .returning(), insert().values().onConflictDoNothing().returning(),
 * insert().values() with no further chain, and db.transaction(cb)) — matching
 * the precedent in paymentReplay.test.ts's makeFakeLedger.
 */

interface FakeDbOptions {
	/** Simulate the registration-grant guard upsert throwing (DB failure). */
	failGuard?: boolean
	/** Simulate the agentCredits/agentCreditTopups transaction throwing. */
	failGrantTx?: boolean
	/** Pre-seed an existing agentCredits row for a given agentId (onConflictDoNothing path). */
	preExistingCreditsAgentId?: number
}

function makeFakeDb(opts: FakeDbOptions = {}) {
	let agentIdSeq = 1
	const grantCounts = new Map<string, number>() // `${ip}|${day}` -> count
	const creditRows = new Map<number, any>() // agentId -> row
	const topupRows: any[] = []
	const auditRows: any[] = []

	if (opts.preExistingCreditsAgentId !== undefined) {
		creditRows.set(opts.preExistingCreditsAgentId, {
			agentId: opts.preExistingCreditsAgentId,
			balance: 0,
			lifetimePurchased: 0,
		})
	}

	function insertImpl(table: unknown) {
		return {
			values(vals: any) {
				if (table === agents) {
					return {
						returning: async () => {
							const row = {
								id: agentIdSeq++,
								name: vals.name,
								description: vals.description ?? null,
								apiKey: vals.apiKey,
								apiKeyHash: vals.apiKeyHash,
								callbackUrl: vals.callbackUrl ?? null,
								metadata: vals.metadata ?? null,
								isActive: true,
								totalRequests: 0,
								totalSwaps: 0,
								createdAt: new Date(),
								updatedAt: new Date(),
							}
							return [row]
						},
					}
				}

				if (table === agentRegistrationGrants) {
					return {
						onConflictDoUpdate(_cfg: unknown) {
							return {
								returning: async () => {
									if (opts.failGuard) throw new Error('simulated registration-grant guard failure')
									const key = `${vals.ip}|${vals.day}`
									const next = (grantCounts.get(key) ?? 0) + 1
									grantCounts.set(key, next)
									return [{ ip: vals.ip, day: vals.day, count: next }]
								},
							}
						},
					}
				}

				if (table === agentCredits) {
					return {
						onConflictDoNothing() {
							return {
								returning: async () => {
									if (opts.failGrantTx) throw new Error('simulated credit-grant failure')
									if (creditRows.has(vals.agentId)) return []
									const row = {
										id: creditRows.size + 1,
										agentId: vals.agentId,
										balance: vals.balance,
										lifetimePurchased: vals.lifetimePurchased,
										lifetimeUsed: 0,
										createdAt: new Date(),
										updatedAt: new Date(),
									}
									creditRows.set(vals.agentId, row)
									return [row]
								},
							}
						},
					}
				}

				if (table === agentCreditTopups) {
					// AgentService awaits this directly with no further chain call.
					return (async () => {
						if (opts.failGrantTx) throw new Error('simulated topup-audit failure')
						const row = { id: topupRows.length + 1, ...vals }
						topupRows.push(row)
						return [row]
					})()
				}

				if (table === auditLogs) {
					// audit.ts awaits db.insert(auditLogs).values(...) directly (no .returning()).
					return (async () => {
						auditRows.push(vals)
						return []
					})()
				}

				throw new Error(`makeFakeDb: unexpected table in insert(): ${String(table)}`)
			},
		}
	}

	const db: any = {
		insert: insertImpl,
		transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
	}

	return { db, grantCounts, creditRows, topupRows, auditRows }
}

function runRegister(db: unknown, params: RegisterAgentParams) {
	const dbLayer = Layer.succeed(DrizzleService, Option.some(db as never))
	const program = Effect.gen(function* () {
		const svc = yield* AgentService
		return yield* svc.registerAgent(params)
	})
	return Effect.runPromise(program.pipe(Effect.provide(Layer.merge(AgentServiceLive, dbLayer))))
}

describe('AgentService.registerAgent starter-credit grant (MONEY-PATH)', () => {
	it('under the daily cap: grants 100 credits, inserts a balanced agent_credits row, and writes an honest starter_grant audit row', async () => {
		const { db, creditRows, topupRows } = makeFakeDb()

		const result = await runRegister(db, { name: 'agent-a', ip: '1.2.3.4' })

		expect(result.grantedCredits).toBe(100)

		const creditRow = creditRows.get(result.agent.id)
		expect(creditRow).toBeDefined()
		expect(creditRow.balance).toBe(100)
		expect(creditRow.lifetimePurchased).toBe(100)
		// Balance must never exceed what was ever purchased/granted (money-path invariant).
		expect(creditRow.balance).toBeLessThanOrEqual(creditRow.lifetimePurchased)

		expect(topupRows).toHaveLength(1)
		expect(topupRows[0]).toMatchObject({
			agentId: result.agent.id,
			txHash: `starter_grant:${result.agent.id}`,
			chain: 'starter_grant',
			amountUsd: 0,
			creditsAdded: 100,
		})
	})

	it('over the daily cap: withholds credits (grantedCredits === 0) but registration still succeeds', async () => {
		const { db, creditRows, topupRows } = makeFakeDb()
		const ip = '9.9.9.9'

		// Exhaust the cap (MAX_STARTER_GRANTS_PER_IP_PER_DAY = 3).
		await runRegister(db, { name: 'agent-b1', ip })
		await runRegister(db, { name: 'agent-b2', ip })
		await runRegister(db, { name: 'agent-b3', ip })

		const fourth = await runRegister(db, { name: 'agent-b4', ip })

		expect(fourth.grantedCredits).toBe(0)
		expect(fourth.agent).toBeDefined()
		expect(fourth.apiKey).toBeTruthy()
		expect(creditRows.has(fourth.agent.id)).toBe(false)
		// No topup audit row written for the withheld grant.
		expect(topupRows.some((t) => t.agentId === fourth.agent.id)).toBe(false)
	})

	it('registration-grant guard failure fails CLOSED: no credits minted, registration still succeeds', async () => {
		const { db, creditRows, topupRows } = makeFakeDb({ failGuard: true })

		const result = await runRegister(db, { name: 'agent-c', ip: '5.5.5.5' })

		expect(result.grantedCredits).toBe(0)
		expect(result.agent).toBeDefined()
		expect(creditRows.has(result.agent.id)).toBe(false)
		expect(topupRows).toHaveLength(0)
	})

	it('credit-grant transaction failure fails CLOSED: no credits minted, registration still succeeds', async () => {
		const { db, creditRows, topupRows } = makeFakeDb({ failGrantTx: true })

		const result = await runRegister(db, { name: 'agent-d', ip: '6.6.6.6' })

		expect(result.grantedCredits).toBe(0)
		expect(result.agent).toBeDefined()
		expect(creditRows.has(result.agent.id)).toBe(false)
		expect(topupRows).toHaveLength(0)
	})

	it('a pre-existing agent_credits row (onConflictDoNothing) is honestly reported as 0 granted, never double-granted', async () => {
		const { db, creditRows, topupRows } = makeFakeDb({ preExistingCreditsAgentId: 1 })

		// The fake db's first minted agent gets id 1, colliding with the pre-seeded row.
		const result = await runRegister(db, { name: 'agent-e', ip: '7.7.7.7' })

		expect(result.agent.id).toBe(1)
		expect(result.grantedCredits).toBe(0)
		// The pre-existing row is untouched (still its original zero balance), not overwritten.
		expect(creditRows.get(1)?.balance).toBe(0)
		expect(topupRows).toHaveLength(0)
	})

	it('distinct IPs get independent daily buckets; the same IP+day accumulates', async () => {
		const { db, grantCounts } = makeFakeDb()

		const r1 = await runRegister(db, { name: 'agent-f1', ip: '10.0.0.1' })
		const r2 = await runRegister(db, { name: 'agent-f2', ip: '10.0.0.2' })
		const r3 = await runRegister(db, { name: 'agent-f3', ip: '10.0.0.1' })

		// Both IPs are well under the cap, so both grants succeed independently.
		expect(r1.grantedCredits).toBe(100)
		expect(r2.grantedCredits).toBe(100)
		expect(r3.grantedCredits).toBe(100)

		const today = new Date().toISOString().slice(0, 10)
		expect(grantCounts.get(`10.0.0.1|${today}`)).toBe(2)
		expect(grantCounts.get(`10.0.0.2|${today}`)).toBe(1)
	})

	it('missing IP (undefined) is bucketed under "unknown" and still capped per day', async () => {
		const { db } = makeFakeDb()

		const r1 = await runRegister(db, { name: 'agent-g1' })
		const r2 = await runRegister(db, { name: 'agent-g2' })
		const r3 = await runRegister(db, { name: 'agent-g3' })
		const r4 = await runRegister(db, { name: 'agent-g4' })

		expect(r1.grantedCredits).toBe(100)
		expect(r2.grantedCredits).toBe(100)
		expect(r3.grantedCredits).toBe(100)
		// 4th registration with no IP shares the 'unknown' bucket and hits the cap.
		expect(r4.grantedCredits).toBe(0)
	})
})
