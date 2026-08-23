/**
 * Autopilot — public transparency surface for the autonomous trading agent.
 *
 * Everything under `/v1/autopilot` is unauthenticated on purpose: the agent's
 * decisions, refusals, positions and P&L are the product. Control (run a cycle,
 * pause, resume) lives on the admin router and needs X-Admin-Key.
 */
import { and, desc, eq } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { autopilotCycles, autopilotPositions, requireDb } from '../db'
import { mapErrorToResponse } from '../errors'
import { runEffectEither } from '../runtime'
import { AutopilotService, computeEquity } from '../services/AutopilotService'

const autopilotRoutes = new Hono()

function parseIntParam(raw: string | undefined, def: number, max: number): number {
	const n = Number.parseInt(raw ?? '', 10)
	if (!Number.isFinite(n) || n < 0) return def
	return Math.min(n, max)
}

// GET /v1/autopilot — every agent and where it stands
autopilotRoutes.get('/', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* AutopilotService
			const agents = yield* svc.listAgents()
			return yield* Effect.forEach(agents, (a) =>
				Effect.gen(function* () {
					const portfolio = yield* svc.getPortfolio(a.id)
					return {
						slug: a.slug,
						name: a.name,
						description: a.description,
						mode: a.mode,
						status: a.status,
						chain: a.chain,
						wallet_address: a.walletAddress,
						thesis_engine: a.thesisEngine,
						starting_equity_usd: a.startingEquityUsd,
						equity_usd: Number(portfolio.equityUsd.toFixed(2)),
						deployed_usd: Number(portfolio.deployedUsd.toFixed(2)),
						open_positions: portfolio.openPositions.length,
						pnl_usd: Number((portfolio.equityUsd - a.startingEquityUsd).toFixed(2)),
						last_cycle_at: a.lastCycleAt ? a.lastCycleAt.toISOString() : null,
					}
				}),
			)
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	return c.json({ success: true, agents: result.right })
})

// GET /v1/autopilot/:slug — one agent, with its book and rules
autopilotRoutes.get('/:slug', async (c) => {
	const slug = c.req.param('slug')
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* AutopilotService
			const agent = yield* svc.getAgent(slug)
			const portfolio = yield* svc.getPortfolio(agent.id)
			const db = yield* requireDb
			const cycles = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(autopilotCycles)
						.where(eq(autopilotCycles.agentId, agent.id))
						.orderBy(desc(autopilotCycles.startedAt))
						.limit(10),
				catch: (e) => new Error(String(e)),
			})
			return { agent, portfolio, cycles }
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	const { agent, portfolio, cycles } = result.right
	return c.json({
		success: true,
		agent: {
			slug: agent.slug,
			name: agent.name,
			description: agent.description,
			mode: agent.mode,
			status: agent.status,
			chain: agent.chain,
			base_token_symbol: agent.baseTokenSymbol,
			wallet_address: agent.walletAddress,
			thesis_engine: agent.thesisEngine,
			rules: agent.rules,
			starting_equity_usd: agent.startingEquityUsd,
			last_cycle_at: agent.lastCycleAt ? agent.lastCycleAt.toISOString() : null,
		},
		portfolio: {
			equity_usd: Number(portfolio.equityUsd.toFixed(2)),
			deployed_usd: Number(portfolio.deployedUsd.toFixed(2)),
			pnl_usd: Number((portfolio.equityUsd - agent.startingEquityUsd).toFixed(2)),
			spent_today_usd: Number(portfolio.spentTodayUsd.toFixed(2)),
			realized_pnl_today_usd: Number(portfolio.realizedPnlTodayUsd.toFixed(2)),
			open_positions: portfolio.openPositions,
		},
		recent_cycles: cycles.map((cy) => ({
			id: cy.id,
			status: cy.status,
			stage: cy.stage,
			candidates_scanned: cy.candidatesScanned,
			theses_formed: cy.thesesFormed,
			decisions_sealed: cy.decisionsSealed,
			decisions_executed: cy.decisionsExecuted,
			equity_usd: cy.equityUsd,
			started_at: cy.startedAt.toISOString(),
			finished_at: cy.finishedAt ? cy.finishedAt.toISOString() : null,
			error: cy.error,
		})),
	})
})

// GET /v1/autopilot/:slug/decisions — the feed, refusals included
autopilotRoutes.get('/:slug/decisions', async (c) => {
	const slug = c.req.param('slug')
	const limit = parseIntParam(c.req.query('limit'), 50, 200)
	const offset = parseIntParam(c.req.query('offset'), 0, 100_000)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* AutopilotService
			const agent = yield* svc.getAgent(slug)
			return yield* svc.listDecisions(agent.id, limit, offset)
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	return c.json({ success: true, decisions: result.right, limit, offset })
})

// GET /v1/autopilot/:slug/positions
autopilotRoutes.get('/:slug/positions', async (c) => {
	const slug = c.req.param('slug')
	const status = c.req.query('status') === 'closed' ? 'closed' : 'open'

	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* AutopilotService
			const agent = yield* svc.getAgent(slug)
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(autopilotPositions)
						.where(
							and(eq(autopilotPositions.agentId, agent.id), eq(autopilotPositions.status, status)),
						)
						.orderBy(desc(autopilotPositions.openedAt))
						.limit(200),
				catch: (e) => new Error(String(e)),
			})
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	return c.json({ success: true, status, positions: result.right })
})

// GET /v1/autopilot/:slug/journal — the narrative log
autopilotRoutes.get('/:slug/journal', async (c) => {
	const slug = c.req.param('slug')
	const limit = parseIntParam(c.req.query('limit'), 100, 500)
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* AutopilotService
			const agent = yield* svc.getAgent(slug)
			return yield* svc.listJournal(agent.id, limit)
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	return c.json({ success: true, entries: result.right })
})

// GET /v1/autopilot/decisions/:id
autopilotRoutes.get('/decisions/:id', async (c) => {
	const id = Number.parseInt(c.req.param('id'), 10)
	if (!Number.isFinite(id)) return c.json({ success: false, error: 'Invalid id' }, 400)
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* AutopilotService
			return yield* svc.getDecision(id)
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	return c.json({ success: true, decision: result.right })
})

/**
 * GET /v1/autopilot/decisions/:id/verify
 *
 * Recomputes sha256(algo|nonce|canonical-thesis) and compares it to the
 * commitment stored before execution. The response tells you how to redo the
 * check yourself — the point is not to be believed.
 */
autopilotRoutes.get('/decisions/:id/verify', async (c) => {
	const id = Number.parseInt(c.req.param('id'), 10)
	if (!Number.isFinite(id)) return c.json({ success: false, error: 'Invalid id' }, 400)
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* AutopilotService
			return yield* svc.verifyDecision(id)
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	return c.json({
		success: true,
		verification: result.right,
		how_to_verify: {
			step_1: 'GET /v1/autopilot/decisions/:id and take `thesis`, `nonce` and `commitment`.',
			step_2:
				'Canonicalise the thesis: JSON with object keys sorted lexicographically, no whitespace.',
			step_3:
				'sha256("sha256-canonical-v1|" + nonce + "|" + canonical_thesis) must equal `commitment`.',
			step_4: result.right.anchor
				? 'Fetch the anchor tx on its chain, decode the calldata as UTF-8, and check it equals `memo`. That block timestamp is when the commitment became public, and it precedes the fill.'
				: 'This decision was not anchored on-chain: step 3 proves the thesis matches the commitment, but the ordering rests on our records rather than on a block.',
			note: 'The commitment row is written before any execution attempt, so a matching hash proves the thesis predates the trade.',
		},
	})
})

// ─── Admin control surface (mounted behind X-Admin-Key) ─────────────────────

const autopilotAdminRoutes = new Hono()

/**
 * POST /admin/autopilot — create an agent.
 *
 * Always lands paused, and `mode: "live"` additionally requires
 * `confirm_live: true` in the body. Creating an autonomous trader and turning
 * it loose are two separate decisions.
 */
autopilotAdminRoutes.post('/', async (c) => {
	let body: Record<string, unknown>
	try {
		body = (await c.req.json()) as Record<string, unknown>
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const slug = typeof body.slug === 'string' ? body.slug : ''
	const name = typeof body.name === 'string' ? body.name : ''
	const chain = typeof body.chain === 'string' ? body.chain : ''
	const baseToken = typeof body.base_token === 'string' ? body.base_token : ''
	const startingEquityUsd = Number(body.starting_equity_usd)
	const mode = body.mode === 'live' ? 'live' : 'paper'

	if (!slug || !name || !chain || !baseToken || !Number.isFinite(startingEquityUsd)) {
		return c.json(
			{
				success: false,
				error: 'slug, name, chain, base_token and starting_equity_usd are required',
			},
			400,
		)
	}
	if (mode === 'live' && body.confirm_live !== true) {
		return c.json(
			{
				success: false,
				error: 'Refusing to create a live agent without confirm_live: true',
			},
			400,
		)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* AutopilotService
			return yield* svc.createAgent({
				slug,
				name,
				chain,
				baseToken,
				startingEquityUsd,
				mode,
				...(typeof body.description === 'string' ? { description: body.description } : {}),
				...(typeof body.base_token_symbol === 'string'
					? { baseTokenSymbol: body.base_token_symbol }
					: {}),
				...(typeof body.wallet_address === 'string' ? { walletAddress: body.wallet_address } : {}),
				...(typeof body.thesis_engine === 'string' ? { thesisEngine: body.thesis_engine } : {}),
				...(body.rules && typeof body.rules === 'object'
					? { rules: body.rules as Record<string, never> }
					: {}),
			})
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}
	return c.json({
		success: true,
		agent: {
			slug: result.right.slug,
			mode: result.right.mode,
			status: result.right.status,
			rules: result.right.rules,
		},
	})
})

// PATCH /admin/autopilot/:slug/rules — tighten or loosen the risk rules
autopilotAdminRoutes.patch('/:slug/rules', async (c) => {
	const slug = c.req.param('slug')
	let body: Record<string, unknown>
	try {
		body = (await c.req.json()) as Record<string, unknown>
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* AutopilotService
			return yield* svc.updateRules(slug, body as Record<string, never>)
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}
	return c.json({ success: true, agent: { slug, rules: result.right.rules } })
})

// POST /admin/autopilot/:slug/run — run one cycle now
autopilotAdminRoutes.post('/:slug/run', async (c) => {
	const slug = c.req.param('slug')
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* AutopilotService
			return yield* svc.runCycle(slug)
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	return c.json({ success: true, cycle: result.right })
})

// POST /admin/autopilot/:slug/status — active | paused | stopped
autopilotAdminRoutes.post('/:slug/status', async (c) => {
	const slug = c.req.param('slug')
	let body: { status?: string }
	try {
		body = (await c.req.json()) as { status?: string }
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}
	const status = body.status
	if (status !== 'active' && status !== 'paused' && status !== 'stopped') {
		return c.json({ success: false, error: 'status must be active, paused or stopped' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* AutopilotService
			return yield* svc.setStatus(slug, status)
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	return c.json({ success: true, agent: { slug, status: result.right.status } })
})

export { autopilotAdminRoutes, autopilotRoutes, computeEquity }
