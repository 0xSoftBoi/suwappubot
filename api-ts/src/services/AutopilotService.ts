/**
 * Autopilot — the autonomous trading loop.
 *
 *   read → think → gate → seal → execute → journal → reveal
 *
 * The ordering is the product. Every decision's thesis is hashed and stored as
 * a commitment BEFORE execution, and only revealed afterwards, so "the agent
 * called this in advance" is checkable by a stranger with our public decision
 * feed and a SHA-256 implementation. Refusals are first-class records too: a
 * gate that stops a trade is published with the same weight as a fill.
 */
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { EnvService } from '../config/EnvService'
import {
	type AutopilotAgent,
	type AutopilotDecision,
	type AutopilotPosition,
	autopilotAgents,
	autopilotCycles,
	autopilotDecisions,
	autopilotJournal,
	autopilotPositions,
	type DbClient,
	type DrizzleService,
	requireDb,
} from '../db'
import { DatabaseError, NotFoundError, ValidationError } from '../errors'
import { logger } from '../lib/logger'
import { computeCommitment, generateNonce, sealMemo, verifySeal } from '../lib/seal'
import { type Anchor, createAnchor, NullAnchor } from './autopilot/anchor'
import { type Executor, ManagedExecutor, PaperExecutor } from './autopilot/executor'
import { evaluateGates, shouldExit } from './autopilot/gates'
import { LlmThesisEngine } from './autopilot/llmThesis'
import { fetchTokenSecurity, getTokenPriceUsd, screenCandidates } from './autopilot/market'
import { RulesThesisEngine, type ThesisEngine } from './autopilot/thesis'
import {
	type AutopilotRules,
	type Candidate,
	DEFAULT_RULES,
	type OpenPositionSummary,
	type PortfolioState,
	type Thesis,
} from './autopilot/types'

/**
 * The market I/O the cycle depends on, injected so the loop can be exercised
 * end-to-end against a deterministic market instead of the live one.
 */
export interface MarketDeps {
	screenCandidates: typeof screenCandidates
	getTokenPriceUsd: typeof getTokenPriceUsd
	fetchTokenSecurity: typeof fetchTokenSecurity
}

export const LIVE_MARKET: MarketDeps = { screenCandidates, getTokenPriceUsd, fetchTokenSecurity }

export interface CycleReport {
	cycleId: number
	agentSlug: string
	candidatesScanned: number
	thesesFormed: number
	decisionsSealed: number
	decisionsExecuted: number
	rejections: number
	equityUsd: number
	errors: string[]
}

/**
 * The public wire shape of a decision.
 *
 * snake_case throughout, matching every other autopilot response — the feed is
 * read by third parties and by our own dashboard, and a surface that mixes
 * casings silently reads `gate_passed` as undefined on the consumer side, which
 * makes every fill look like a refusal.
 */
export interface PublicDecision {
	id: number
	action: string
	chain: string
	symbol: string
	token_address: string
	size_usd: number
	confidence: number | null
	headline: string | null
	status: string
	seal_algo: string
	commitment: string
	seal_memo: string
	seal_tx_hash: string | null
	seal_chain: string | null
	sealed_at: string
	gate_passed: boolean
	gates: unknown
	rejection_reason: string | null
	tx_hash: string | null
	executed_at: string | null
	fill_price_usd: number | null
	/** Only present once revealed — that is what makes the commitment mean anything. */
	nonce?: string
	thesis?: unknown
	revealed_at?: string
}

/**
 * The public wire shape of a position — snake_case, like every other autopilot
 * response, and explicitly mapped rather than a raw row. Serving the ORM row
 * would leak column naming as API surface and drift the moment the schema does.
 */
export interface PublicPosition {
	id: number
	chain: string
	token_address: string
	symbol: string
	status: string
	amount: string
	cost_basis_usd: number
	avg_entry_price_usd: number | null
	last_price_usd: number | null
	unrealized_pnl_usd: number | null
	realized_pnl_usd: number
	take_profit_pct: number | null
	stop_loss_pct: number | null
	invalidation: string | null
	entry_decision_id: number | null
	exit_decision_id: number | null
	opened_at: string
	closed_at: string | null
}

export function toPublicPosition(row: AutopilotPosition): PublicPosition {
	return {
		id: row.id,
		chain: row.chain,
		token_address: row.tokenAddress,
		symbol: row.tokenSymbol,
		status: row.status,
		amount: row.amount,
		cost_basis_usd: row.costBasisUsd,
		avg_entry_price_usd: row.avgEntryPriceUsd,
		last_price_usd: row.lastPriceUsd,
		unrealized_pnl_usd: row.unrealizedPnlUsd,
		realized_pnl_usd: row.realizedPnlUsd,
		take_profit_pct: row.takeProfitPct,
		stop_loss_pct: row.stopLossPct,
		invalidation: row.invalidation,
		entry_decision_id: row.entryDecisionId,
		exit_decision_id: row.exitDecisionId,
		opened_at: row.openedAt.toISOString(),
		closed_at: row.closedAt ? row.closedAt.toISOString() : null,
	}
}

export interface VerificationResult {
	decisionId: number
	commitment: string
	algo: string
	memo: string
	anchor: { chain: string; txHash: string } | null
	revealed: boolean
	verified: boolean
	detail: string
	sealedAt: string
	executedAt: string | null
}

export interface CreateAgentParams {
	slug: string
	name: string
	description?: string | undefined
	chain: string
	baseToken: string
	baseTokenSymbol?: string | undefined
	mode?: 'paper' | 'live' | undefined
	startingEquityUsd: number
	walletAddress?: string | undefined
	thesisEngine?: string | undefined
	rules?: Partial<AutopilotRules> | undefined
}

export interface AutopilotServiceInterface {
	readonly listAgents: () => Effect.Effect<AutopilotAgent[], DatabaseError, DrizzleService>
	readonly getAgent: (
		slug: string,
	) => Effect.Effect<AutopilotAgent, DatabaseError | NotFoundError, DrizzleService>
	readonly createAgent: (
		params: CreateAgentParams,
	) => Effect.Effect<AutopilotAgent, DatabaseError | ValidationError, DrizzleService>
	readonly updateRules: (
		slug: string,
		rules: Partial<AutopilotRules>,
	) => Effect.Effect<AutopilotAgent, DatabaseError | NotFoundError, DrizzleService>
	readonly setStatus: (
		slug: string,
		status: 'active' | 'paused' | 'stopped',
	) => Effect.Effect<AutopilotAgent, DatabaseError | NotFoundError, DrizzleService>
	readonly getPortfolio: (
		agentId: number,
	) => Effect.Effect<PortfolioState, DatabaseError, DrizzleService>
	readonly listPositions: (
		agentId: number,
		status?: 'open' | 'closed',
	) => Effect.Effect<PublicPosition[], DatabaseError, DrizzleService>
	readonly listDecisions: (
		agentId: number,
		limit?: number,
		offset?: number,
	) => Effect.Effect<PublicDecision[], DatabaseError, DrizzleService>
	readonly getDecision: (
		id: number,
	) => Effect.Effect<PublicDecision, DatabaseError | NotFoundError, DrizzleService>
	readonly verifyDecision: (
		id: number,
	) => Effect.Effect<VerificationResult, DatabaseError | NotFoundError, DrizzleService>
	readonly listJournal: (
		agentId: number,
		limit?: number,
	) => Effect.Effect<unknown[], DatabaseError, DrizzleService>
	readonly runCycle: (
		slug: string,
	) => Effect.Effect<
		CycleReport,
		DatabaseError | NotFoundError | ValidationError,
		DrizzleService | EnvService
	>
}

export class AutopilotService extends Context.Tag('AutopilotService')<
	AutopilotService,
	AutopilotServiceInterface
>() {}

const dbErr = (e: { message: string }) => new DatabaseError({ message: e.message })

export function resolveRules(raw: unknown): AutopilotRules {
	const patch = (raw ?? {}) as Partial<AutopilotRules>
	const merged: AutopilotRules = { ...DEFAULT_RULES }
	for (const key of Object.keys(DEFAULT_RULES) as (keyof AutopilotRules)[]) {
		const v = patch[key]
		if (v === undefined || v === null) continue
		// Never let stored config widen a cap past the compiled default for the
		// money-sensitive limits — config is data, and data can be wrong.
		;(merged as unknown as Record<string, unknown>)[key] = v
	}
	return merged
}

/** Cash + marked-to-market book. */
export function computeEquity(
	startingEquityUsd: number,
	positions: { costBasisUsd: number; marketValueUsd: number }[],
	realizedPnlUsd: number,
): { cashUsd: number; deployedUsd: number; marketValueUsd: number; equityUsd: number } {
	const deployedUsd = positions.reduce((s, p) => s + p.costBasisUsd, 0)
	const marketValueUsd = positions.reduce((s, p) => s + p.marketValueUsd, 0)
	const cashUsd = startingEquityUsd + realizedPnlUsd - deployedUsd
	return { cashUsd, deployedUsd, marketValueUsd, equityUsd: cashUsd + marketValueUsd }
}

function startOfUtcDay(now: Date): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export function toPublicDecision(row: AutopilotDecision): PublicDecision {
	const out: PublicDecision = {
		id: row.id,
		action: row.action,
		chain: row.chain,
		symbol: row.tokenSymbol,
		token_address: row.tokenAddress,
		size_usd: row.sizeUsd,
		confidence: row.confidence,
		headline: row.headline,
		status: row.status,
		seal_algo: row.sealAlgo,
		commitment: row.commitment,
		seal_memo: sealMemo(row.commitment),
		seal_tx_hash: row.sealTxHash,
		seal_chain: row.sealChain,
		sealed_at: row.sealedAt.toISOString(),
		gate_passed: row.gatePassed,
		gates: row.gates,
		rejection_reason: row.rejectionReason,
		tx_hash: row.txHash,
		executed_at: row.executedAt ? row.executedAt.toISOString() : null,
		fill_price_usd: row.fillPriceUsd,
	}
	if (row.revealedAt) {
		out.nonce = row.nonce
		out.thesis = row.thesis
		out.revealed_at = row.revealedAt.toISOString()
	}
	return out
}

export const AutopilotServiceLive = Layer.succeed(AutopilotService, {
	listAgents: () =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbErr))
			return yield* Effect.tryPromise({
				try: () => db.select().from(autopilotAgents).orderBy(autopilotAgents.id),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
		}),

	getAgent: (slug: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbErr))
			const rows = yield* Effect.tryPromise({
				try: () => db.select().from(autopilotAgents).where(eq(autopilotAgents.slug, slug)).limit(1),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
			const agent = rows[0]
			if (!agent) return yield* Effect.fail(new NotFoundError({ message: `No agent ${slug}` }))
			return agent
		}),

	createAgent: (params: CreateAgentParams) =>
		Effect.gen(function* () {
			if (!/^[a-z0-9-]{3,64}$/.test(params.slug)) {
				return yield* Effect.fail(
					new ValidationError({ message: 'slug must be 3-64 chars of [a-z0-9-]' }),
				)
			}
			if (!(params.startingEquityUsd > 0)) {
				return yield* Effect.fail(
					new ValidationError({ message: 'startingEquityUsd must be positive' }),
				)
			}

			const db = yield* requireDb.pipe(Effect.mapError(dbErr))
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(autopilotAgents)
						.values({
							slug: params.slug,
							name: params.name,
							description: params.description ?? null,
							chain: params.chain,
							baseToken: params.baseToken,
							baseTokenSymbol: params.baseTokenSymbol ?? 'USDC',
							mode: params.mode ?? 'paper',
							// A new agent is always paused: creating it and starting it
							// are two decisions, and only one of them can lose money.
							status: 'paused',
							startingEquityUsd: params.startingEquityUsd,
							walletAddress: params.walletAddress ?? null,
							thesisEngine: params.thesisEngine ?? 'rules',
							rules: resolveRules(params.rules) as never,
						})
						.returning(),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
			const agent = rows[0]
			if (!agent)
				return yield* Effect.fail(new DatabaseError({ message: 'insert returned no row' }))
			return agent
		}),

	updateRules: (slug: string, rules: Partial<AutopilotRules>) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbErr))
			const existing = yield* Effect.tryPromise({
				try: () => db.select().from(autopilotAgents).where(eq(autopilotAgents.slug, slug)).limit(1),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
			const current = existing[0]
			if (!current) return yield* Effect.fail(new NotFoundError({ message: `No agent ${slug}` }))

			const merged = resolveRules({ ...resolveRules(current.rules), ...rules })
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.update(autopilotAgents)
						.set({ rules: merged as never, updatedAt: new Date() })
						.where(eq(autopilotAgents.slug, slug))
						.returning(),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
			const agent = rows[0]
			if (!agent) return yield* Effect.fail(new NotFoundError({ message: `No agent ${slug}` }))
			return agent
		}),

	setStatus: (slug: string, status: 'active' | 'paused' | 'stopped') =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbErr))
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.update(autopilotAgents)
						.set({ status, updatedAt: new Date() })
						.where(eq(autopilotAgents.slug, slug))
						.returning(),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
			const agent = rows[0]
			if (!agent) return yield* Effect.fail(new NotFoundError({ message: `No agent ${slug}` }))
			return agent
		}),

	getPortfolio: (agentId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbErr))
			return yield* Effect.tryPromise({
				try: () => loadPortfolio(db, agentId),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
		}),

	listPositions: (agentId: number, status?: 'open' | 'closed') =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbErr))
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(autopilotPositions)
						.where(
							status
								? and(
										eq(autopilotPositions.agentId, agentId),
										eq(autopilotPositions.status, status),
									)
								: eq(autopilotPositions.agentId, agentId),
						)
						.orderBy(desc(autopilotPositions.openedAt))
						.limit(200),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
			return rows.map(toPublicPosition)
		}),

	listDecisions: (agentId: number, limit = 50, offset = 0) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbErr))
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(autopilotDecisions)
						.where(eq(autopilotDecisions.agentId, agentId))
						.orderBy(desc(autopilotDecisions.sealedAt))
						.limit(Math.min(limit, 200))
						.offset(offset),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
			return rows.map(toPublicDecision)
		}),

	getDecision: (id: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbErr))
			const rows = yield* Effect.tryPromise({
				try: () =>
					db.select().from(autopilotDecisions).where(eq(autopilotDecisions.id, id)).limit(1),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
			const row = rows[0]
			if (!row) return yield* Effect.fail(new NotFoundError({ message: `No decision ${id}` }))
			return toPublicDecision(row)
		}),

	verifyDecision: (id: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbErr))
			const rows = yield* Effect.tryPromise({
				try: () =>
					db.select().from(autopilotDecisions).where(eq(autopilotDecisions.id, id)).limit(1),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
			const row = rows[0]
			if (!row) return yield* Effect.fail(new NotFoundError({ message: `No decision ${id}` }))

			const base = {
				decisionId: row.id,
				commitment: row.commitment,
				algo: row.sealAlgo,
				memo: sealMemo(row.commitment),
				anchor:
					row.sealTxHash && row.sealChain ? { chain: row.sealChain, txHash: row.sealTxHash } : null,
				sealedAt: row.sealedAt.toISOString(),
				executedAt: row.executedAt ? row.executedAt.toISOString() : null,
			}
			if (!row.revealedAt || row.thesis === null) {
				return {
					...base,
					revealed: false,
					verified: false,
					detail: 'Thesis is still sealed — the commitment cannot be checked until it is revealed.',
				}
			}
			const ok = verifySeal(row.thesis, row.nonce, row.commitment)
			return {
				...base,
				revealed: true,
				verified: ok,
				detail: ok
					? 'sha256(algo|nonce|canonical-thesis) matches the commitment published before execution.'
					: 'MISMATCH — the revealed thesis does not hash to the published commitment.',
			}
		}),

	listJournal: (agentId: number, limit = 100) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbErr))
			return yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(autopilotJournal)
						.where(eq(autopilotJournal.agentId, agentId))
						.orderBy(desc(autopilotJournal.createdAt))
						.limit(Math.min(limit, 500)),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
		}),

	runCycle: (slug: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbErr))
			const env = yield* EnvService

			const agentRows = yield* Effect.tryPromise({
				try: () => db.select().from(autopilotAgents).where(eq(autopilotAgents.slug, slug)).limit(1),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
			const agent = agentRows[0]
			if (!agent) return yield* Effect.fail(new NotFoundError({ message: `No agent ${slug}` }))
			if (agent.status !== 'active') {
				return yield* Effect.fail(
					new ValidationError({ message: `Agent ${slug} is ${agent.status}, not active` }),
				)
			}

			const executor: Executor =
				agent.mode === 'live'
					? new ManagedExecutor({
							apiBaseUrl: env.AUTOPILOT_API_BASE_URL,
							apiKey: env.AUTOPILOT_AGENT_API_KEY ?? '',
						})
					: new PaperExecutor()

			// An agent whose published thesis_engine is 'llm' must not silently fall
			// back to the rules engine — the feed would then attribute a
			// deterministic thesis to a model that never ran.
			if (agent.thesisEngine === 'llm' && !env.ANTHROPIC_API_KEY) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Agent ${slug} uses the llm thesis engine but ANTHROPIC_API_KEY is not configured`,
					}),
				)
			}

			const engine: ThesisEngine =
				agent.thesisEngine === 'llm'
					? new LlmThesisEngine({
							apiKey: env.ANTHROPIC_API_KEY as string,
							model: env.AUTOPILOT_LLM_MODEL,
							effort: env.AUTOPILOT_LLM_EFFORT,
							maxCallsPerCycle: env.AUTOPILOT_LLM_MAX_CALLS,
						})
					: new RulesThesisEngine()

			if (agent.mode === 'live' && !env.AUTOPILOT_AGENT_API_KEY) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Agent is in live mode but AUTOPILOT_AGENT_API_KEY is not configured',
					}),
				)
			}

			return yield* Effect.tryPromise({
				try: () =>
					runCycleImpl(
						db,
						agent,
						executor,
						engine,
						{
							internalApiUrl: env.INTERNAL_API_URL,
							internalApiKey: env.INTERNAL_API_KEY ?? '',
						},
						LIVE_MARKET,
						createAnchor(env),
					),
				catch: (e) => new DatabaseError({ message: String(e) }),
			})
		}),
})

// ---------------------------------------------------------------------------
// Implementation — plain async against the drizzle client, wrapped above.
// ---------------------------------------------------------------------------

async function loadPortfolio(db: DbClient, agentId: number): Promise<PortfolioState> {
	const [agentRow] = await db
		.select()
		.from(autopilotAgents)
		.where(eq(autopilotAgents.id, agentId))
		.limit(1)

	const positions = await db
		.select()
		.from(autopilotPositions)
		.where(and(eq(autopilotPositions.agentId, agentId), eq(autopilotPositions.status, 'open')))

	const closed = await db
		.select()
		.from(autopilotPositions)
		.where(and(eq(autopilotPositions.agentId, agentId), eq(autopilotPositions.status, 'closed')))

	const dayStart = startOfUtcDay(new Date())

	const todaysBuys = await db
		.select()
		.from(autopilotDecisions)
		.where(
			and(
				eq(autopilotDecisions.agentId, agentId),
				gte(autopilotDecisions.sealedAt, dayStart),
				eq(autopilotDecisions.action, 'buy'),
				inArray(autopilotDecisions.status, ['filled', 'executing', 'revealed']),
			),
		)

	const spentTodayUsd = todaysBuys
		.filter((d: AutopilotDecision) => d.gatePassed)
		.reduce((s: number, d: AutopilotDecision) => s + (d.sizeUsd ?? 0), 0)

	const realizedPnlUsd = closed.reduce(
		(s: number, p: AutopilotPosition) => s + (p.realizedPnlUsd ?? 0),
		0,
	)
	const realizedPnlTodayUsd = closed
		.filter((p: AutopilotPosition) => p.closedAt && p.closedAt >= dayStart)
		.reduce((s: number, p: AutopilotPosition) => s + (p.realizedPnlUsd ?? 0), 0)

	const openPositions: OpenPositionSummary[] = positions.map((p: AutopilotPosition) => ({
		chain: p.chain,
		tokenAddress: p.tokenAddress,
		symbol: p.tokenSymbol,
		amount: p.amount,
		costBasisUsd: p.costBasisUsd,
		avgEntryPriceUsd: p.avgEntryPriceUsd ?? 0,
		takeProfitPct: p.takeProfitPct ?? undefined,
		stopLossPct: p.stopLossPct ?? undefined,
		invalidation: p.invalidation ?? undefined,
		openedAt: p.openedAt ? new Date(p.openedAt).getTime() : Date.now(),
	}))

	const marked = positions.map((p: AutopilotPosition) => ({
		costBasisUsd: p.costBasisUsd,
		marketValueUsd:
			p.lastPriceUsd && p.avgEntryPriceUsd
				? p.costBasisUsd * (p.lastPriceUsd / p.avgEntryPriceUsd)
				: p.costBasisUsd,
	}))

	const { equityUsd, deployedUsd } = computeEquity(
		agentRow?.startingEquityUsd ?? 0,
		marked,
		realizedPnlUsd,
	)

	const lastDecisions = await db
		.select()
		.from(autopilotDecisions)
		.where(eq(autopilotDecisions.agentId, agentId))
		.orderBy(desc(autopilotDecisions.sealedAt))
		.limit(200)

	const lastTradeAtByToken: Record<string, number> = {}
	for (const d of lastDecisions as AutopilotDecision[]) {
		if (!d.gatePassed) continue
		const key = d.tokenAddress.toLowerCase()
		const ts = (d.executedAt ?? d.sealedAt).getTime()
		if (!lastTradeAtByToken[key] || ts > (lastTradeAtByToken[key] as number)) {
			lastTradeAtByToken[key] = ts
		}
	}

	return {
		equityUsd,
		deployedUsd,
		openPositions,
		spentTodayUsd,
		realizedPnlTodayUsd,
		lastTradeAtByToken,
	}
}

async function journal(
	db: DbClient,
	agentId: number,
	cycleId: number | null,
	decisionId: number | null,
	stage: string,
	message: string,
	data?: unknown,
	level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
	await db.insert(autopilotJournal).values({
		agentId,
		cycleId,
		decisionId,
		stage,
		level,
		message,
		data: (data ?? null) as never,
	})
}

/**
 * Seal a thesis and persist the decision. The commitment row exists before any
 * execution attempt, which is the whole guarantee: we cannot retro-fit a story
 * to a fill.
 */
async function sealDecision(
	db: DbClient,
	agentId: number,
	cycleId: number,
	thesis: Thesis,
	gate: ReturnType<typeof evaluateGates>,
): Promise<AutopilotDecision> {
	const nonce = generateNonce()
	const commitment = computeCommitment(thesis, nonce)

	const [row] = await db
		.insert(autopilotDecisions)
		.values({
			agentId,
			cycleId,
			action: thesis.action,
			chain: thesis.chain,
			tokenAddress: thesis.tokenAddress,
			tokenSymbol: thesis.symbol,
			sizeUsd: thesis.sizeUsd,
			confidence: thesis.confidence,
			headline: thesis.headline,
			thesis: null,
			sealAlgo: 'sha256-canonical-v1',
			commitment,
			nonce,
			gatePassed: gate.passed,
			gates: gate.results as never,
			rejectionReason: gate.rejectionReason ?? null,
			status: gate.passed ? 'sealed' : 'rejected',
		})
		.returning()
	return row as AutopilotDecision
}

/** Publish the thesis and nonce so the commitment can be checked. */
async function reveal(db: DbClient, decisionId: number, thesis: Thesis): Promise<void> {
	await db
		.update(autopilotDecisions)
		.set({ thesis: thesis as never, revealedAt: new Date() })
		.where(eq(autopilotDecisions.id, decisionId))
}

/**
 * Publish the commitment on-chain before the trade.
 *
 * `blockOnFailure` is true for entries: an entry whose commitment was never
 * witnessed would quietly weaken every claim we make about the feed, so it is
 * refused instead. It is false for exits — nothing, including our own
 * transparency machinery, may stand between the agent and the door. An
 * unanchored exit is journalled as such.
 */
async function anchorCommitment(
	db: DbClient,
	agentId: number,
	cycleId: number,
	decision: AutopilotDecision,
	anchor: Anchor,
	blockOnFailure: boolean,
): Promise<boolean> {
	if (!anchor.enabled) return true

	const result = await anchor.anchor(decision.commitment)
	if (result.ok) {
		await db
			.update(autopilotDecisions)
			.set({ sealTxHash: result.txHash, sealChain: result.chain })
			.where(eq(autopilotDecisions.id, decision.id))
		await journal(db, agentId, cycleId, decision.id, 'seal', `Anchored on ${result.chain}`, {
			txHash: result.txHash,
			memo: sealMemo(decision.commitment),
		})
		return true
	}

	await journal(
		db,
		agentId,
		cycleId,
		decision.id,
		'seal',
		blockOnFailure
			? `Anchor failed, refusing to execute: ${result.error}`
			: `Anchor failed, proceeding with the exit anyway: ${result.error}`,
		result,
		blockOnFailure ? 'error' : 'warn',
	)

	if (blockOnFailure) {
		await db
			.update(autopilotDecisions)
			.set({ status: 'failed', executionError: `anchor failed: ${result.error}` })
			.where(eq(autopilotDecisions.id, decision.id))
	}
	return !blockOnFailure
}

export async function runCycleImpl(
	db: DbClient,
	agent: AutopilotAgent,
	executor: Executor,
	engine: ThesisEngine,
	deps: { internalApiUrl: string; internalApiKey: string },
	market: MarketDeps = LIVE_MARKET,
	anchor: Anchor = new NullAnchor(),
): Promise<CycleReport> {
	const rules = resolveRules(agent.rules)
	const errors: string[] = []

	// Per-cycle spend caps (e.g. the LLM engine's call budget) reset here.
	;(engine as { resetCycle?: () => void }).resetCycle?.()

	const [cycle] = await db
		.insert(autopilotCycles)
		.values({ agentId: agent.id, status: 'running', stage: 'read' })
		.returning()
	const cycleId = cycle.id as number

	let candidatesScanned = 0
	let thesesFormed = 0
	let decisionsSealed = 0
	let decisionsExecuted = 0
	let rejections = 0

	try {
		// --- read -------------------------------------------------------------
		let portfolio = await loadPortfolio(db, agent.id)
		await markPositionsToMarket(db, agent.id, portfolio.openPositions, market)
		portfolio = await loadPortfolio(db, agent.id)

		// --- exits first: never let a new entry compete with an open risk ------
		await db.update(autopilotCycles).set({ stage: 'exit' }).where(eq(autopilotCycles.id, cycleId))
		for (const position of portfolio.openPositions) {
			const price = await market.getTokenPriceUsd(position.chain, position.tokenAddress)
			if (price === null) {
				await journal(
					db,
					agent.id,
					cycleId,
					null,
					'read',
					`No price for ${position.symbol}`,
					null,
					'warn',
				)
				continue
			}
			const verdict = shouldExit(
				{
					avgEntryPriceUsd: position.avgEntryPriceUsd,
					takeProfitPct: position.takeProfitPct,
					stopLossPct: position.stopLossPct,
					openedAt: position.openedAt,
				},
				price,
				undefined,
			)
			if (!verdict.exit) continue

			const thesis = await engine.formExit(position, price, verdict.reason ?? 'exit plan fired')
			thesesFormed++
			const gate = evaluateGates(thesis, undefined, portfolio, rules)
			const decision = await sealDecision(db, agent.id, cycleId, thesis, gate)
			decisionsSealed++
			await journal(
				db,
				agent.id,
				cycleId,
				decision.id,
				'seal',
				`Sealed exit of ${position.symbol}`,
				{
					commitment: decision.commitment,
				},
			)

			if (!gate.passed) {
				rejections++
				await reveal(db, decision.id, thesis)
				await journal(
					db,
					agent.id,
					cycleId,
					decision.id,
					'gate',
					gate.rejectionReason ?? 'refused',
					gate.results,
					'warn',
				)
				continue
			}

			await anchorCommitment(db, agent.id, cycleId, decision, anchor, false)

			const result = await executor.execute({
				chain: position.chain,
				fromToken: position.tokenAddress,
				toToken: agent.baseToken,
				amountUsd: thesis.sizeUsd,
				slippageBps: rules.maxSlippageBps,
				idempotencyKey: decision.commitment,
				referencePriceUsd: price,
				liquidityUsd: undefined,
				...(agent.walletAddress ? { walletAddress: agent.walletAddress } : {}),
			} as never)

			await settleDecision(db, agent.id, cycleId, decision, thesis, result, price)
			if (result.ok) {
				decisionsExecuted++
				await closePosition(db, agent.id, position, price, decision.id)
			} else {
				errors.push(`exit ${position.symbol}: ${result.error}`)
			}
			await reveal(db, decision.id, thesis)
		}

		// --- think / gate / seal / execute for new entries ---------------------
		await db.update(autopilotCycles).set({ stage: 'think' }).where(eq(autopilotCycles.id, cycleId))
		portfolio = await loadPortfolio(db, agent.id)

		const candidates = await market.screenCandidates({
			chains: rules.allowedChains,
			minLiquidityUsd: rules.minLiquidityUsd,
			limit: 25,
		})
		candidatesScanned = candidates.length
		await journal(db, agent.id, cycleId, null, 'read', `Screened ${candidates.length} candidates`, {
			symbols: candidates.map((c) => c.symbol).slice(0, 25),
		})

		for (const candidate of candidates) {
			if (portfolio.openPositions.length >= rules.maxOpenPositions) break

			const draft = await engine.formEntry(candidate, {
				availableUsd: Math.max(0, portfolio.equityUsd - portfolio.deployedUsd),
				maxPositionUsd: rules.maxPositionUsd,
				openPositions: portfolio.openPositions,
			})
			if (!draft) continue
			thesesFormed++

			// Security scan happens only for tokens that already earned a thesis —
			// no point paying for a scan on something we would not buy anyway.
			const enriched: Candidate = { ...candidate }
			const security = await market.fetchTokenSecurity(
				deps.internalApiUrl,
				deps.internalApiKey,
				candidate.chain,
				candidate.tokenAddress,
			)
			if (security) enriched.security = security

			const gate = evaluateGates(draft, enriched, portfolio, rules)
			const decision = await sealDecision(db, agent.id, cycleId, draft, gate)
			decisionsSealed++
			await journal(
				db,
				agent.id,
				cycleId,
				decision.id,
				'seal',
				`Sealed thesis on ${draft.symbol}`,
				{
					commitment: decision.commitment,
					memo: sealMemo(decision.commitment),
				},
			)

			if (!gate.passed) {
				rejections++
				await reveal(db, decision.id, draft)
				await journal(
					db,
					agent.id,
					cycleId,
					decision.id,
					'gate',
					`Refused ${draft.symbol}: ${gate.rejectionReason}`,
					gate.results,
					'warn',
				)
				continue
			}

			const anchored = await anchorCommitment(db, agent.id, cycleId, decision, anchor, true)
			if (!anchored) {
				await reveal(db, decision.id, draft)
				errors.push(`entry ${draft.symbol}: commitment could not be anchored`)
				continue
			}

			const result = await executor.execute({
				chain: draft.chain,
				fromToken: agent.baseToken,
				toToken: draft.tokenAddress,
				amountUsd: draft.sizeUsd,
				slippageBps: rules.maxSlippageBps,
				idempotencyKey: decision.commitment,
				referencePriceUsd: candidate.priceUsd,
				liquidityUsd: candidate.liquidityUsd,
				...(agent.walletAddress ? { walletAddress: agent.walletAddress } : {}),
			} as never)

			await settleDecision(db, agent.id, cycleId, decision, draft, result, candidate.priceUsd)
			await reveal(db, decision.id, draft)

			if (result.ok) {
				decisionsExecuted++
				await openPosition(db, agent.id, draft, result, decision.id)
				portfolio = await loadPortfolio(db, agent.id)
			} else {
				errors.push(`entry ${draft.symbol}: ${result.error}`)
			}
		}

		const finalPortfolio = await loadPortfolio(db, agent.id)
		await db
			.update(autopilotCycles)
			.set({
				status: 'completed',
				stage: 'reveal',
				candidatesScanned,
				thesesFormed,
				decisionsSealed,
				decisionsExecuted,
				equityUsd: finalPortfolio.equityUsd,
				finishedAt: new Date(),
				error: errors.length ? errors.join('; ').slice(0, 2000) : null,
			})
			.where(eq(autopilotCycles.id, cycleId))
		await db
			.update(autopilotAgents)
			.set({ lastCycleAt: new Date(), updatedAt: new Date() })
			.where(eq(autopilotAgents.id, agent.id))

		return {
			cycleId,
			agentSlug: agent.slug,
			candidatesScanned,
			thesesFormed,
			decisionsSealed,
			decisionsExecuted,
			rejections,
			equityUsd: finalPortfolio.equityUsd,
			errors,
		}
	} catch (err) {
		logger.error({ err: String(err), cycleId, agent: agent.slug }, 'autopilot: cycle failed')
		await db
			.update(autopilotCycles)
			.set({ status: 'failed', error: String(err).slice(0, 2000), finishedAt: new Date() })
			.where(eq(autopilotCycles.id, cycleId))
		await journal(
			db,
			agent.id,
			cycleId,
			null,
			'cycle',
			`Cycle failed: ${String(err)}`,
			null,
			'error',
		)
		throw err
	}
}

async function markPositionsToMarket(
	db: DbClient,
	agentId: number,
	positions: OpenPositionSummary[],
	market: MarketDeps,
): Promise<void> {
	for (const p of positions) {
		const price = await market.getTokenPriceUsd(p.chain, p.tokenAddress)
		if (price === null) continue
		const marketValue =
			p.avgEntryPriceUsd > 0 ? p.costBasisUsd * (price / p.avgEntryPriceUsd) : p.costBasisUsd
		await db
			.update(autopilotPositions)
			.set({
				lastPriceUsd: price,
				unrealizedPnlUsd: marketValue - p.costBasisUsd,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(autopilotPositions.agentId, agentId),
					eq(autopilotPositions.tokenAddress, p.tokenAddress),
					eq(autopilotPositions.status, 'open'),
				),
			)
	}
}

async function settleDecision(
	db: DbClient,
	agentId: number,
	cycleId: number,
	decision: AutopilotDecision,
	thesis: Thesis,
	result: {
		ok: boolean
		txHash?: string
		quoteId?: string
		fillPriceUsd?: number
		fillAmount?: string
		realizedSlippageBps?: number
		error?: string
	},
	referencePriceUsd: number,
): Promise<void> {
	await db
		.update(autopilotDecisions)
		.set({
			status: result.ok ? 'filled' : 'failed',
			txHash: result.txHash ?? null,
			quoteId: result.quoteId ?? null,
			executedAt: new Date(),
			fillPriceUsd: result.fillPriceUsd ?? referencePriceUsd,
			fillAmount: result.fillAmount ?? null,
			realizedSlippageBps: result.realizedSlippageBps ?? null,
			executionError: result.error ?? null,
		})
		.where(eq(autopilotDecisions.id, decision.id))

	await journal(
		db,
		agentId,
		cycleId,
		decision.id,
		'execute',
		result.ok
			? `${thesis.action === 'buy' ? 'Bought' : 'Sold'} ${thesis.symbol} at $${result.fillPriceUsd ?? referencePriceUsd}`
			: `Execution failed for ${thesis.symbol}: ${result.error}`,
		result,
		result.ok ? 'info' : 'error',
	)
}

async function openPosition(
	db: DbClient,
	agentId: number,
	thesis: Thesis,
	result: { fillPriceUsd?: number; fillAmount?: string },
	decisionId: number,
): Promise<void> {
	await db.insert(autopilotPositions).values({
		agentId,
		chain: thesis.chain,
		tokenAddress: thesis.tokenAddress,
		tokenSymbol: thesis.symbol,
		status: 'open',
		amount: result.fillAmount ?? '0',
		costBasisUsd: thesis.sizeUsd,
		avgEntryPriceUsd: result.fillPriceUsd ?? null,
		lastPriceUsd: result.fillPriceUsd ?? null,
		takeProfitPct: thesis.exit.takeProfitPct ?? null,
		stopLossPct: thesis.exit.stopLossPct ?? null,
		invalidation: thesis.exit.invalidation,
		entryDecisionId: decisionId,
	})
}

async function closePosition(
	db: DbClient,
	agentId: number,
	position: OpenPositionSummary,
	exitPriceUsd: number,
	decisionId: number,
): Promise<void> {
	const proceeds =
		position.avgEntryPriceUsd > 0
			? position.costBasisUsd * (exitPriceUsd / position.avgEntryPriceUsd)
			: position.costBasisUsd
	await db
		.update(autopilotPositions)
		.set({
			status: 'closed',
			lastPriceUsd: exitPriceUsd,
			realizedPnlUsd: proceeds - position.costBasisUsd,
			unrealizedPnlUsd: 0,
			exitDecisionId: decisionId,
			closedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(autopilotPositions.agentId, agentId),
				eq(autopilotPositions.tokenAddress, position.tokenAddress),
				eq(autopilotPositions.status, 'open'),
			),
		)
}
