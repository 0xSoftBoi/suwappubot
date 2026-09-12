import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import {
	agentCreditTopups,
	agentSubscriptions,
	agents,
	auditLogs,
	apiUsageEvents,
	feeTransactions,
	organizations,
	recurringSubscriptions,
	requireDb,
	subscriptions,
	swapRouteCandidates,
	swapTransactions,
	webhookEvents,
	x402Payments,
} from '../db'
import { mapErrorToResponse } from '../errors'
import { buildCfoExceptions, buildCfoScenarios, providerConcentration } from '../lib/cfoOperatingSystem'
import { buildFinanceForecast } from '../lib/financeForecast'
import { runEffectEither } from '../runtime'

const adminRoutes = new Hono()

function parseOptionalUsd(raw: string | undefined): number | null | 'invalid' {
	if (raw === undefined || raw === '') return null
	const value = Number(raw)
	if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000_000) return 'invalid'
	return value
}

function parseOptionalNumber(
	raw: string | undefined,
	min: number,
	max: number,
): number | null | 'invalid' {
	if (raw === undefined || raw === '') return null
	const value = Number(raw)
	if (!Number.isFinite(value) || value < min || value > max) return 'invalid'
	return value
}

// GET /admin/stats - Aggregate statistics
adminRoutes.get('/stats', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const now = new Date()
			const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
			const todayStart = new Date(
				Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
			)
			const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
			const thirtyDaysAgo = new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000)

			const [
				agentStats,
				swapStats,
				webhookStats,
				revenueRow,
				orgStats,
				activeOrgRow,
				apiCallsRow,
				subBreakdownRows,
			] = yield* Effect.all([
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
				// Revenue this month (completed x402 payments)
				Effect.tryPromise({
					try: () =>
						db
							.select({
								total: sql<number>`coalesce(sum(${x402Payments.amount}), 0)`,
							})
							.from(x402Payments)
							.where(
								and(
									eq(x402Payments.status, 'completed'),
									gte(x402Payments.createdAt, monthStart),
								),
							),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// Enterprise org counts
				Effect.tryPromise({
					try: () =>
						db.select({ total: sql<number>`count(*)` }).from(organizations),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// Active enterprise orgs (at least one usage event in last 30 days)
				Effect.tryPromise({
					try: () =>
						db
							.select({ count: sql<number>`count(distinct ${apiUsageEvents.orgId})` })
							.from(apiUsageEvents)
							.where(gte(apiUsageEvents.createdAt, thirtyDaysAgo)),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// API calls today (all orgs)
				Effect.tryPromise({
					try: () =>
						db
							.select({ count: sql<number>`count(*)` })
							.from(apiUsageEvents)
							.where(gte(apiUsageEvents.createdAt, todayStart)),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// Subscription tier breakdown
				Effect.tryPromise({
					try: () =>
						db
							.select({
								tier: subscriptions.tier,
								count: sql<number>`count(*)`,
							})
							.from(subscriptions)
							.groupBy(subscriptions.tier),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
			])

			const subBreakdown = { free: 0, pro: 0, premium: 0, enterprise: 0 }
			for (const row of subBreakdownRows) {
				const tier = (row.tier ?? 'free') as string
				if (tier in subBreakdown) {
					subBreakdown[tier as keyof typeof subBreakdown] = Number(row.count)
				}
			}

			return {
				agents: {
					total: Number(agentStats[0]?.total ?? 0),
					active: Number(agentStats[0]?.active ?? 0),
				},
				swaps: {
					total: Number(swapStats[0]?.total ?? 0),
					last_24h: Number(swapStats[0]?.last_24h ?? 0),
				},
				webhooks: {
					total: Number(webhookStats[0]?.total ?? 0),
					pending: Number(webhookStats[0]?.pending ?? 0),
					delivered: Number(webhookStats[0]?.delivered ?? 0),
					failed: Number(webhookStats[0]?.failed ?? 0),
				},
				revenueThisMonth: Number(revenueRow[0]?.total ?? 0),
				enterpriseOrgs: Number(orgStats[0]?.total ?? 0),
				activeEnterpriseOrgs: Number(activeOrgRow[0]?.count ?? 0),
				apiCallsToday: Number(apiCallsRow[0]?.count ?? 0),
				subscriptionBreakdown: subBreakdown,
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

// GET /admin/stats/timeseries?days=30 - Daily breakdown for charts
adminRoutes.get('/stats/timeseries', async (c) => {
	const rawDays = parseInt(c.req.query('days') || '30', 10)
	const days = Math.min(Math.max(isNaN(rawDays) ? 30 : rawDays, 1), 90)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const now = new Date()
			const todayStart = new Date(
				Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
			)
			const windowStart = new Date(todayStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000)

			const [swapRows, agentRows, apiRows] = yield* Effect.all([
				// Swap volume per day
				Effect.tryPromise({
					try: () =>
						db
							.select({
								date: sql<string>`to_char(date_trunc('day', ${swapTransactions.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
								count: sql<number>`count(*)`,
								usdVolume: sql<number>`coalesce(sum(cast(${swapTransactions.fromAmountUsd} as numeric)), 0)`,
							})
							.from(swapTransactions)
							.where(gte(swapTransactions.createdAt, windowStart))
							.groupBy(
								sql`date_trunc('day', ${swapTransactions.createdAt} at time zone 'UTC')`,
							)
							.orderBy(
								sql`date_trunc('day', ${swapTransactions.createdAt} at time zone 'UTC')`,
							),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// New agents per day
				Effect.tryPromise({
					try: () =>
						db
							.select({
								date: sql<string>`to_char(date_trunc('day', ${agents.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
								count: sql<number>`count(*)`,
							})
							.from(agents)
							.where(gte(agents.createdAt, windowStart))
							.groupBy(sql`date_trunc('day', ${agents.createdAt} at time zone 'UTC')`)
							.orderBy(sql`date_trunc('day', ${agents.createdAt} at time zone 'UTC')`),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// API calls per day (all enterprise orgs)
				Effect.tryPromise({
					try: () =>
						db
							.select({
								date: sql<string>`to_char(date_trunc('day', ${apiUsageEvents.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
								count: sql<number>`count(*)`,
							})
							.from(apiUsageEvents)
							.where(gte(apiUsageEvents.createdAt, windowStart))
							.groupBy(
								sql`date_trunc('day', ${apiUsageEvents.createdAt} at time zone 'UTC')`,
							)
							.orderBy(
								sql`date_trunc('day', ${apiUsageEvents.createdAt} at time zone 'UTC')`,
							),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
			])

			return {
				swapVolume: swapRows.map((r) => ({
					date: r.date,
					count: Number(r.count),
					usdVolume: Number(r.usdVolume),
				})),
				newAgents: agentRows.map((r) => ({ date: r.date, count: Number(r.count) })),
				apiCalls: apiRows.map((r) => ({ date: r.date, count: Number(r.count) })),
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ success: true, ...result.right })
})

// GET /admin/finance - Founder CFO control plane (read-only)
//
// Cash and burn are optional planning inputs supplied by the admin browser. They are
// never persisted here; production ledgers remain the source for observed activity.
adminRoutes.get('/finance', async (c) => {
	const startingCashUsd = parseOptionalUsd(c.req.query('cash_usd'))
	const weeklyOperatingBurnUsd = parseOptionalUsd(c.req.query('weekly_burn_usd'))
	const variableCostBps = parseOptionalNumber(c.req.query('variable_cost_bps'), 0, 10_000)
	const volumeGrowthPct = parseOptionalNumber(c.req.query('volume_growth_pct'), -50, 100)
	const nonFeeGrowthPct = parseOptionalNumber(c.req.query('non_fee_growth_pct'), -50, 100)

	if (
		startingCashUsd === 'invalid' ||
		weeklyOperatingBurnUsd === 'invalid' ||
		variableCostBps === 'invalid' ||
		volumeGrowthPct === 'invalid' ||
		nonFeeGrowthPct === 'invalid'
	) {
		return c.json(
			{
				error:
					'Invalid planning input. cash_usd/weekly_burn_usd must be non-negative; variable_cost_bps 0..10000; growth inputs -50..100.',
			},
			400,
		)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const now = new Date()
			const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
			const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
			const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

			const [
				x402Rows,
				topupRows,
				agentSubscriptionRows,
				feeRows,
				swapRows,
				providerRows,
				funnelRows,
				apiRows,
				recurringRows,
				expiringRows,
				paymentFailureRows,
				latencyRows,
				failureReasonRows,
			] = yield* Effect.all([
				Effect.tryPromise({
					try: () =>
						db
							.select({ total: sql<number>`coalesce(sum(${x402Payments.amount}), 0)` })
							.from(x402Payments)
							.where(
								and(
									eq(x402Payments.status, 'completed'),
									gte(x402Payments.createdAt, thirtyDaysAgo),
								),
							),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select({ total: sql<number>`coalesce(sum(${agentCreditTopups.amountUsd}), 0)` })
							.from(agentCreditTopups)
							.where(gte(agentCreditTopups.createdAt, thirtyDaysAgo)),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select({ total: sql<number>`coalesce(sum(${agentSubscriptions.amountUsd}), 0)` })
							.from(agentSubscriptions)
							.where(gte(agentSubscriptions.createdAt, thirtyDaysAgo)),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select({
								accrued: sql<number>`coalesce(sum(${feeTransactions.feeAmountUsd}), 0)`,
								collected: sql<number>`coalesce(sum(${feeTransactions.feeAmountUsd}) filter (where ${feeTransactions.collected} = true), 0)`,
							})
							.from(feeTransactions)
							.where(gte(feeTransactions.createdAt, thirtyDaysAgo)),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select({
								total: sql<number>`count(*)`,
								completed: sql<number>`count(*) filter (where lower(coalesce(${swapTransactions.status}, '')) in ('completed', 'success'))`,
								failed: sql<number>`count(*) filter (where lower(coalesce(${swapTransactions.status}, '')) = 'failed')`,
								volumeUsd: sql<number>`coalesce(sum(${swapTransactions.fromAmountUsd}), 0)`,
								gasCostUsd: sql<number>`coalesce(sum(cast(${swapTransactions.gasCostUsd} as numeric)), 0)`,
								feeCostUsd: sql<number>`coalesce(sum(cast(${swapTransactions.feeCostUsd} as numeric)), 0)`,
								priceImprovementUsd: sql<number>`coalesce(sum(${swapTransactions.priceImprovementUsd}), 0)`,
								avgPriceImprovementUsd: sql<number>`coalesce(avg(${swapTransactions.priceImprovementUsd}), 0)`,
							})
							.from(swapTransactions)
							.where(gte(swapTransactions.createdAt, thirtyDaysAgo)),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select({
								provider: swapTransactions.routeProvider,
								total: sql<number>`count(*)`,
								completed: sql<number>`count(*) filter (where lower(coalesce(${swapTransactions.status}, '')) in ('completed', 'success'))`,
								failed: sql<number>`count(*) filter (where lower(coalesce(${swapTransactions.status}, '')) = 'failed')`,
								volumeUsd: sql<number>`coalesce(sum(${swapTransactions.fromAmountUsd}), 0)`,
								priceImprovementUsd: sql<number>`coalesce(sum(${swapTransactions.priceImprovementUsd}), 0)`,
							})
							.from(swapTransactions)
							.where(gte(swapTransactions.createdAt, thirtyDaysAgo))
							.groupBy(swapTransactions.routeProvider)
							.orderBy(sql`coalesce(sum(${swapTransactions.fromAmountUsd}), 0) desc`),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select({
								quotes: sql<number>`count(distinct ${swapRouteCandidates.quoteId})`,
								quotesWithExecution: sql<number>`count(distinct ${swapRouteCandidates.quoteId}) filter (where ${swapRouteCandidates.swapId} is not null)`,
								candidates: sql<number>`count(*)`,
							})
							.from(swapRouteCandidates)
							.where(gte(swapRouteCandidates.createdAt, thirtyDaysAgo)),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select({ count: sql<number>`count(*)` })
							.from(apiUsageEvents)
							.where(gte(apiUsageEvents.createdAt, thirtyDaysAgo)),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// Recurring crypto payment-cycle health: due/overdue charges.
				Effect.tryPromise({
					try: () =>
						db
							.select({
								active: sql<number>`count(*) filter (where ${recurringSubscriptions.status} = 'active')`,
								overdue: sql<number>`count(*) filter (where ${recurringSubscriptions.status} = 'active' and ${recurringSubscriptions.nextChargeAt} < ${now})`,
								due7d: sql<number>`count(*) filter (where ${recurringSubscriptions.status} = 'active' and ${recurringSubscriptions.nextChargeAt} >= ${now} and ${recurringSubscriptions.nextChargeAt} <= ${sevenDaysFromNow})`,
								due30d: sql<number>`count(*) filter (where ${recurringSubscriptions.status} = 'active' and ${recurringSubscriptions.nextChargeAt} >= ${now} and ${recurringSubscriptions.nextChargeAt} <= ${thirtyDaysFromNow})`,
							})
							.from(recurringSubscriptions),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// Human subscriptions that will expire soon (card or prepaid crypto).
				Effect.tryPromise({
					try: () =>
						db
							.select({
								expiring30d: sql<number>`count(*) filter (where lower(coalesce(${subscriptions.tier}, 'free')) <> 'free' and ${subscriptions.expiresAt} >= ${now} and ${subscriptions.expiresAt} <= ${thirtyDaysFromNow})`,
							})
							.from(subscriptions),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// Stripe failed-payment events are already written into the tamper-evident audit log.
				Effect.tryPromise({
					try: () =>
						db
							.select({ count: sql<number>`count(*)` })
							.from(auditLogs)
							.where(
								and(
									eq(auditLogs.eventType, 'subscription.payment_failed'),
									gte(auditLogs.createdAt, thirtyDaysAgo),
								),
							),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// Process mining: time from swap row creation to terminal completion.
				Effect.tryPromise({
					try: () =>
						db
							.select({
								p50Seconds: sql<number>`coalesce(percentile_cont(0.5) within group (order by extract(epoch from (${swapTransactions.completedAt} - ${swapTransactions.createdAt}))) filter (where ${swapTransactions.completedAt} is not null), 0)`,
								p95Seconds: sql<number>`coalesce(percentile_cont(0.95) within group (order by extract(epoch from (${swapTransactions.completedAt} - ${swapTransactions.createdAt}))) filter (where ${swapTransactions.completedAt} is not null), 0)`,
							})
							.from(swapTransactions)
							.where(gte(swapTransactions.createdAt, thirtyDaysAgo)),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
				// Process mining: the failure signatures producing the most rework.
				Effect.tryPromise({
					try: () =>
						db
							.select({
								provider: swapTransactions.routeProvider,
								error: swapTransactions.errorMessage,
								count: sql<number>`count(*)`,
							})
							.from(swapTransactions)
							.where(
								and(
									gte(swapTransactions.createdAt, thirtyDaysAgo),
									eq(swapTransactions.status, 'failed'),
								),
							)
							.groupBy(swapTransactions.routeProvider, swapTransactions.errorMessage)
							.orderBy(sql`count(*) desc`)
							.limit(5),
					catch: (e) => new Error(`Database error: ${e}`),
				}),
			])

			const x402Usd = Number(x402Rows[0]?.total ?? 0)
			const prepaidCreditInflowsUsd = Number(topupRows[0]?.total ?? 0)
			const agentSubscriptionInflowsUsd = Number(agentSubscriptionRows[0]?.total ?? 0)
			const swapFeesAccruedUsd = Number(feeRows[0]?.accrued ?? 0)
			const swapFeesCollectedUsd = Number(feeRows[0]?.collected ?? 0)
			const trackedCashInflow30dUsd =
				x402Usd + prepaidCreditInflowsUsd + agentSubscriptionInflowsUsd + swapFeesCollectedUsd
			const observedWeeklyCashInflowUsd = trackedCashInflow30dUsd * (7 / 30)

			const swaps = swapRows[0]
			const totalSwaps = Number(swaps?.total ?? 0)
			const completedSwaps = Number(swaps?.completed ?? 0)
			const failedSwaps = Number(swaps?.failed ?? 0)
			const terminalSwaps = completedSwaps + failedSwaps
			const volumeUsd = Number(swaps?.volumeUsd ?? 0)
			const observedWeeklyVolumeUsd = volumeUsd * (7 / 30)
			const quotes = Number(funnelRows[0]?.quotes ?? 0)
			const quotesWithExecution = Number(funnelRows[0]?.quotesWithExecution ?? 0)

			const forecast = buildFinanceForecast({
				observedWeeklyCashInflowUsd,
				startingCashUsd,
				weeklyOperatingBurnUsd,
				weeks: 13,
			})
			const feeCaptureBps = volumeUsd > 0 ? (swapFeesAccruedUsd / volumeUsd) * 10_000 : 0
			const feeCollectionRate =
				swapFeesAccruedUsd > 0 ? Math.min(Math.max(swapFeesCollectedUsd / swapFeesAccruedUsd, 0), 1) : 1
			const nonFeeCash30dUsd = x402Usd + prepaidCreditInflowsUsd + agentSubscriptionInflowsUsd
			const driverForecast = buildCfoScenarios({
				observedWeeklyVolumeUsd,
				observedFeeCaptureBps: feeCaptureBps,
				observedFeeCollectionRate: feeCollectionRate,
				observedWeeklyNonFeeCashInflowUsd: nonFeeCash30dUsd * (7 / 30),
				startingCashUsd,
				weeklyFixedBurnUsd: weeklyOperatingBurnUsd,
				variableCostBps,
				volumeGrowthPct,
				nonFeeCashGrowthPct: nonFeeGrowthPct,
				weeks: 13,
			})
			const providerRisk = providerConcentration(
				providerRows.map((row) => ({
					provider: row.provider ?? 'unknown',
					volumeUsd: Number(row.volumeUsd ?? 0),
				})),
			)
			const baseDriverScenario = driverForecast.find((row) => row.name === 'base')
			const operatingExceptions = buildCfoExceptions({
				baseFirstCashOutWeek: baseDriverScenario?.firstCashOutWeek ?? null,
				topProvider: providerRisk.topProvider,
				topProviderShare: providerRisk.topProviderShare,
				stripePaymentFailures30d: Number(paymentFailureRows[0]?.count ?? 0),
				recurringOverdue: Number(recurringRows[0]?.overdue ?? 0),
				feeCollectionRate: swapFeesAccruedUsd > 0 ? feeCollectionRate : null,
				feesAccruedUsd: swapFeesAccruedUsd,
				quoteToExecutionRate: quotes > 0 ? quotesWithExecution / quotes : null,
				quotesObserved: quotes,
			})

			return {
				asOf: now.toISOString(),
				windowDays: 30,
				cashInflow: {
					tracked30dUsd: trackedCashInflow30dUsd,
					weeklyRunRateUsd: observedWeeklyCashInflowUsd,
					sources: {
						directPaymentsUsd: x402Usd,
						prepaidCreditInflowsUsd,
						agentSubscriptionInflowsUsd,
						swapFeesCollectedUsd,
						swapFeesAccruedUsd,
					},
				},
				execution: {
					totalSwaps,
					completedSwaps,
					failedSwaps,
					successRate: terminalSwaps > 0 ? completedSwaps / terminalSwaps : null,
					volumeUsd,
					quotes,
					quotesWithExecution,
					quoteToExecutionRate: quotes > 0 ? quotesWithExecution / quotes : null,
					routeCandidates: Number(funnelRows[0]?.candidates ?? 0),
				},
				unitEconomics: {
					trackedCashInflowPerCompletedSwapUsd:
						completedSwaps > 0 ? trackedCashInflow30dUsd / completedSwaps : null,
					feeCaptureBps: volumeUsd > 0 ? feeCaptureBps : null,
					feeCollectionRate: swapFeesAccruedUsd > 0 ? feeCollectionRate : null,
					trackedGasCostUsd: Number(swaps?.gasCostUsd ?? 0),
					trackedFeeCostUsd: Number(swaps?.feeCostUsd ?? 0),
					priceImprovementUsd: Number(swaps?.priceImprovementUsd ?? 0),
					avgPriceImprovementUsd: Number(swaps?.avgPriceImprovementUsd ?? 0),
					apiCalls: Number(apiRows[0]?.count ?? 0),
				},
				paymentCycles: {
					recurringActive: Number(recurringRows[0]?.active ?? 0),
					recurringOverdue: Number(recurringRows[0]?.overdue ?? 0),
					recurringDue7d: Number(recurringRows[0]?.due7d ?? 0),
					recurringDue30d: Number(recurringRows[0]?.due30d ?? 0),
					humanSubscriptionsExpiring30d: Number(expiringRows[0]?.expiring30d ?? 0),
					stripePaymentFailures30d: Number(paymentFailureRows[0]?.count ?? 0),
				},
				processMining: {
					quoteToExecutionRate: quotes > 0 ? quotesWithExecution / quotes : null,
					quotesWithoutExecution: Math.max(quotes - quotesWithExecution, 0),
					avgRouteCandidatesPerQuote:
						quotes > 0 ? Number(funnelRows[0]?.candidates ?? 0) / quotes : null,
					settlementLatencyP50Seconds: Number(latencyRows[0]?.p50Seconds ?? 0),
					settlementLatencyP95Seconds: Number(latencyRows[0]?.p95Seconds ?? 0),
					topFailureReasons: failureReasonRows.map((row) => ({
						provider: row.provider ?? 'unknown',
						error: row.error ?? 'unspecified',
						count: Number(row.count ?? 0),
					})),
				},
				resilience: {
					providerConcentration: providerRisk,
				},
				operatingExceptions,
				providers: providerRows.map((row) => {
					const total = Number(row.total ?? 0)
					const completed = Number(row.completed ?? 0)
					const failed = Number(row.failed ?? 0)
					const terminal = completed + failed
					return {
						provider: row.provider ?? 'unknown',
						total,
						completed,
						failed,
						successRate: terminal > 0 ? completed / terminal : null,
						volumeUsd: Number(row.volumeUsd ?? 0),
						priceImprovementUsd: Number(row.priceImprovementUsd ?? 0),
					}
				}),
				planning: {
					startingCashUsd,
					weeklyOperatingBurnUsd,
					variableCostBps,
					volumeGrowthPct,
					nonFeeGrowthPct,
					forecast,
					driverForecast,
				},
				dataQuality: {
					complete: false,
					missing: [
						'Stripe settlement inflows, refunds, and chargebacks',
						'Railway, Vercel, RPC, provider, and observability costs',
						'Payroll, contractor, legal, compliance, and tax cash outflows',
						'Bank and treasury balances unless supplied as the planning cash input',
					],
					notes: [
						'Prepaid credit topups are cash inflow, not recognized revenue.',
						'Subscription inflows are not revenue-recognition schedules.',
						'Tracked gas/fee cost fields describe execution economics and may not be company-paid infrastructure cost.',
					],
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

export { adminRoutes }
