#!/usr/bin/env bun
/**
 * Run the autopilot loop against an ephemeral in-process Postgres and serve the
 * public read API from it.
 *
 * This is the dev rig for the dashboard: it exercises the real cycle, the real
 * DDL and the real response shapes without needing a database, an API key or a
 * funded wallet. Nothing here is fixture data — every decision it serves was
 * produced by the same code path production runs.
 *
 *   bun run scripts/autopilot-demo-server.ts [--port 3200] [--cycles 4]
 */
import { PGlite } from '@electric-sql/pglite'
import { desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '../src/db/schema/autopilot'
import {
	autopilotAgents,
	autopilotDecisions,
	autopilotPositions,
} from '../src/db/schema/autopilot'
import { computeEquity, runCycleImpl, toPublicDecision } from '../src/services/AutopilotService'
import { PaperExecutor } from '../src/services/autopilot/executor'
import { RulesThesisEngine } from '../src/services/autopilot/thesis'
import type { Candidate } from '../src/services/autopilot/types'

function arg(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`)
	return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}

const port = Number(arg('port', '3200'))
const cycles = Number(arg('cycles', '4'))

const client = new PGlite()
// biome-ignore lint/suspicious/noExplicitAny: PGlite's drizzle client is
// structurally compatible with the postgres-js one for these queries.
const db = drizzle(client, { schema }) as any

const sql = await Bun.file(`${import.meta.dir}/../drizzle/0022_familiar_goliath.sql`).text()
for (const statement of sql
	.split('--> statement-breakpoint')
	.map((s) => s.trim())
	.filter((s) => s.length > 0 && s.toLowerCase().includes('autopilot'))) {
	await client.exec(statement)
}

const [agent] = await db
	.insert(autopilotAgents)
	.values({
		slug: 'suwappu-alpha',
		name: 'Suwappu Alpha',
		description: 'Deterministic momentum-and-structure agent running on paper capital.',
		chain: 'base',
		baseToken: 'USDC',
		mode: 'paper',
		status: 'active',
		startingEquityUsd: 1000,
		rules: { allowedChains: ['base'], maxPositionUsd: 100, tokenCooldownMinutes: 0 },
	})
	.returning()

/** A small book of tokens with different characters, so refusals are visible too. */
const UNIVERSE: Candidate[] = [
	{
		chain: 'base',
		tokenAddress: '0x4200000000000000000000000000000000000006',
		symbol: 'DEEP',
		priceUsd: 1,
		liquidityUsd: 900_000,
		volume24hUsd: 2_400_000,
		priceChange1hPct: 11,
		priceChange24hPct: 26,
		ageMinutes: 9_000,
	},
	{
		chain: 'base',
		tokenAddress: '0x1111111111111111111111111111111111111111',
		symbol: 'THIN',
		priceUsd: 0.004,
		liquidityUsd: 12_000,
		volume24hUsd: 900_000,
		priceChange1hPct: 180,
		priceChange24hPct: 400,
		ageMinutes: 40,
	},
	{
		chain: 'base',
		tokenAddress: '0x2222222222222222222222222222222222222222',
		symbol: 'STEADY',
		priceUsd: 12,
		liquidityUsd: 1_800_000,
		volume24hUsd: 3_600_000,
		priceChange1hPct: 7,
		priceChange24hPct: 14,
		ageMinutes: 20_000,
	},
]

const SECURITY = {
	isHoneypot: false,
	buyTaxBps: 0,
	sellTaxBps: 0,
	topHolderPct: 19,
	lpLocked: true,
}

// Prices drift across cycles so exits actually fire.
const PRICE_PATH = [1, 1.2, 0.78, 0.9]

for (let i = 0; i < cycles; i++) {
	const priceUsd = PRICE_PATH[i % PRICE_PATH.length] as number
	const report = await runCycleImpl(
		db,
		agent,
		new PaperExecutor(),
		new RulesThesisEngine(),
		{ internalApiUrl: '', internalApiKey: '' },
		{
			screenCandidates: async () => UNIVERSE.map((c) => ({ ...c, priceUsd: c.priceUsd * priceUsd })),
			getTokenPriceUsd: async (_chain, token) => {
				const base = UNIVERSE.find((c) => c.tokenAddress === token)
				return base ? base.priceUsd * priceUsd : null
			},
			fetchTokenSecurity: async () => SECURITY,
		},
	)
	console.log(
		`cycle ${i + 1}: scanned ${report.candidatesScanned}, sealed ${report.decisionsSealed}, executed ${report.decisionsExecuted}, refused ${report.rejections}, equity $${report.equityUsd.toFixed(2)}`,
	)
}

async function agentSummary() {
	const positions = await db
		.select()
		.from(autopilotPositions)
		.where(eq(autopilotPositions.agentId, agent.id))
	const open = positions.filter((p: { status: string }) => p.status === 'open')
	const realized = positions
		.filter((p: { status: string }) => p.status === 'closed')
		.reduce((s: number, p: { realizedPnlUsd: number }) => s + (p.realizedPnlUsd ?? 0), 0)
	const { equityUsd, deployedUsd } = computeEquity(
		agent.startingEquityUsd,
		open.map((p: { costBasisUsd: number; lastPriceUsd: number; avgEntryPriceUsd: number }) => ({
			costBasisUsd: p.costBasisUsd,
			marketValueUsd:
				p.lastPriceUsd && p.avgEntryPriceUsd
					? p.costBasisUsd * (p.lastPriceUsd / p.avgEntryPriceUsd)
					: p.costBasisUsd,
		})),
		realized,
	)
	return {
		slug: agent.slug,
		name: agent.name,
		description: agent.description,
		mode: agent.mode,
		status: agent.status,
		chain: agent.chain,
		wallet_address: agent.walletAddress,
		thesis_engine: agent.thesisEngine,
		starting_equity_usd: agent.startingEquityUsd,
		equity_usd: Number(equityUsd.toFixed(2)),
		deployed_usd: Number(deployedUsd.toFixed(2)),
		open_positions: open.length,
		pnl_usd: Number((equityUsd - agent.startingEquityUsd).toFixed(2)),
		last_cycle_at: new Date().toISOString(),
	}
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

Bun.serve({
	port,
	async fetch(req) {
		const url = new URL(req.url)

		if (url.pathname === '/v1/autopilot') {
			return Response.json({ success: true, agents: [await agentSummary()] }, { headers: cors })
		}

		if (url.pathname === `/v1/autopilot/${agent.slug}/decisions`) {
			const rows = await db
				.select()
				.from(autopilotDecisions)
				.where(eq(autopilotDecisions.agentId, agent.id))
				.orderBy(desc(autopilotDecisions.sealedAt))
				.limit(40)
			return Response.json(
				{ success: true, decisions: rows.map(toPublicDecision) },
				{ headers: cors },
			)
		}

		return Response.json({ success: false, error: 'not found' }, { status: 404, headers: cors })
	},
})

console.log(`\nautopilot demo API on http://localhost:${port}/v1/autopilot`)
