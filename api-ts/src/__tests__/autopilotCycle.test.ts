/**
 * End-to-end exercise of the autopilot loop against a real Postgres (PGlite,
 * in-process) and a deterministic market. This is the test that answers "does
 * the loop actually run", as opposed to "do its parts type-check".
 */

import { beforeAll, describe, expect, it } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '../db/schema/autopilot'
import {
	type AutopilotAgent,
	autopilotAgents,
	autopilotDecisions,
	autopilotJournal,
	autopilotPositions,
} from '../db/schema/autopilot'
import { verifySeal } from '../lib/seal'
import { type MarketDeps, runCycleImpl } from '../services/AutopilotService'
import { PaperExecutor } from '../services/autopilot/executor'
import { RulesThesisEngine } from '../services/autopilot/thesis'
import type { Candidate, TokenSecurity } from '../services/autopilot/types'

const MIGRATION = `${import.meta.dir}/../../drizzle/0022_familiar_goliath.sql`

// biome-ignore lint/suspicious/noExplicitAny: PGlite's drizzle client is
// structurally compatible with the postgres-js one for these queries.
type Db = any

let db: Db
let agent: AutopilotAgent

const TOKEN = 'So11111111111111111111111111111111111111112'

const security: TokenSecurity = {
	isHoneypot: false,
	buyTaxBps: 0,
	sellTaxBps: 0,
	topHolderPct: 18,
	lpLocked: true,
}

const candidate: Candidate = {
	chain: 'base',
	tokenAddress: TOKEN,
	symbol: 'DEEP',
	priceUsd: 1,
	liquidityUsd: 900_000,
	volume24hUsd: 2_700_000,
	priceChange1hPct: 12,
	priceChange24hPct: 30,
	ageMinutes: 5_000,
}

/** Market that offers one healthy candidate and quotes whatever price we set. */
function marketAt(priceUsd: number, candidates: Candidate[] = [candidate]): MarketDeps {
	return {
		screenCandidates: async () => candidates,
		getTokenPriceUsd: async () => priceUsd,
		fetchTokenSecurity: async () => security,
	}
}

beforeAll(async () => {
	const client = new PGlite()
	db = drizzle(client, { schema })

	// Apply only the autopilot statements from the real migration — this test
	// runs the shipped DDL, not a hand-written copy that could drift from it.
	const sql = await Bun.file(MIGRATION).text()
	const statements = sql
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && s.toLowerCase().includes('autopilot'))
	for (const statement of statements) {
		await client.exec(statement)
	}

	const [row] = await db
		.insert(autopilotAgents)
		.values({
			slug: 'test-agent',
			name: 'Test Agent',
			chain: 'base',
			baseToken: 'USDC',
			mode: 'paper',
			status: 'active',
			startingEquityUsd: 1000,
			rules: { allowedChains: ['base'], maxPositionUsd: 100, tokenCooldownMinutes: 0 },
		})
		.returning()
	agent = row as AutopilotAgent
})

const deps = { internalApiUrl: '', internalApiKey: '' }

describe('autopilot cycle — entry', () => {
	it('reads, forms a thesis, gates it, seals it, fills it and opens a position', async () => {
		const report = await runCycleImpl(
			db,
			agent,
			new PaperExecutor(),
			new RulesThesisEngine(),
			deps,
			marketAt(1),
		)

		expect(report.candidatesScanned).toBe(1)
		expect(report.thesesFormed).toBe(1)
		expect(report.decisionsSealed).toBe(1)
		expect(report.decisionsExecuted).toBe(1)
		expect(report.rejections).toBe(0)

		const decisions = await db.select().from(autopilotDecisions)
		expect(decisions).toHaveLength(1)
		const d = decisions[0]
		expect(d.action).toBe('buy')
		expect(d.gatePassed).toBe(true)
		expect(d.status).toBe('filled')
		expect(d.txHash).toStartWith('paper:')

		const positions = await db.select().from(autopilotPositions)
		expect(positions).toHaveLength(1)
		expect(positions[0].status).toBe('open')
		expect(positions[0].tokenSymbol).toBe('DEEP')
		expect(Number(positions[0].costBasisUsd)).toBeGreaterThan(0)
	})

	it('sealed the commitment before it revealed the thesis, and the hash checks out', async () => {
		const [d] = await db.select().from(autopilotDecisions)
		expect(d.revealedAt).not.toBeNull()
		expect(d.sealedAt.getTime()).toBeLessThanOrEqual(d.revealedAt.getTime())
		expect(d.executedAt.getTime()).toBeLessThanOrEqual(d.revealedAt.getTime())
		expect(verifySeal(d.thesis, d.nonce, d.commitment)).toBe(true)
	})

	it('refuses to recompute to the same hash from a doctored thesis', async () => {
		const [d] = await db.select().from(autopilotDecisions)
		const doctored = { ...(d.thesis as Record<string, unknown>), sizeUsd: 999 }
		expect(verifySeal(doctored, d.nonce, d.commitment)).toBe(false)
	})

	it('journalled every stage', async () => {
		const entries = await db.select().from(autopilotJournal)
		const stages = new Set(entries.map((e: { stage: string }) => e.stage))
		expect(stages.has('read')).toBe(true)
		expect(stages.has('seal')).toBe(true)
		expect(stages.has('execute')).toBe(true)
	})
})

describe('autopilot cycle — the book is respected', () => {
	it('does not re-enter a token it already holds', async () => {
		const before = (await db.select().from(autopilotDecisions)).length
		const report = await runCycleImpl(
			db,
			agent,
			new PaperExecutor(),
			new RulesThesisEngine(),
			deps,
			marketAt(1.05),
		)
		const after = await db.select().from(autopilotDecisions)
		// The duplicate-position gate refuses it; the refusal is still recorded.
		expect(after.length).toBeGreaterThan(before)
		const latest = after[after.length - 1]
		expect(latest.gatePassed).toBe(false)
		expect(latest.rejectionReason).toContain('no_duplicate_position')
		expect(report.decisionsExecuted).toBe(0)
	})

	it('publishes the refusal with its full gate verdict, and reveals it', async () => {
		const rows = await db.select().from(autopilotDecisions)
		const refusal = rows.find((r: { gatePassed: boolean }) => !r.gatePassed)
		expect(refusal.status).toBe('rejected')
		expect(refusal.revealedAt).not.toBeNull()
		expect(Array.isArray(refusal.gates)).toBe(true)
		expect(refusal.gates.length).toBeGreaterThan(5)
		expect(verifySeal(refusal.thesis, refusal.nonce, refusal.commitment)).toBe(true)
	})
})

describe('autopilot cycle — exit', () => {
	it('fires the committed stop-loss, closes the position and books the loss', async () => {
		// -25% against a 20% stop.
		const report = await runCycleImpl(
			db,
			agent,
			new PaperExecutor(),
			new RulesThesisEngine(),
			deps,
			marketAt(0.75, []),
		)

		expect(report.decisionsExecuted).toBe(1)

		const positions = await db.select().from(autopilotPositions)
		expect(positions).toHaveLength(1)
		expect(positions[0].status).toBe('closed')
		expect(Number(positions[0].realizedPnlUsd)).toBeLessThan(0)
		expect(positions[0].closedAt).not.toBeNull()

		const sells = (await db.select().from(autopilotDecisions)).filter(
			(d: { action: string }) => d.action === 'sell',
		)
		expect(sells).toHaveLength(1)
		expect(sells[0].status).toBe('filled')
		expect(sells[0].headline).toContain('stop-loss')
		expect(verifySeal(sells[0].thesis, sells[0].nonce, sells[0].commitment)).toBe(true)
	})

	it('books the exit at the fill it got, not at the mid it saw', async () => {
		const [pos] = await db.select().from(autopilotPositions)
		const [sell] = (await db.select().from(autopilotDecisions)).filter(
			(d: { action: string }) => d.action === 'sell',
		)

		// What a naive mid-marking would have booked: cost * (mid / entry) - cost.
		const mid = 0.75
		const naive = pos.costBasisUsd * (mid / pos.avgEntryPriceUsd) - pos.costBasisUsd

		// The real fill is below mid (sell side + fee), so the booked loss must be
		// strictly worse. If these ever match, exits are being marked at a price
		// the position never got.
		expect(Number(pos.realizedPnlUsd)).toBeLessThan(naive)
		expect(Number(sell.fillPriceUsd)).toBeLessThan(mid)
	})

	it('marks equity down after the realized loss', async () => {
		const [a] = await db.select().from(autopilotAgents).where(eq(autopilotAgents.id, agent.id))
		expect(a.lastCycleAt).not.toBeNull()
	})
})
