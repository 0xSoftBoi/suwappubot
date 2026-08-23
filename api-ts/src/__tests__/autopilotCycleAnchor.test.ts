/**
 * Anchoring inside the loop: a commitment that could not be witnessed on-chain
 * must not become a trade, and an exit must never be held hostage to it.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '../db/schema/autopilot'
import {
	type AutopilotAgent,
	autopilotAgents,
	autopilotDecisions,
	autopilotPositions,
} from '../db/schema/autopilot'
import { type MarketDeps, runCycleImpl } from '../services/AutopilotService'
import { EvmMemoAnchor, NullAnchor } from '../services/autopilot/anchor'
import { PaperExecutor } from '../services/autopilot/executor'
import { RulesThesisEngine } from '../services/autopilot/thesis'
import type { Candidate } from '../services/autopilot/types'

const MIGRATION = `${import.meta.dir}/../../drizzle/0022_familiar_goliath.sql`
const KEY = `0x${'1'.repeat(64)}` as const
const deps = { internalApiUrl: '', internalApiKey: '' }

// biome-ignore lint/suspicious/noExplicitAny: PGlite's drizzle client is
// structurally compatible with the postgres-js one for these queries.
type Db = any

const candidate: Candidate = {
	chain: 'base',
	tokenAddress: '0xdeadbeef00000000000000000000000000000001',
	symbol: 'DEEP',
	priceUsd: 1,
	liquidityUsd: 900_000,
	volume24hUsd: 2_700_000,
	priceChange1hPct: 12,
	ageMinutes: 5_000,
}

const market = (priceUsd: number, candidates: Candidate[] = [candidate]): MarketDeps => ({
	screenCandidates: async () => candidates,
	getTokenPriceUsd: async () => priceUsd,
	fetchTokenSecurity: async () => ({
		isHoneypot: false,
		buyTaxBps: 0,
		sellTaxBps: 0,
		topHolderPct: 18,
		lpLocked: true,
	}),
})

let db: Db
let agent: AutopilotAgent

async function freshDb(): Promise<void> {
	const client = new PGlite()
	db = drizzle(client, { schema })
	const sql = await Bun.file(MIGRATION).text()
	for (const statement of sql
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && s.toLowerCase().includes('autopilot'))) {
		await client.exec(statement)
	}
	const [row] = await db
		.insert(autopilotAgents)
		.values({
			slug: 'anchor-agent',
			name: 'Anchor Agent',
			chain: 'base',
			baseToken: 'USDC',
			mode: 'paper',
			status: 'active',
			startingEquityUsd: 1000,
			rules: { allowedChains: ['base'], maxPositionUsd: 100, tokenCooldownMinutes: 0 },
		})
		.returning()
	agent = row as AutopilotAgent
}

beforeEach(freshDb)

describe('anchoring an entry', () => {
	it('records the anchor tx on the decision and lets the trade proceed', async () => {
		const anchor = new EvmMemoAnchor('base', KEY, async () => '0xanchored')
		const report = await runCycleImpl(
			db,
			agent,
			new PaperExecutor(),
			new RulesThesisEngine(),
			deps,
			market(1),
			anchor,
		)

		expect(report.decisionsExecuted).toBe(1)
		const [d] = await db.select().from(autopilotDecisions)
		expect(d.sealTxHash).toBe('0xanchored')
		expect(d.sealChain).toBe('base')
		expect(d.status).toBe('filled')
	})

	it('refuses to execute an entry whose commitment could not be anchored', async () => {
		const anchor = new EvmMemoAnchor('base', KEY, async () => {
			throw new Error('rpc down')
		})
		const report = await runCycleImpl(
			db,
			agent,
			new PaperExecutor(),
			new RulesThesisEngine(),
			deps,
			market(1),
			anchor,
		)

		expect(report.decisionsExecuted).toBe(0)
		expect(report.errors.join(' ')).toContain('could not be anchored')

		const [d] = await db.select().from(autopilotDecisions)
		expect(d.status).toBe('failed')
		expect(d.executionError).toContain('anchor failed')
		expect(d.txHash).toBeNull()
		// Still revealed: a refused decision is published like any other.
		expect(d.revealedAt).not.toBeNull()

		expect(await db.select().from(autopilotPositions)).toHaveLength(0)
	})
})

describe('anchoring an exit', () => {
	it('does not let a failed anchor trap the agent in a position', async () => {
		// Open a position with anchoring healthy.
		await runCycleImpl(
			db,
			agent,
			new PaperExecutor(),
			new RulesThesisEngine(),
			deps,
			market(1),
			new EvmMemoAnchor('base', KEY, async () => '0xanchored'),
		)
		expect(await db.select().from(autopilotPositions)).toHaveLength(1)

		// Now the anchor breaks and the stop-loss fires.
		const report = await runCycleImpl(
			db,
			agent,
			new PaperExecutor(),
			new RulesThesisEngine(),
			deps,
			market(0.7, []),
			new EvmMemoAnchor('base', KEY, async () => {
				throw new Error('rpc down')
			}),
		)

		expect(report.decisionsExecuted).toBe(1)
		const positions = await db.select().from(autopilotPositions)
		expect(positions[0].status).toBe('closed')

		const sell = (await db.select().from(autopilotDecisions)).find(
			(d: { action: string }) => d.action === 'sell',
		)
		expect(sell.status).toBe('filled')
		expect(sell.sealTxHash).toBeNull() // honest: the exit went out unanchored
	})
})

describe('anchoring disabled', () => {
	it('trades normally and leaves the anchor columns empty', async () => {
		const report = await runCycleImpl(
			db,
			agent,
			new PaperExecutor(),
			new RulesThesisEngine(),
			deps,
			market(1),
			new NullAnchor(),
		)
		expect(report.decisionsExecuted).toBe(1)
		const [d] = await db.select().from(autopilotDecisions)
		expect(d.sealTxHash).toBeNull()
		expect(d.sealChain).toBeNull()
	})
})
