import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { agents, requireDb, swapTransactions, webhookEvents } from '../db'
import { mapErrorToResponse } from '../errors'
import { runEffectEither } from '../runtime'

const adminRoutes = new Hono()

// GET /admin/stats - Aggregate statistics
adminRoutes.get('/stats', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const now = new Date()
			const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

			const [agentStats, swapStats, webhookStats] = yield* Effect.all([
				// Agent counts
				Effect.tryPromise({
					try: () =>
						db
							.select({
								total: sql<number>`count(*)`,
								active: sql<number>`count(*) filter (where ${agents.isActive} = true)`,
							})
							.from(agents),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// Swap counts
				Effect.tryPromise({
					try: () =>
						db
							.select({
								total: sql<number>`count(*)`,
								last_24h: sql<number>`count(*) filter (where ${swapTransactions.createdAt} >= ${oneDayAgo})`,
							})
							.from(swapTransactions),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// Webhook counts
				Effect.tryPromise({
					try: () =>
						db
							.select({
								total: sql<number>`count(*)`,
								pending: sql<number>`count(*) filter (where ${webhookEvents.status} = 'pending')`,
								delivered: sql<number>`count(*) filter (where ${webhookEvents.status} = 'delivered')`,
								failed: sql<number>`count(*) filter (where ${webhookEvents.status} = 'failed')`,
							})
							.from(webhookEvents),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
			])

			return {
				agents: {
					total: agentStats[0]?.total ?? 0,
					active: agentStats[0]?.active ?? 0,
				},
				swaps: {
					total: swapStats[0]?.total ?? 0,
					last_24h: swapStats[0]?.last_24h ?? 0,
				},
				webhooks: {
					total: webhookStats[0]?.total ?? 0,
					pending: webhookStats[0]?.pending ?? 0,
					delivered: webhookStats[0]?.delivered ?? 0,
					failed: webhookStats[0]?.failed ?? 0,
				},
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ success: true, ...result.right })
})

// GET /admin/agents - Paginated agent list with stats
adminRoutes.get('/agents', async (c) => {
	const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100)
	const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0)
	const statusFilter = c.req.query('status') // 'active' | 'inactive'

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const conditions = []
			if (statusFilter === 'active') {
				conditions.push(eq(agents.isActive, true))
			} else if (statusFilter === 'inactive') {
				conditions.push(eq(agents.isActive, false))
			}

			const whereClause = conditions.length > 0 ? and(...conditions) : undefined

			const [rows, countRows] = yield* Effect.all([
				Effect.tryPromise({
					try: () =>
						db
							.select({
								id: agents.id,
								uuid: agents.uuid,
								name: agents.name,
								description: agents.description,
								isActive: agents.isActive,
								rateLimitTier: agents.rateLimitTier,
								totalRequests: agents.totalRequests,
								totalSwaps: agents.totalSwaps,
								callbackUrl: agents.callbackUrl,
								createdAt: agents.createdAt,
								lastActiveAt: agents.lastActiveAt,
							})
							.from(agents)
							.where(whereClause)
							.orderBy(desc(agents.createdAt))
							.limit(limit)
							.offset(offset),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				Effect.tryPromise({
					try: () => db.select({ count: sql<number>`count(*)` }).from(agents).where(whereClause),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
			])

			const total = countRows[0]?.count ?? 0

			return {
				agents: rows.map((a) => ({
					id: a.id,
					uuid: a.uuid,
					name: a.name,
					description: a.description,
					is_active: a.isActive,
					rate_limit_tier: a.rateLimitTier,
					total_requests: a.totalRequests,
					total_swaps: a.totalSwaps,
					callback_url: a.callbackUrl,
					created_at: a.createdAt,
					last_active_at: a.lastActiveAt,
				})),
				pagination: { total, limit, offset, has_more: offset + limit < total },
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ success: true, ...result.right })
})

// GET /admin/swaps - Recent swaps across all agents
adminRoutes.get('/swaps', async (c) => {
	const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100)
	const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0)
	const statusFilter = c.req.query('status')
	const agentIdFilter = c.req.query('agent_id') ? parseInt(c.req.query('agent_id')!, 10) : undefined

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const conditions = []
			if (statusFilter) {
				conditions.push(eq(swapTransactions.status, statusFilter))
			}
			if (agentIdFilter && !isNaN(agentIdFilter)) {
				conditions.push(eq(swapTransactions.agentId, agentIdFilter))
			}

			const whereClause = conditions.length > 0 ? and(...conditions) : undefined

			const [rows, countRows] = yield* Effect.all([
				Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(swapTransactions)
							.where(whereClause)
							.orderBy(desc(swapTransactions.createdAt))
							.limit(limit)
							.offset(offset),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				Effect.tryPromise({
					try: () =>
						db.select({ count: sql<number>`count(*)` }).from(swapTransactions).where(whereClause),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
			])

			const total = countRows[0]?.count ?? 0

			return {
				swaps: rows.map((s) => ({
					id: s.id,
					user_id: s.userId,
					agent_id: s.agentId,
					agent_uuid: s.agentUuid,
					status: s.status,
					tx_hash: s.txHash,
					from_chain: s.fromChain,
					to_chain: s.toChain,
					from_token: s.fromToken,
					to_token: s.toToken,
					from_amount: s.fromAmount,
					to_amount: s.toAmount,
					from_amount_usd: s.fromAmountUsd,
					to_amount_usd: s.toAmountUsd,
					route_provider: s.routeProvider,
					error_message: s.errorMessage,
					created_at: s.createdAt,
					completed_at: s.completedAt,
				})),
				pagination: { total, limit, offset, has_more: offset + limit < total },
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ success: true, ...result.right })
})

// GET /admin/webhooks - Recent webhook events
adminRoutes.get('/webhooks', async (c) => {
	const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100)
	const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0)
	const statusFilter = c.req.query('status')
	const eventTypeFilter = c.req.query('event_type')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const conditions = []
			if (statusFilter) {
				conditions.push(eq(webhookEvents.status, statusFilter))
			}
			if (eventTypeFilter) {
				conditions.push(eq(webhookEvents.eventType, eventTypeFilter))
			}

			const whereClause = conditions.length > 0 ? and(...conditions) : undefined

			const [rows, countRows] = yield* Effect.all([
				Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(webhookEvents)
							.where(whereClause)
							.orderBy(desc(webhookEvents.createdAt))
							.limit(limit)
							.offset(offset),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				Effect.tryPromise({
					try: () =>
						db.select({ count: sql<number>`count(*)` }).from(webhookEvents).where(whereClause),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
			])

			const total = countRows[0]?.count ?? 0

			return {
				events: rows.map((ev) => ({
					id: ev.id,
					agent_id: ev.agentId,
					event_type: ev.eventType,
					status: ev.status,
					attempts: ev.attempts,
					last_error: ev.lastError,
					response_status: ev.responseStatus,
					callback_url: ev.callbackUrl,
					created_at: ev.createdAt,
					delivered_at: ev.deliveredAt,
				})),
				pagination: { total, limit, offset, has_more: offset + limit < total },
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ success: true, ...result.right })
})

export { adminRoutes }
